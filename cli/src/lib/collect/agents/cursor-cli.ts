import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  cwdFromProjectTranscriptPath,
  findProjectAgentTranscriptPath,
  resolveChatProjectHashToCwd,
} from "../cursor-chat-project.js";
import * as paths from "../paths.js";
import { appendAssistantMessage } from "../aggregators/human-assistant.js";
import { classifyHumanInput } from "../aggregators/human-category.js";
import {
  formatLocalTime,
  getLocalTimezone,
  localDateString,
  parseTimestampTag,
} from "../date-utils.js";
import { SessionData, FileChange, RepoTouched, UsageBucket, ModelUsageEntry, HumanInput } from "../types.js";
import { calculateCost, COST_CURRENCY } from "../pricing.js";
import { appendFileDelta, mergeFileDeltas, type FileDelta } from "../aggregators/tool-utils.js";

const CHARS_PER_TOKEN = 4;

interface CursorCliCollectOptions {
  log?: (message: string) => void;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function logCursorCli(opts: CursorCliCollectOptions | undefined, message: string): void {
  opts?.log?.(`[cursor-cli] ${message}`);
}

function toBuffer(value: unknown): Buffer | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value);
  return null;
}

function timed<T>(opts: CursorCliCollectOptions | undefined, label: string, run: () => T): T {
  logCursorCli(opts, `${label}...`);
  const startedAt = Date.now();
  try {
    const result = run();
    logCursorCli(opts, `${label} done in ${formatDuration(Date.now() - startedAt)}.`);
    return result;
  } catch (e) {
    logCursorCli(opts, `${label} failed after ${formatDuration(Date.now() - startedAt)}: ${(e as Error).message}`);
    throw e;
  }
}

/**
 * Extract JSON from a protobuf blob by scanning for {"role" bytes.
 * Returns parsed message objects found in the blob.
 */
function extractJsonFromBlob(blob: Buffer): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const marker = Buffer.from('{"role"');

  let pos = 0;
  while (pos < blob.length) {
    const idx = blob.indexOf(marker, pos);
    if (idx === -1) break;

    // Track brace depth to find JSON boundary
    let depth = 0;
    let end = idx;
    for (let i = idx; i < blob.length; i++) {
      const ch = blob[i];
      if (ch === 0x7b) depth++; // '{'
      else if (ch === 0x7d) {   // '}'
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (depth === 0 && end > idx) {
      try {
        const jsonStr = blob.slice(idx, end + 1).toString("utf-8");
        const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
        results.push(parsed);
      } catch {
        // skip malformed JSON
      }
    }

    pos = idx + 1;
  }

  return results;
}

interface CursorMessage {
  role: "user" | "assistant";
  content: unknown;
  timestamp?: number | string;
  model?: string;
  toolCalls?: unknown[];
}

interface StoreMetadata {
  sessionName: string;
  model: string;
  createdAt?: number;
}

/**
 * Read session metadata from the store.db meta key ('0').
 */
function readStoreMeta(dbPath: string): StoreMetadata {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });

    try {
      let metaRow: { value: string } | undefined;
      try {
        metaRow = db
          .prepare("SELECT value FROM meta WHERE key = '0'")
          .get() as { value: string } | undefined;
      } catch {
        metaRow = undefined;
      }

      if (metaRow?.value) {
        try {
          const parsed = JSON.parse(Buffer.from(metaRow.value, "hex").toString("utf-8")) as Record<string, unknown>;
          return {
            sessionName: (parsed["name"] ?? parsed["title"] ?? "") as string,
            model: (parsed["lastUsedModel"] ?? parsed["model"] ?? "") as string,
            createdAt: parsed["createdAt"] as number | undefined,
          };
        } catch {
          // fall through to legacy blob schema
        }
      }

      const row = db
        .prepare("SELECT value FROM blobs WHERE key = '0'")
        .get() as { value: unknown } | undefined;

      const rowValue = toBuffer(row?.value);
      if (!rowValue) return { sessionName: "", model: "" };

      // Try to extract JSON from the blob
      const messages = extractJsonFromBlob(rowValue);
      if (messages.length > 0) {
        const meta = messages[0];
        return {
          sessionName: (meta["name"] ?? meta["title"] ?? meta["sessionName"] ?? "") as string,
          model: (meta["model"] ?? meta["selectedModel"] ?? "") as string,
          createdAt: meta["createdAt"] as number | undefined,
        };
      }

      // Try plain JSON parse
      try {
        const parsed = JSON.parse(rowValue.toString("utf-8")) as Record<string, unknown>;
        return {
          sessionName: (parsed["name"] ?? parsed["title"] ?? "") as string,
          model: (parsed["model"] ?? "") as string,
          createdAt: parsed["createdAt"] as number | undefined,
        };
      } catch {
        return { sessionName: "", model: "" };
      }
    } finally {
      db.close();
    }
  } catch {
    return { sessionName: "", model: "" };
  }
}

