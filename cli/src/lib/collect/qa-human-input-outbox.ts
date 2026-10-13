import {readFileSync, readdirSync, unlinkSync} from "node:fs";
import {join} from "node:path";
import {qaHumanInputOutboxDir, type TestPointReviewHumanInputEvent} from "../testpoint-review/human-input-event.js";
import {parseEvents} from "./agents/claude-code.js";
import {extractTextContent, isHumanInputText, rolloutFilesForDate, stripCodexSkillBlocks} from "./agents/codex.js";
import {codexSessionsDir} from "./paths.js";
import {appendAssistantMessage, extractAssistantTextFromBlocks} from "./aggregators/human-assistant.js";
import {findClaudeCodeJsonlPathBySessionId} from "./qa-trace-extract.js";
import type {HumanInput, SessionData} from "./types.js";

export interface QaHumanInputOutboxOptions {
  dir?: string;
  /** Test seam: resolves a Claude Code session's JSONL path. */
  findClaudeJsonlPath?: (sessionId: string, date: string) => string | undefined;
  /** Test seam: resolves a Codex session's rollout JSONL path. */
  findCodexRolloutPath?: (sessionId: string, date: string) => string | undefined;
  warn?: (message: string) => void;
}

type ParsedEvent = {event: TestPointReviewHumanInputEvent; line: number};

function warning(options: QaHumanInputOutboxOptions, message: string): void {
  (options.warn ?? console.warn)(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidEvent(value: unknown): value is TestPointReviewHumanInputEvent {
  if (!isPlainObject(value)) return false;
  if (value.schema !== "cawplan.qa-human-input-event/1" || value.event_type !== "testpoint_review_submit") return false;
  if (value.action !== "optimize" && value.action !== "save") return false;
  for (const key of [
    "event_id", "occurred_at", "local_date", "timezone", "review_id",
    "product_id", "requirement_id", "state_updated_at",
  ] as const) {
    if (typeof value[key] !== "string" || value[key].length === 0) return false;
  }
  if (typeof value.event_id !== "string" || !value.event_id.startsWith("hie_")) return false;
  if (typeof value.local_date !== "string" || !isValidDateString(value.local_date)) return false;
  if (!Number.isInteger(value.round) || (value.round as number) < 1) return false;
  if (typeof value.occurred_at !== "string" || Number.isNaN(Date.parse(value.occurred_at))) return false;
  if (typeof value.state_updated_at !== "string" || Number.isNaN(Date.parse(value.state_updated_at))) return false;
  if (!Array.isArray(value.session_refs) || value.session_refs.length === 0) return false;
  if (!value.session_refs.every((ref) =>
    isPlainObject(ref) &&
    (ref.agent === "claude-code" || ref.agent === "codex") &&
    typeof ref.session_id === "string" && ref.session_id.length > 0 &&
    (ref.source === "CLAUDE_CODE_SESSION_ID" || ref.source === "CODEX_SESSION_ID" || ref.source === "CODEX_THREAD_ID")
  )) return false;
  if (!Array.isArray(value.units) || value.units.length === 0) return false;
  return value.units.every((unit) =>
    isPlainObject(unit) &&
    typeof unit.unit_id === "string" && unit.unit_id.startsWith("hiu_") &&
    (unit.kind === "edit" || unit.kind === "delete" || unit.kind === "add" ||
      unit.kind === "comment" || unit.kind === "overall_feedback" || unit.kind === "answer_question") &&
    typeof unit.content === "string" && unit.content.length > 0
  );
}

export function readQaHumanInputOutbox(
  date: string,
  options: QaHumanInputOutboxOptions = {},
): ParsedEvent[] {
  const path = join(options.dir ?? qaHumanInputOutboxDir(), `${date}.jsonl`);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warning(options, "Warning: QA Human Input outbox could not be read; QA collection continues.");
    }
    return [];
  }

  const byEventId = new Map<string, ParsedEvent>();
  raw.split(/\r?\n/).forEach((lineText, index) => {
    if (!lineText.trim()) return;
    const line = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(lineText);
    } catch {
      warning(options, `Warning: QA Human Input outbox line ${line} was skipped; QA collection continues.`);
      return;
    }
    if (!isValidEvent(parsed) || parsed.local_date !== date) {
      warning(options, `Warning: QA Human Input outbox line ${line} was skipped; QA collection continues.`);
      return;
    }
    if (!byEventId.has(parsed.event_id)) byEventId.set(parsed.event_id, {event: parsed, line});
  });

  return [...byEventId.values()].sort((a, b) =>
    a.event.occurred_at.localeCompare(b.event.occurred_at) || a.line - b.line
  );
}

