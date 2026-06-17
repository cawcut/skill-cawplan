import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { cursorChatsDir } from "../paths.js";
import {
  formatLocalTime,
  getLocalTimezone,
  localDateString,
} from "../date-utils.js";

const require = createRequire(import.meta.url);
import { SessionData, FileChange, RepoTouched, UsageBucket, ModelUsageEntry } from "../types.js";
import { calculateCost, getCurrency } from "../pricing.js";

const CHARS_PER_TOKEN = 4;

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
  timestamp?: number;
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });

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
        .get() as { value: Buffer } | undefined;

      if (!row?.value) return { sessionName: "", model: "" };

      // Try to extract JSON from the blob
      const messages = extractJsonFromBlob(row.value);
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
        const parsed = JSON.parse(row.value.toString("utf-8")) as Record<string, unknown>;
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });

    try {
      const seenContent = new Set<string>();
      try {
        const dataRows = db
          .prepare("SELECT id, data FROM blobs WHERE length(data) > 100 ORDER BY rowid")
          .all() as Array<{ id: string; data: Buffer }>;

        for (const row of dataRows) {
          if (!row.data?.includes(Buffer.from('"role"'))) continue;
          const extracted = extractJsonFromBlob(row.data);
          for (const msg of extracted) {
            if (msg["role"] !== "user" && msg["role"] !== "assistant") continue;
            const dedupKey = JSON.stringify(msg["content"] ?? "");
            if (seenContent.has(dedupKey)) continue;
            seenContent.add(dedupKey);
            messages.push({
              role: msg["role"] as "user" | "assistant",
              content: msg["content"] ?? "",
              timestamp: msg["timestamp"] as number | undefined,
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
        .all() as Array<{ key: string; value: Buffer }>;

      for (const row of rows) {
        if (!row.value) continue;
        const extracted = extractJsonFromBlob(row.value);
        for (const msg of extracted) {
          if (msg["role"] === "user" || msg["role"] === "assistant") {
            messages.push({
              role: msg["role"] as "user" | "assistant",
              content: msg["content"] ?? "",
              timestamp: msg["timestamp"] as number | undefined,
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

/**
 * Collect Cursor CLI sessions from ~/.cursor/chats/ for a given date.
 */
export function collectCursorCliSessions(filterDate: string): SessionData[] {
  const chatsDir = cursorChatsDir();
  if (!existsSync(chatsDir)) return [];

  const sessions: SessionData[] = [];

  let sessionDirs: string[] = [];
  try {
    sessionDirs = readdirSync(chatsDir);
  } catch {
    return sessions;
  }

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
      convDirs = readdirSync(sessionPath);
    } catch {
      continue;
    }

    for (const convId of convDirs) {
      const convPath = join(sessionPath, convId);
      try {
        if (!statSync(convPath).isDirectory()) continue;
      } catch {
        continue;
      }

      const storeDbPath = join(convPath, "store.db");
      if (!existsSync(storeDbPath)) continue;

      // Check for agent-transcript JSONL
      const transcriptPath = join(convPath, "agent-transcript.jsonl");
      const transcriptEvents = readTranscriptJsonl(transcriptPath);

      // Filter by date — check transcript timestamps
      let hasActivityOnDate = false;
      let firstTs: Date | null = null;
      let lastTs: Date | null = null;

      for (const event of transcriptEvents) {
        const ts = (event["timestamp"] ?? event["ts"]) as string | number | undefined;
        if (!ts) continue;
        const d = new Date(typeof ts === "number" ? ts : ts);
        if (isNaN(d.getTime())) continue;

        const eventDate = localDateString(d);
        if (eventDate === filterDate) {
          hasActivityOnDate = true;
          if (!firstTs || d < firstTs) firstTs = d;
          if (!lastTs || d > lastTs) lastTs = d;
        }
      }

      // If no transcript, check store.db creation/modification time
      if (!hasActivityOnDate && transcriptEvents.length === 0) {
        try {
          const stat = statSync(storeDbPath);
          const mtime = localDateString(stat.mtime);
          if (mtime === filterDate) {
            hasActivityOnDate = true;
          }
        } catch {
          // ignore
        }
      }

      if (!hasActivityOnDate) continue;

      // Read session metadata
      const meta = readStoreMeta(storeDbPath);
      const messages = readStoreMessages(storeDbPath);

      // Count message stats
      let userCount = 0;
      let assistantCount = 0;
      let toolCallCount = 0;

      for (const msg of messages) {
        if (msg.role === "user") userCount++;
        else if (msg.role === "assistant") {
          assistantCount++;
          if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
            toolCallCount += msg.toolCalls.length;
          }
        }
      }

      // Extract file changes from transcript tool calls
      const filesChanged: FileChange[] = [];
      const filesSet = new Set<string>();
      let cwd = "";

      for (const event of transcriptEvents) {
        const cwdVal = event["cwd"] as string | undefined;
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

      // Build model usage — cursor CLI doesn't expose per-request tokens
      // Use model from metadata
      const model = meta.model || "unknown";
      const currency = getCurrency(model);
      const estimate = estimateTokensFromMessages(messages);

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
        currency,
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
      if (firstTs && lastTs) {
        timeDisplay = `${formatLocalTime(firstTs)} - ${formatLocalTime(lastTs)}`;
        startLocal = firstTs.toISOString();
      } else if (meta.createdAt) {
        const created = new Date(meta.createdAt);
        timeDisplay = formatLocalTime(created);
        startLocal = created.toISOString();
      }

      const sessionName = meta.sessionName || convId.slice(0, 8);

      sessions.push({
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
          start_local: startLocal,
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
      });
    }
  }

  return sessions;
}