/**
 * Read transcript messages from a store.db blobs table.
 */
function readStoreMessages(dbPath: string): CursorMessage[] {
  const messages: CursorMessage[] = [];

  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });

    try {
      const seenContent = new Set<string>();
      try {
        const dataRows = db
          .prepare("SELECT id, data FROM blobs WHERE length(data) > 100 ORDER BY rowid")
          .all() as Array<{ id: string; data: unknown }>;

        for (const row of dataRows) {
          const data = toBuffer(row.data);
          if (!data?.includes(Buffer.from('"role"'))) continue;
          const extracted = extractJsonFromBlob(data);
          for (const msg of extracted) {
            if (msg["role"] !== "user" && msg["role"] !== "assistant") continue;
            const dedupKey = JSON.stringify(msg["content"] ?? "");
            if (seenContent.has(dedupKey)) continue;
            seenContent.add(dedupKey);
            messages.push({
              role: msg["role"] as "user" | "assistant",
              content: msg["content"] ?? "",
              timestamp: msg["timestamp"] as number | string | undefined,
              model: msg["model"] as string | undefined,
              toolCalls: msg["toolCalls"] as unknown[] | undefined,
            });
          }
        }
      } catch {
        // fall through to legacy key/value blob schema
      }

      if (messages.length > 0) return messages;

      const rows = db
        .prepare("SELECT key, value FROM blobs WHERE key != '0' ORDER BY key ASC")
        .all() as Array<{ key: string; value: unknown }>;

      for (const row of rows) {
        const value = toBuffer(row.value);
        if (!value) continue;
        const extracted = extractJsonFromBlob(value);
        for (const msg of extracted) {
          if (msg["role"] === "user" || msg["role"] === "assistant") {
            messages.push({
              role: msg["role"] as "user" | "assistant",
              content: msg["content"] ?? "",
              timestamp: msg["timestamp"] as number | string | undefined,
              model: msg["model"] as string | undefined,
              toolCalls: msg["toolCalls"] as unknown[] | undefined,
            });
          }
        }
      }
    } finally {
      db.close();
    }
  } catch {
    // DB not accessible
  }

  return messages;
}

function textLength(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "string") return value.length;
  return JSON.stringify(value).length;
}

function messageCharLength(msg: CursorMessage): { inputChars: number; outputChars: number } {
  const content = msg.content;

  if (msg.role === "user") {
    if (typeof content === "string") return { inputChars: textLength(content), outputChars: 0 };
    if (Array.isArray(content)) {
      const inputChars = content.reduce((sum, item) => {
        if (typeof item === "object" && item !== null && (item as Record<string, unknown>)["type"] === "text") {
          return sum + textLength((item as Record<string, unknown>)["text"]);
        }
        return sum;
      }, 0);
      return { inputChars, outputChars: 0 };
    }
    return { inputChars: 0, outputChars: 0 };
  }

  if (msg.role === "assistant") {
    if (typeof content === "string") return { inputChars: 0, outputChars: textLength(content) };
    if (Array.isArray(content)) {
      const outputChars = content.reduce((sum, item) => {
        if (typeof item !== "object" || item === null) return sum;
        const block = item as Record<string, unknown>;
        if (block["type"] === "text") return sum + textLength(block["text"]);
        if (block["type"] === "tool_use") return sum + textLength(block["input"] ?? block["arguments"] ?? {});
        return sum;
      }, 0);
      return { inputChars: 0, outputChars };
    }
  }

  return { inputChars: 0, outputChars: 0 };
}

