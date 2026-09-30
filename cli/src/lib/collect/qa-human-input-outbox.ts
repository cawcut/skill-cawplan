import {readFileSync, readdirSync, unlinkSync} from "node:fs";
import {join} from "node:path";
import {qaHumanInputOutboxDir, type TestPointReviewHumanInputEvent} from "../testpoint-review/human-input-event.js";
import type {HumanInput, SessionData} from "./types.js";

export interface QaHumanInputOutboxOptions {
  dir?: string;
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
      unit.kind === "comment" || unit.kind === "overall_feedback") &&
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

/** Mutates scanned sessions by appending uniquely-attributed HTML Review Human Inputs. */
export function mergeQaHumanInputOutbox(
  sessions: SessionData[],
  date: string,
  options: QaHumanInputOutboxOptions = {},
): void {
  const events = readQaHumanInputOutbox(date, options);
  const seenUnitIds = new Set<string>();
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

    const input: HumanInput = {
      category: "correction",
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
