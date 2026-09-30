import {createHash} from "node:crypto";
import {chmodSync, closeSync, fsyncSync, mkdirSync, openSync, writeSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import type {ReviewState, TestPointFields} from "./types.js";

export type TestPointReviewHumanInputAction = "optimize" | "save";
export type HumanInputUnitKind = "edit" | "delete" | "add" | "comment" | "overall_feedback";

export interface HumanInputEventUnit {
  unit_id: string;
  kind: HumanInputUnitKind;
  content: string;
}

export interface HumanInputSessionRef {
  agent: "claude-code" | "codex";
  session_id: string;
  source: "CLAUDE_CODE_SESSION_ID" | "CODEX_SESSION_ID" | "CODEX_THREAD_ID";
}

export interface TestPointReviewHumanInputEvent {
  schema: "cawplan.qa-human-input-event/1";
  event_id: string;
  event_type: "testpoint_review_submit";
  action: TestPointReviewHumanInputAction;
  occurred_at: string;
  local_date: string;
  timezone: string;
  session_refs: HumanInputSessionRef[];
  review_id: string;
  round: number;
  product_id: string;
  requirement_id: string;
  state_updated_at: string;
  units: HumanInputEventUnit[];
}

export type RecordHumanInputResult =
  | {status: "written"; eventId: string}
  | {status: "skipped_legacy" | "skipped_empty" | "skipped_no_session"}
  | {status: "failed"; reason: string};

function sha256(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function canonicalFields(fields: TestPointFields): TestPointFields {
  return {
    title: fields.title,
    group: fields.group,
    tags: [...fields.tags],
    priority: fields.priority,
  };
}

function fieldsEqual(a: TestPointFields, b: TestPointFields): boolean {
  return JSON.stringify(canonicalFields(a)) === JSON.stringify(canonicalFields(b));
}

function unit(
  state: ReviewState,
  kind: HumanInputUnitKind,
  targetId: string,
  canonicalPayload: unknown,
  content: string,
): HumanInputEventUnit {
  return {
    unit_id: `hiu_${sha256([state.review_id, state.round, kind, targetId, canonicalPayload])}`,
    kind,
    content,
  };
}

function fieldJson(fields: TestPointFields): string {
  return JSON.stringify(canonicalFields(fields));
}

function labels(state: ReviewState): {
  original: string;
  updated: string;
  content: string;
  testPoint: string;
  comment: string;
  separator: string;
} {
  return state.language === "en"
    ? {original: "Original", updated: "Updated", content: "Content", testPoint: "Test Point", comment: "Comment", separator: ": "}
    : {original: "Original", updated: "Updated", content: "Content", testPoint: "Test Point", comment: "Comment", separator: ": "};
}

/** Pure projection of one page action. Throws only for an internally-invalid enabled Review. */
export function projectTestPointReviewHumanInput(
  state: ReviewState,
  action: TestPointReviewHumanInputAction,
): HumanInputEventUnit[] {
  if (state.human_input_event_version !== 1) return [];

  const text = labels(state);
  const units: HumanInputEventUnit[] = [];
  for (const testPoint of state.test_points) {
    if (testPoint.archived === true) continue;

    if ((testPoint.status === "edited" || testPoint.status === "deleted") && testPoint.round_baseline === undefined) {
      throw new Error("missing_round_baseline");
    }
    if (testPoint.status === "added" && testPoint.source === "qa" && testPoint.round_baseline !== null) {
      throw new Error("invalid_qa_added_round_baseline");
    }

    const baseline = testPoint.round_baseline;
    const current = canonicalFields(testPoint.current);
    if (testPoint.status === "edited" && baseline && !fieldsEqual(baseline, current)) {
      const before = canonicalFields(baseline);
      units.push(unit(
        state,
        "edit",
        testPoint.id,
        {before, after: current},
        `[Edit Test Point]\n${text.original}${text.separator}${fieldJson(before)}\n${text.updated}${text.separator}${fieldJson(current)}`,
      ));
    } else if (testPoint.status === "deleted" && baseline) {
      const before = canonicalFields(baseline);
      units.push(unit(
        state,
        "delete",
        testPoint.id,
        {before},
        `[Delete Test Point]\n${text.original}${text.separator}${fieldJson(before)}`,
      ));
    } else if (testPoint.status === "added" && testPoint.source === "qa" && baseline === null) {
      units.push(unit(
        state,
        "add",
        testPoint.id,
        {after: current},
        `[Add Test Point]\n${text.content}${text.separator}${fieldJson(current)}`,
      ));
    }

    if (action === "optimize") {
      for (const comment of testPoint.comments) {
        if (comment.author !== "qa" || comment.resolved) continue;
        units.push(unit(
          state,
          "comment",
          comment.id,
          {test_point: current, comment: comment.text},
          `[Comment Test Point]\n${text.testPoint}${text.separator}${fieldJson(current)}\n${text.comment}${text.separator}${comment.text}`,
        ));
      }
    }
  }

  if (action === "optimize") {
    for (const comment of state.global_comments) {
      if (comment.author !== "qa" || comment.resolved) continue;
      units.push(unit(
        state,
        "overall_feedback",
        comment.id,
        {comment: comment.text},
        `[Overall Feedback]\n${text.content}${text.separator}${comment.text}`,
      ));
    }
  }
  return units;
}

export function humanInputSessionRefs(env: NodeJS.ProcessEnv = process.env): HumanInputSessionRef[] {
  const candidates: HumanInputSessionRef[] = [];
  const add = (agent: HumanInputSessionRef["agent"], source: HumanInputSessionRef["source"]) => {
    const sessionId = env[source]?.trim();
    if (sessionId) candidates.push({agent, session_id: sessionId, source});
  };
  add("claude-code", "CLAUDE_CODE_SESSION_ID");
  add("codex", "CODEX_SESSION_ID");
  add("codex", "CODEX_THREAD_ID");

  const seen = new Set<string>();
  return candidates.filter((ref) => {
    const key = `${ref.agent}\0${ref.session_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function localDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function qaHumanInputOutboxDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR ?? join(homedir(), ".cawplan", "qa-human-input-events", "v1");
}

export function buildTestPointReviewHumanInputEvent(
  state: ReviewState,
  action: TestPointReviewHumanInputAction,
  units: HumanInputEventUnit[],
  sessionRefs: HumanInputSessionRef[],
  now = new Date(),
): TestPointReviewHumanInputEvent {
  const eventId = `hie_${sha256([state.review_id, state.round, action, units.map((entry) => entry.unit_id)])}`;
  return {
    schema: "cawplan.qa-human-input-event/1",
    event_id: eventId,
    event_type: "testpoint_review_submit",
    action,
    occurred_at: now.toISOString(),
    local_date: localDate(now),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    session_refs: sessionRefs,
    review_id: state.review_id,
    round: state.round,
    product_id: state.product_id,
    requirement_id: state.requirement_id,
    state_updated_at: state.updated_at,
    units,
  };
}

/** Append one event durably. This public boundary never throws. */
export function tryRecordTestPointReviewHumanInput(
  state: ReviewState,
  action: TestPointReviewHumanInputAction,
): RecordHumanInputResult {
  if (state.human_input_event_version !== 1) return {status: "skipped_legacy"};
  try {
    const units = projectTestPointReviewHumanInput(state, action);
    if (units.length === 0) return {status: "skipped_empty"};
    const sessionRefs = humanInputSessionRefs();
    if (sessionRefs.length === 0) return {status: "skipped_no_session"};

    const event = buildTestPointReviewHumanInputEvent(state, action, units, sessionRefs);
    const dir = qaHumanInputOutboxDir();
    mkdirSync(dir, {recursive: true, mode: 0o700});
    chmodSync(dir, 0o700);
    const path = join(dir, `${event.local_date}.jsonl`);
    let fd: number | undefined;
    let failedReason: string | undefined;
    try {
      fd = openSync(path, "a", 0o600);
      chmodSync(path, 0o600);
      writeSync(fd, `\n${JSON.stringify(event)}\n`, undefined, "utf8");
      fsyncSync(fd);
    } catch (error) {
      failedReason = error instanceof Error ? error.name : "write_error";
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch (error) {
          failedReason ??= error instanceof Error ? error.name : "close_error";
        }
      }
    }
    return failedReason
      ? {status: "failed", reason: failedReason}
      : {status: "written", eventId: event.event_id};
  } catch (error) {
    return {status: "failed", reason: error instanceof Error ? error.name : "unknown_error"};
  }
}