function estimateTokensFromMessages(messages: CursorMessage[]): { inputTokens: number; outputTokens: number } {
  let inputChars = 0;
  let outputChars = 0;
  for (const msg of messages) {
    const counts = messageCharLength(msg);
    inputChars += counts.inputChars;
    outputChars += counts.outputChars;
  }
  return {
    inputTokens: Math.floor(inputChars / CHARS_PER_TOKEN),
    outputTokens: Math.floor(outputChars / CHARS_PER_TOKEN),
  };
}

function parseMessageTimestamp(raw: number | string | undefined): Date | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    if (/^\d+(\.\d+)?$/.test(text)) return parseMessageTimestamp(Number(text));
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw > 1_000_000_000_000 ? raw : raw * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block !== "object" || block === null) return "";
      const item = block as Record<string, unknown>;
      const type = item["type"];
      if (type === "text" || type === "input_text" || type === "output_text") {
        return String(item["text"] ?? "").trim();
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

const USER_QUERY_RE = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/i;
const TS_TAG_RE = /<timestamp>[\s\S]*?<\/timestamp>/gi;

function extractHumanInputText(content: unknown): string {
  const raw = extractTextContent(content);
  const query = raw.match(USER_QUERY_RE)?.[1]?.trim();
  if (query) return query;
  return raw
    .replace(TS_TAG_RE, "")
    .replace(/<\/?user_query>/gi, "")
    .trim();
}

function isHumanInputText(text: string): boolean {
  if (!text) return false;
  if (text.includes("<user_info>")) return false;
  if (text.includes("<git_status>")) return false;
  if (text.includes("<agent_transcripts>")) return false;
  if (text.includes("<rules>")) return false;
  if (text.includes("<agent_skills>")) return false;
  if (text.includes("<environment_context>")) return false;
  if (text.includes("<INSTRUCTIONS>")) return false;
  if (/^# AGENTS\.md instructions/.test(text)) return false;
  if (/^Base directory for this skill:/.test(text)) return false;
  if (/^This session is being continued/.test(text)) return false;
  if (/^Continue from where you left off\.?$/i.test(text)) return false;
  if (/<command-message>/.test(text)) return false;
  if (/^(git |npm |npx |cawplan |cd |ls |cat |echo )/.test(text)) return false;
  return true;
}

function buildHumanInputsFromMessages(
  messages: CursorMessage[],
  sessionName: string,
  model: string
): HumanInput[] {
  const inputs: HumanInput[] = [];
  const seen = new Set<string>();
  let current: HumanInput | null = null;

  for (const msg of messages) {
    const ts = parseMessageTimestamp(msg.timestamp);
    if (msg.role === "user") {
      const text = extractHumanInputText(msg.content);
      if (!isHumanInputText(text)) {
        current = null;
        continue;
      }
      const dedupeKey = text.replace(/\s+/g, " ").trim().slice(0, 500);
      if (seen.has(dedupeKey)) {
        current = null;
        continue;
      }
      seen.add(dedupeKey);
      current = {
        category: classifyHumanInput(text),
        content: text,
        session_title: sessionName,
        session_agent: "cursor-cli",
        session_model: model || undefined,
        start_time: ts ? ts.toISOString() : null,
        end_time: ts ? ts.toISOString() : null,
        time_precision: ts ? "exact" : "approximate",
        files_changed: 0,
        lines_added: 0,
        lines_deleted: 0,
      };
      inputs.push(current);
      continue;
    }

    if (msg.role === "assistant" && current) {
      if (ts) current.end_time = ts.toISOString();
      const assistantText = extractTextContent(msg.content);
      if (assistantText) {
        current.assistant_message = appendAssistantMessage(current.assistant_message, assistantText);
      }
    }
  }

  return inputs;
}

/** Attribute transcript file-change events to human inputs by event timestamp. */
export function attributeFileChangesToHumanInputs(
  humanInputs: HumanInput[],
  events: Record<string, unknown>[]
): void {
  if (humanInputs.length === 0 || events.length === 0) return;

  const deltasByInput = humanInputs.map(() => new Map<string, FileDelta>());

  const findIndexForTime = (eventTime: Date | null): number => {
    if (humanInputs.length === 1) return 0;
    if (!eventTime) return Math.max(0, humanInputs.length - 1);
    const eventMs = eventTime.getTime();
    let idx = 0;
    for (let i = 0; i < humanInputs.length; i++) {
      const start = humanInputs[i]?.start_time;
      const startMs = start ? new Date(start).getTime() : Number.NaN;
      if (!Number.isFinite(startMs) || startMs <= eventMs) idx = i;
      else break;
    }
    return idx;
  };

  for (const event of events) {
    const filePath = (event["file"] ?? event["path"]) as string | undefined;
    if (!filePath?.trim()) continue;
    const added = (event["added"] as number) ?? 0;
    const deleted = (event["deleted"] as number) ?? 0;
    const idx = findIndexForTime(extractTranscriptEventTime(event));
    appendFileDelta(deltasByInput[idx]!, {
      path: filePath.trim(),
      added,
      deleted,
    });
  }

  for (let i = 0; i < humanInputs.length; i++) {
    const merged = mergeFileDeltas([...deltasByInput[i]!.values()]);
    if (merged.length === 0) continue;
    humanInputs[i]!.file_changes = merged;
    humanInputs[i]!.files_changed = merged.length;
    humanInputs[i]!.lines_added = merged.reduce((sum, delta) => sum + delta.added, 0);
    humanInputs[i]!.lines_deleted = merged.reduce((sum, delta) => sum + delta.deleted, 0);
  }
}

function extractTranscriptEventTime(event: Record<string, unknown>): Date | null {
  const ts = (event["timestamp"] ?? event["ts"]) as string | number | undefined;
  if (ts != null) {
    const d = new Date(typeof ts === "number" ? ts : ts);
    if (!isNaN(d.getTime())) return d;
  }

  const message = event["message"] as Record<string, unknown> | undefined;
  const content = message?.["content"];
  if (!Array.isArray(content)) return null;

  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const item = block as Record<string, unknown>;
    if (item["type"] !== "text") continue;
    const tagged = parseTimestampTag(String(item["text"] ?? ""));
    if (tagged) return tagged;
  }
  return null;
}

function extractCwdFromTranscriptEvent(event: Record<string, unknown>): string {
  const direct = event["cwd"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const message = event["message"] as Record<string, unknown> | undefined;
  const content = message?.["content"];
  if (!Array.isArray(content)) return "";

  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const item = block as Record<string, unknown>;
    if (item["type"] !== "tool_use") continue;
    const input = item["input"];
    if (!input || typeof input !== "object") continue;
    const workingDirectory = (input as Record<string, unknown>)["working_directory"];
    if (typeof workingDirectory === "string" && workingDirectory.trim()) {
      return workingDirectory.trim();
    }
  }
  return "";
}

/**
 * Read transcript JSONL from agent-transcript.jsonl file.
 */
function readTranscriptJsonl(transcriptPath: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  try {
    const content = readFileSync(transcriptPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        // skip
      }
    }
  } catch {
    // file not found
  }
  return events;
}

