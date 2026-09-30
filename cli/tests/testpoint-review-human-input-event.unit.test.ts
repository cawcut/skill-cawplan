import {afterEach, beforeEach, describe, expect, test} from "vitest";
import {mkdtempSync, readFileSync, readdirSync, rmSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";
import {
  buildTestPointReviewHumanInputEvent,
  humanInputSessionRefs,
  projectTestPointReviewHumanInput,
  tryRecordTestPointReviewHumanInput,
} from "../src/lib/testpoint-review/human-input-event.js";

describe("TestPoint Review Human Input projection and writer", () => {
  let dir: string;
  let oldDir: string | undefined;
  let oldCodex: string | undefined;
  let oldThread: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qa-human-input-writer-"));
    oldDir = process.env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR;
    oldCodex = process.env.CODEX_SESSION_ID;
    oldThread = process.env.CODEX_THREAD_ID;
    process.env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR = dir;
    process.env.CODEX_SESSION_ID = "session-1";
    delete process.env.CODEX_THREAD_ID;
  });

  afterEach(() => {
    if (oldDir === undefined) delete process.env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR;
    else process.env.CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR = oldDir;
    if (oldCodex === undefined) delete process.env.CODEX_SESSION_ID;
    else process.env.CODEX_SESSION_ID = oldCodex;
    if (oldThread === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = oldThread;
    rmSync(dir, {recursive: true, force: true});
  });

  test("projects ordered edit/comment/delete/add/overall units without exposing test point ids", () => {
    const state = createFixtureReviewState({productId: "p", requirementId: "r"});
    state.test_points[0].current.title = "修改后";
    state.test_points[0].status = "edited";
    state.test_points[0].comments.push({id: "comment-1", text: "补并发", author: "qa", resolved: false});
    state.test_points[1].status = "deleted";
    state.test_points.push({
      id: "tp_999",
      original: {title: "新增", group: "g", tags: ["b", "a"], priority: "LOW"},
      current: {title: "新增", group: "g", tags: ["b", "a"], priority: "LOW"},
      round_baseline: null,
      status: "added",
      source: "qa",
      ai_status: "none",
      comments: [],
    });
    state.global_comments.push({id: "overall-1", text: "整体反馈", author: "qa", resolved: false});

    const units = projectTestPointReviewHumanInput(state, "optimize");
    expect(units.map((entry) => entry.kind)).toEqual(["edit", "comment", "delete", "add", "overall_feedback"]);
    expect(units[0].content).toMatch(/^\[Edit Test Point\]\nOriginal: \{.*\}\nUpdated: \{.*\}$/);
    expect(units[1].content).toMatch(/^\[Comment Test Point\]\nTest Point: \{.*\}\nComment: 补并发$/);
    expect(units[2].content).toMatch(/^\[Delete Test Point\]\nOriginal: \{.*\}$/);
    expect(units[3].content).toMatch(/^\[Add Test Point\]\nContent: \{.*\}$/);
    expect(units[4].content).toBe("[Overall Feedback]\nContent: 整体反馈");
    expect(units.map((entry) => entry.content).join("\n")).not.toContain("tp_999");
    expect(units[3].content).toContain('"tags":["b","a"]');
    expect(projectTestPointReviewHumanInput(state, "save").map((entry) => entry.kind)).toEqual(["edit", "delete", "add"]);
  });

  test("suppresses net-zero edits, QA add-then-delete, AI additions, archived points, and resolved feedback", () => {
    const state = createFixtureReviewState({productId: "p", requirementId: "r"});
    state.test_points[0].status = "edited";
    state.test_points[1].archived = true;
    state.test_points[1].status = "deleted";
    state.test_points[2].status = "added";
    state.test_points[2].source = "ai";
    state.test_points[2].comments.push({id: "c", text: "done", author: "qa", resolved: true});
    state.test_points.push({
      id: "tp_4",
      original: {title: "x", group: "", tags: [], priority: ""},
      current: {title: "x", group: "", tags: [], priority: ""},
      round_baseline: null,
      status: "deleted",
      source: "qa",
      ai_status: "none",
      comments: [],
    });
    expect(projectTestPointReviewHumanInput(state, "optimize")).toEqual([]);
  });

  test("uses English labels and ASCII separators for English reviews", () => {
    const state = createFixtureReviewState({productId: "p", requirementId: "r", language: "en"});
    state.test_points[0].status = "edited";
    state.test_points[0].current.title = "updated";
    expect(projectTestPointReviewHumanInput(state, "save")[0].content).toMatch(
      /^\[Edit Test Point\]\nOriginal: \{.*\}\nUpdated: \{.*\}$/,
    );
  });

  test("keeps unit ids across actions, changes event ids, and includes round in unit ids", () => {
    const state = createFixtureReviewState({productId: "p", requirementId: "r"});
    state.test_points[0].status = "edited";
    state.test_points[0].current.title = "changed";
    const optimizeUnits = projectTestPointReviewHumanInput(state, "optimize");
    const saveUnits = projectTestPointReviewHumanInput(state, "save");
    const refs = humanInputSessionRefs({CODEX_SESSION_ID: "s"});
    const first = buildTestPointReviewHumanInputEvent(state, "optimize", optimizeUnits, refs, new Date("2026-09-24T01:00:00Z"));
    const later = buildTestPointReviewHumanInputEvent(state, "optimize", optimizeUnits, refs, new Date("2026-09-24T02:00:00Z"));
    const save = buildTestPointReviewHumanInputEvent(state, "save", saveUnits, refs, new Date("2026-09-24T01:00:00Z"));
    expect(first.event_id).toBe(later.event_id);
    expect(first.event_id).not.toBe(save.event_id);
    expect(optimizeUnits[0].unit_id).toBe(saveUnits[0].unit_id);
    state.round++;
    expect(projectTestPointReviewHumanInput(state, "save")[0].unit_id).not.toBe(saveUnits[0].unit_id);
  });

  test("writes append-only JSONL with restricted permissions and de-duplicates session candidates", () => {
    const state = createFixtureReviewState({productId: "p", requirementId: "r"});
    state.test_points[0].status = "edited";
    state.test_points[0].current.title = "changed";
    process.env.CODEX_THREAD_ID = "session-1";
    expect(humanInputSessionRefs().map((ref) => ref.session_id)).toEqual(["session-1"]);

    expect(tryRecordTestPointReviewHumanInput(state, "save").status).toBe("written");
    expect(tryRecordTestPointReviewHumanInput(state, "save").status).toBe("written");
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const path = join(dir, files[0]);
    const rows = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((row) => JSON.parse(row));
    expect(rows).toHaveLength(2);
    expect(rows[0].event_id).toBe(rows[1].event_id);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("legacy, empty, missing-session, and invalid baseline paths never throw", () => {
    const state = createFixtureReviewState({productId: "p", requirementId: "r"});
    delete state.human_input_event_version;
    expect(tryRecordTestPointReviewHumanInput(state, "save")).toEqual({status: "skipped_legacy"});
    state.human_input_event_version = 1;
    expect(tryRecordTestPointReviewHumanInput(state, "save")).toEqual({status: "skipped_empty"});
    state.test_points[0].status = "edited";
    state.test_points[0].current.title = "changed";
    delete process.env.CODEX_SESSION_ID;
    expect(tryRecordTestPointReviewHumanInput(state, "save")).toEqual({status: "skipped_no_session"});
    delete state.test_points[0].round_baseline;
    expect(tryRecordTestPointReviewHumanInput(state, "save").status).toBe("failed");
  });
});