function eventSession(event: TestPointReviewHumanInputEvent, sessions: SessionData[]): SessionData | undefined {
  const matches = new Set<SessionData>();
  for (const ref of event.session_refs) {
    for (const session of sessions) {
      if (session.agent === ref.agent && session.session_id === ref.session_id) matches.add(session);
    }
  }
  return matches.size === 1 ? [...matches][0] : undefined;
}

const REVIEW_ANCHOR_MAX_LAG_MS = 5000;

type TraceEvent = Record<string, unknown>;

/** Agent-specific view of a transcript: where a Review submit shows up, and what counts as a turn/reply. */
interface ReplyTrace {
  events: TraceEvent[];
  /** Indexes of events marking a Review submit having been received. */
  anchors: number[];
  used: Set<number>;
  isHumanTurn(event: TraceEvent): boolean;
  assistantText(event: TraceEvent): string;
}

function contentBlocks(event: TraceEvent): Array<Record<string, any>> {
  const content = (event["message"] as {content?: unknown} | undefined)?.content;
  return Array.isArray(content) ? content : [];
}

/**
 * Claude: a Review submit has no human turn; its only trace is the `task-notification`
 * fired when the page-backed `testpoint-review open` background task ends.
 */
function claudeTrace(events: TraceEvent[]): ReplyTrace {
  const toolIds = new Set<string>();
  const tasks = new Set<string>();
  for (const event of events) {
    if (event["type"] === "assistant") {
      for (const block of contentBlocks(event)) {
        if (block.type === "tool_use" && block.name === "Bash"
          && block.input?.run_in_background === true
          && typeof block.input.command === "string"
          && /\bqa-insights\s+testpoint-review\s+open\b/.test(block.input.command)) {
          toolIds.add(block.id);
        }
      }
    } else if (event["type"] === "user") {
      const taskId = (event["toolUseResult"] as {backgroundTaskId?: unknown} | undefined)?.backgroundTaskId;
      if (typeof taskId === "string"
        && contentBlocks(event).some((b) => b.type === "tool_result" && toolIds.has(b.tool_use_id))) {
        tasks.add(taskId);
      }
    }
  }
  const anchors: number[] = [];
  events.forEach((event, index) => {
    const content = (event["message"] as {content?: unknown} | undefined)?.content;
    if (event["type"] !== "user" || typeof content !== "string" || !content.startsWith("<task-notification>")) return;
    const taskId = /<task-id>([^<]+)<\/task-id>/.exec(content)?.[1];
    if (taskId && tasks.has(taskId)) anchors.push(index);
  });
  return {
    events, anchors, used: new Set(),
    isHumanTurn(event) {
      if (event["type"] !== "user" || event["isSidechain"] === true || event["isMeta"] === true) return false;
      const kind = (event["origin"] as {kind?: unknown} | undefined)?.kind;
      if (typeof kind === "string" && kind !== "human") return false;
      const content = (event["message"] as {content?: unknown} | undefined)?.content;
      return typeof content === "string" || contentBlocks(event).some((b) => b.type === "text");
    },
    assistantText(event) {
      if (event["type"] !== "assistant" || event["isSidechain"] === true) return "";
      return extractAssistantTextFromBlocks((event["message"] as {content?: unknown} | undefined)?.content);
    },
  };
}

const CODEX_REVIEW_EVENT_RE = /TESTPOINT_REVIEW_EVENT (?:optimize_requested|save_completed)/;

/**
 * Codex: the page-backed command's output carries `TESTPOINT_REVIEW_EVENT <action>`;
 * its first emission is the `item_completed` event_msg (later `write_stdin` re-reads
 * of the same output are response_items and are not anchors).
 */
function codexTrace(events: TraceEvent[]): ReplyTrace {
  const payload = (event: TraceEvent) => event["payload"] as Record<string, unknown> | undefined;
  const anchors: number[] = [];
  events.forEach((event, index) => {
    const p = payload(event);
    if (event["type"] === "event_msg" && p?.["type"] === "item_completed" && CODEX_REVIEW_EVENT_RE.test(JSON.stringify(p))) {
      anchors.push(index);
    }
  });
  const message = (event: TraceEvent, role: string) => {
    const p = payload(event);
    return event["type"] === "response_item" && p?.["type"] === "message" && p["role"] === role ? p : undefined;
  };
  return {
    events, anchors, used: new Set(),
    isHumanTurn(event) {
      const p = message(event, "user");
      if (!p) return false;
      const text = stripCodexSkillBlocks(extractTextContent(p["content"]));
      return !!text && isHumanInputText(text);
    },
    assistantText(event) {
      const p = message(event, "assistant");
      return p ? extractTextContent(p["content"]) : "";
    },
  };
}

function codexRolloutPath(sessionId: string, date: string): string | undefined {
  return rolloutFilesForDate(codexSessionsDir(), date).find((file) => file.endsWith(`-${sessionId}.jsonl`));
}