function transcriptEventContent(event: Record<string, unknown>): unknown {
  const message = event["message"] as Record<string, unknown> | undefined;
  return message?.["content"] ?? event["content"] ?? "";
}

function transcriptToolCalls(content: unknown): unknown[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const calls = content.filter((block) => {
    if (typeof block !== "object" || block === null) return false;
    return (block as Record<string, unknown>)["type"] === "tool_use";
  });
  return calls.length > 0 ? calls : undefined;
}

function buildMessagesFromTranscriptEvents(events: Record<string, unknown>[]): CursorMessage[] {
  const messages: CursorMessage[] = [];
  for (const event of events) {
    const role = event["role"];
    if (role !== "user" && role !== "assistant") continue;
    const content = transcriptEventContent(event);
    const ts = extractTranscriptEventTime(event)?.toISOString();
    messages.push({
      role,
      content,
      timestamp: ts,
      toolCalls: role === "assistant" ? transcriptToolCalls(content) : undefined,
    });
  }
  return messages;
}

function selectTranscriptTurnEventsForDate(
  events: Record<string, unknown>[],
  filterDate: string
): Record<string, unknown>[] {
  const selected: Record<string, unknown>[] = [];
  let includeCurrentTurn = false;

  for (const event of events) {
    const d = extractTranscriptEventTime(event);
    if (d) {
      includeCurrentTurn = localDateString(d) === filterDate;
    }
    if (includeCurrentTurn) selected.push(event);
  }

  return selected;
}

/**
 * Collect Cursor CLI sessions from ~/.cursor/chats/ for a given date.
 */
export function collectCursorCliSessions(filterDate: string, opts?: CursorCliCollectOptions): SessionData[] {
  const chatsDir = paths.cursorChatsDir();
  logCursorCli(opts, `Chats directory: ${chatsDir}`);
  if (!existsSync(chatsDir)) {
    logCursorCli(opts, "Cursor CLI chats directory does not exist; no sessions collected.");
    return [];
  }

  const sessions: SessionData[] = [];

  let sessionDirs: string[] = [];
  try {
    sessionDirs = timed(opts, "Read Cursor CLI session directories", () => readdirSync(chatsDir));
  } catch {
    logCursorCli(opts, "Cursor CLI chats directory is not readable; no sessions collected.");
    return sessions;
  }
  logCursorCli(opts, `Found ${sessionDirs.length} Cursor CLI session directorie(s).`);

  for (const sessionId of sessionDirs) {
    const sessionPath = join(chatsDir, sessionId);

    try {
      if (!statSync(sessionPath).isDirectory()) continue;
    } catch {
      continue;
    }

    // Each session may have multiple conversations
    let convDirs: string[] = [];
    try {
      convDirs = timed(opts, `Read Cursor CLI conversations for project ${sessionId}`, () => readdirSync(sessionPath));
    } catch {
      continue;
    }
    logCursorCli(opts, `Project ${sessionId}: ${convDirs.length} conversation directorie(s).`);

    for (const convId of convDirs) {
      const convPath = join(sessionPath, convId);
      try {
        if (!statSync(convPath).isDirectory()) continue;
      } catch {
        continue;
      }

      const storeDbPath = join(convPath, "store.db");
      if (!existsSync(storeDbPath)) continue;

      // Check for agent-transcript JSONL (chats copy, then projects layout).
      const chatsTranscriptPath = join(convPath, "agent-transcript.jsonl");
      let transcriptSourcePath = chatsTranscriptPath;
      let transcriptEvents = timed(opts, `Read Cursor CLI transcript ${convId}`, () =>
        readTranscriptJsonl(chatsTranscriptPath)
      );
      if (transcriptEvents.length === 0) {
        const projectTranscriptPath = findProjectAgentTranscriptPath(convId);
        if (projectTranscriptPath) {
          transcriptSourcePath = projectTranscriptPath;
          transcriptEvents = timed(opts, `Read Cursor CLI project transcript ${convId}`, () =>
            readTranscriptJsonl(projectTranscriptPath)
          );
          logCursorCli(opts, `Conversation ${convId}: using project transcript ${projectTranscriptPath}.`);
        }
      }
      logCursorCli(opts, `Conversation ${convId}: transcript events=${transcriptEvents.length}.`);

      // Filter by date — check transcript timestamps
      let hasActivityOnDate = false;
      let hasParseableTranscriptTime = false;
      let firstTs: Date | null = null;
      let lastTs: Date | null = null;
      const dayTranscriptEvents: Record<string, unknown>[] = [];

      timed(opts, `Filter Cursor CLI transcript by date ${convId}`, () => {
      for (const event of transcriptEvents) {
        const d = extractTranscriptEventTime(event);
        if (!d) continue;
        hasParseableTranscriptTime = true;

        const eventDate = localDateString(d);
        if (eventDate === filterDate) {
          hasActivityOnDate = true;
          dayTranscriptEvents.push(event);
          if (!firstTs || d < firstTs) firstTs = d;
          if (!lastTs || d > lastTs) lastTs = d;
        }
      }
      });
      logCursorCli(opts, `Conversation ${convId}: day transcript events=${dayTranscriptEvents.length}.`);

      // Fall back to local file mtimes when transcript lines lack parseable timestamps.
      // Prefer transcript mtime when a transcript exists; store.db may be touched later
      // by Cursor bookkeeping and otherwise duplicate the same conversation across days.
      if (!hasActivityOnDate && !hasParseableTranscriptTime) {
        const shouldUseTranscriptMtime = transcriptEvents.length > 0 && existsSync(transcriptSourcePath);
        if (shouldUseTranscriptMtime) {
          try {
            const stat = statSync(transcriptSourcePath);
            if (localDateString(stat.mtime) === filterDate) {
              hasActivityOnDate = true;
            }
          } catch {
            // ignore
          }
        } else {
          try {
            const stat = statSync(storeDbPath);
            if (localDateString(stat.mtime) === filterDate) {
              hasActivityOnDate = true;
            }
          } catch {
            // ignore
          }
        }
      }

      if (!hasActivityOnDate) continue;
      logCursorCli(opts, `Conversation ${convId}: activity found on ${filterDate}.`);

      // Read session metadata
      const meta = timed(opts, `Read Cursor CLI store metadata ${convId}`, () => readStoreMeta(storeDbPath));
      const allMessages = timed(opts, `Read Cursor CLI store messages ${convId}`, () => readStoreMessages(storeDbPath));
      const storeMessages = timed(opts, `Filter Cursor CLI store messages ${convId}`, () => {
        const hasMessageTimestamps = allMessages.some((msg) => msg.timestamp != null);
        return hasMessageTimestamps
          ? allMessages.filter((msg) => {
          if (msg.timestamp == null) return false;
          const d = parseMessageTimestamp(msg.timestamp);
          return !!d && localDateString(d) === filterDate;
        })
          : allMessages;
      });
      const transcriptMessages = timed(opts, `Build Cursor CLI transcript messages ${convId}`, () =>
        buildMessagesFromTranscriptEvents(
          dayTranscriptEvents.length > 0
            ? selectTranscriptTurnEventsForDate(transcriptEvents, filterDate)
            : transcriptEvents
        )
      );
      const messages = storeMessages.length > 0 ? storeMessages : transcriptMessages;
      const messageSource = storeMessages.length > 0 ? "store" : "project transcript";
      logCursorCli(opts, `Conversation ${convId}: store messages=${allMessages.length}, day messages=${storeMessages.length}, transcript messages=${transcriptMessages.length}, using=${messageSource}.`);

      // Count message stats
      let userCount = 0;
      let assistantCount = 0;
      let toolCallCount = 0;

      timed(opts, `Count Cursor CLI messages ${convId}`, () => {
      for (const msg of messages) {
        if (msg.role === "user") userCount++;
        else if (msg.role === "assistant") {
          assistantCount++;
          if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
            toolCallCount += msg.toolCalls.length;
          }
        }
      }
      });

      // Extract file changes from transcript tool calls
      const filesChanged: FileChange[] = [];
      const filesSet = new Set<string>();
      let cwd = "";

      const fileEvents = dayTranscriptEvents.length > 0 ? dayTranscriptEvents : transcriptEvents;
      timed(opts, `Extract Cursor CLI file changes ${convId}`, () => {
      for (const event of fileEvents) {
        const cwdVal = extractCwdFromTranscriptEvent(event);
        if (cwdVal && !cwd) cwd = cwdVal;

        const toolName = event["tool"] as string | undefined;
        const filePath = (event["file"] ?? event["path"]) as string | undefined;
        if (filePath && !filesSet.has(filePath)) {
          filesSet.add(filePath);
          filesChanged.push({
            path: filePath,
            added: (event["added"] as number) ?? 0,
            deleted: (event["deleted"] as number) ?? 0,
            repo: cwd,
            change_type: toolName,
          });
        }
      }
      });
      if (!cwd) {
        cwd = cwdFromProjectTranscriptPath(transcriptSourcePath);
      }
      if (!cwd) {
        cwd = resolveChatProjectHashToCwd(sessionId);
      }
      logCursorCli(opts, `Conversation ${convId}: changed files=${filesChanged.length}, cwd=${cwd || "(none)"}.`);

      // Build model usage — cursor CLI doesn't expose per-request tokens
      // Use model from metadata
      const model = meta.model || "unknown";
      const estimate = timed(opts, `Estimate Cursor CLI token usage ${convId}`, () =>
        estimateTokensFromMessages(messages)
      );

      const modelEntry: ModelUsageEntry = {
        api_calls: 0,
        input_tokens: estimate.inputTokens,
        output_tokens: estimate.outputTokens,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cost: calculateCost(model, {
          input_tokens: estimate.inputTokens,
          output_tokens: estimate.outputTokens,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        }) ?? 0,
        currency: COST_CURRENCY,
        token_source: "char-based estimate (API unavailable)",
        note: `chars/${CHARS_PER_TOKEN} estimate (user->input, assistant->output)`,
      };

      const modelUsage: Record<string, ModelUsageEntry> = { [model]: modelEntry };

      const usageBucket: UsageBucket = {
        ...modelEntry,
        model,
        speed: "standard",
        service_tier: "standard",
        effort: "default",
        agents: ["cursor"],
      };

      const usageBreakdown: UsageBucket[] = [usageBucket];

      const reposTouched: RepoTouched[] = cwd
        ? [{ repo: cwd, files: filesChanged.length, added: 0, deleted: 0 }]
        : [];

      const linesAdded = filesChanged.reduce((s, f) => s + (f.added ?? 0), 0);
      const linesDeleted = filesChanged.reduce((s, f) => s + (f.deleted ?? 0), 0);

      // Time range
      let timeDisplay = "unknown";
      let startLocal: string | undefined;
      const firstEventTs = firstTs as Date | null;
      const lastEventTs = lastTs as Date | null;
      if (firstEventTs && lastEventTs) {
        timeDisplay = `${formatLocalTime(firstEventTs)} - ${formatLocalTime(lastEventTs)}`;
        startLocal = firstEventTs.toISOString();
      } else if (meta.createdAt) {
        const created = new Date(meta.createdAt);
        timeDisplay = formatLocalTime(created);
        startLocal = created.toISOString();
      }

      const sessionName = meta.sessionName || convId.slice(0, 8);
      const humanInputs = timed(opts, `Build Cursor CLI human inputs ${convId}`, () =>
        buildHumanInputsFromMessages(messages, sessionName, model)
      );
      timed(opts, `Attribute Cursor CLI file changes ${convId}`, () =>
        attributeFileChangesToHumanInputs(humanInputs, fileEvents)
      );

      timed(opts, `Build Cursor CLI session payload ${convId}`, () => sessions.push({
        schema: "2.0",
        date: filterDate,
        agent: "cursor-cli",
        session_id: convId,
        session_name: sessionName,
        project: sessionId,
        cwd,
        time_range: {
          display: timeDisplay,
          timezone: getLocalTimezone(),
          start: startLocal,
        },
        model_usage: modelUsage,
        usage_breakdown: usageBreakdown,
        files_changed: filesChanged.length,
        files_added: linesAdded > 0 ? linesAdded : undefined,
        files_deleted: linesDeleted > 0 ? linesDeleted : undefined,
        repos_touched: reposTouched,
        message_stats: {
          user: userCount,
          assistant: assistantCount,
          tool_calls: toolCallCount,
        },
        human_inputs: humanInputs.length > 0 ? humanInputs : undefined,
      }));
      logCursorCli(opts, `Collected Cursor CLI conversation ${convId}: users=${userCount}, assistants=${assistantCount}, tool_calls=${toolCallCount}.`);
    }
  }

  logCursorCli(opts, `Collected ${sessions.length} Cursor CLI session(s).`);
  return sessions;
}