/**
 * The AI reply is the assistant text between the nearest unused anchor after
 * `occurred_at` and the next human turn / anchor. Returns undefined (never a guess)
 * when no anchor or no reply text exists.
 */
function assistantReplyForReviewSubmit(trace: ReplyTrace, occurredAt: string): string | undefined {
  const occurredMs = Date.parse(occurredAt);
  let anchor: number | undefined;
  let bestLag = Infinity;
  for (const index of trace.anchors) {
    if (trace.used.has(index)) continue;
    const lag = Date.parse(String(trace.events[index]["timestamp"] ?? "")) - occurredMs;
    if (lag >= -1000 && lag <= REVIEW_ANCHOR_MAX_LAG_MS && lag < bestLag) {
      anchor = index;
      bestLag = lag;
    }
  }
  if (anchor === undefined) return undefined;
  trace.used.add(anchor);

  let reply: string | undefined;
  for (let i = anchor + 1; i < trace.events.length; i++) {
    const ev = trace.events[i];
    if (trace.anchors.includes(i) || trace.isHumanTurn(ev)) break;
    const text = trace.assistantText(ev);
    if (text) reply = appendAssistantMessage(reply, text);
  }
  return reply;
}

/** Mutates scanned sessions by appending uniquely-attributed HTML Review Human Inputs. */
export function mergeQaHumanInputOutbox(
  sessions: SessionData[],
  date: string,
  options: QaHumanInputOutboxOptions = {},
): void {
  const events = readQaHumanInputOutbox(date, options);
  const seenUnitIds = new Set<string>();
  const traces = new Map<string, ReplyTrace | null>();
  const traceFor = (agent: string, sessionId: string): ReplyTrace | null => {
    const key = `${agent}:${sessionId}`;
    if (!traces.has(key)) {
      let trace: ReplyTrace | null = null;
      try {
        if (agent === "claude-code") {
          const path = (options.findClaudeJsonlPath ?? findClaudeCodeJsonlPathBySessionId)(sessionId, date);
          if (path) trace = claudeTrace(parseEvents(path));
        } else if (agent === "codex") {
          const path = (options.findCodexRolloutPath ?? codexRolloutPath)(sessionId, date);
          if (path) trace = codexTrace(parseEvents(path));
        }
      } catch {
        trace = null;
      }
      traces.set(key, trace);
    }
    return traces.get(key) ?? null;
  };
  for (const {event, line} of events) {
    const matched = eventSession(event, sessions);
    if (!matched) {
      warning(options, `Warning: QA Human Input outbox event on line ${line} could not be uniquely matched; QA collection continues.`);
      continue;
    }

    const remainingUnits = event.units.filter((entry) => {
      if (seenUnitIds.has(entry.unit_id)) return false;
      seenUnitIds.add(entry.unit_id);
      return true;
    });
    if (remainingUnits.length === 0) continue;

    const trace = traceFor(matched.agent, matched.session_id);
    const assistantMessage = trace ? assistantReplyForReviewSubmit(trace, event.occurred_at) : undefined;

    const input: HumanInput = {
      category: "correction",
      ...(assistantMessage ? {assistant_message: assistantMessage} : {}),
      content: remainingUnits.map((entry) => entry.content).join("\n\n"),
      session_id: matched.session_id,
      session_agent: matched.agent,
      start_time: event.occurred_at,
      end_time: event.occurred_at,
      time_precision: "exact",
    };
    matched.human_inputs = [...(matched.human_inputs ?? []), input].sort((a, b) =>
      String(a.start_time ?? "").localeCompare(String(b.start_time ?? ""))
    );
  }
}

function dateString(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export interface CleanupQaHumanInputOutboxOptions extends QaHumanInputOutboxOptions {
  now?: Date;
  retentionDays?: number;
}

/** Best-effort deletion of valid, regular outbox date files older than the retention window. */
export function cleanupQaHumanInputOutbox(options: CleanupQaHumanInputOutboxOptions = {}): void {
  const dir = options.dir ?? qaHumanInputOutboxDir();
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? 30;
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  cutoff.setDate(cutoff.getDate() - Math.max(1, retentionDays) + 1);
  const cutoffDate = dateString(cutoff);
  let entries;
  try {
    entries = readdirSync(dir, {withFileTypes: true});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warning(options, "Warning: Some expired QA Human Input outbox files could not be cleaned up; QA collection continues.");
    }
    return;
  }

  let hadFailure = false;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(entry.name);
    if (!match || !isValidDateString(match[1]) || match[1] >= cutoffDate) continue;
    try {
      unlinkSync(join(dir, entry.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") hadFailure = true;
    }
  }
  if (hadFailure) {
    warning(options, "Warning: Some expired QA Human Input outbox files could not be cleaned up; QA collection continues.");
  }
}
