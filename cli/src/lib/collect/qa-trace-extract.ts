import {DatabaseSync} from "node:sqlite";
import {existsSync} from "node:fs";
import {findSessionsByDate, parseEvents} from "./agents/claude-code.js";
import {selectCursorDiskKvByKeyPrefix} from "./agents/cursor-gui.js";
import {cursorStateDbCandidates} from "./paths.js";
import {QaSkillLayer} from "./qa-types.js";

/**
 * QA skill names recognized when reading attributionSkill / command traces.
 * Values outside this list (e.g. cawplan-coding-commit) are ignored for skill_layers.
 * This whitelist identifies skill names only — it is not a session admission gate.
 */
export const QA_SKILLS: readonly QaSkillLayer[] = [
    "cawplan-requirement-analyze",
    "cawplan-testpoint-generate",
    "cawplan-testcase-generate",
];

function isQaSkill(value: unknown): value is QaSkillLayer {
    return typeof value === "string" && (QA_SKILLS as readonly string[]).includes(value);
}

/**
 * Signal 1 — read the top-level attributionSkill key on assistant events
 * (not inside message), whitelist-filter, and dedupe.
 *
 * This path only adds QA trace reading; it does not change coding collect
 * filters or output. It re-parses JSONL independently because scanSessions() /
 * SessionData never capture attributionSkill.
 */
export function layersFromAttributionSkill(jsonlPath: string, date?: string): QaSkillLayer[] {
    const events = parseEvents(jsonlPath, date);
    const found = new Set<QaSkillLayer>();
    for (const event of events) {
        if (event["type"] !== "assistant") continue;
        const skill = event["attributionSkill"];
        if (isQaSkill(skill)) found.add(skill);
    }
    return Array.from(found).sort();
}

/**
 * Locate the local Claude Code JSONL path for a session_id on the given date.
 * Returns undefined when no file exists. Other agents have no equivalent trace
 * source yet — callers include those sessions with skill_layers: [].
 */
export function findClaudeCodeJsonlPathBySessionId(sessionId: string, date: string): string | undefined {
    const refs = findSessionsByDate(date);
    return refs.find((r) => r.sessionId === sessionId)?.jsonlPath;
}

export interface QaCommandTrace {
    /** e.g. "requirements create", "testpoints archive" */
    command: string;
    /** Positional product_id, when the subcommand takes one. */
    productId?: string;
    /** Positional requirement_id, when the subcommand takes one. */
    requirementId?: string;
    /** Inferred skill layer for this command, when known. */
    skillLayer?: QaSkillLayer;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Map "resource verb" CLI subcommands to a skill name. Only write operations
// (create/update/archive) count — requirements get / testpoints list are shared
// read steps used by every QA skill, not a unique signal for one skill layer.
// Including reads falsely tags testcase-only sessions as requirement-analyze.
const RESOURCE_VERB_TO_SKILL: Record<string, QaSkillLayer> = {
    "requirements create": "cawplan-requirement-analyze",
    "requirements update": "cawplan-requirement-analyze",
    "testpoints archive": "cawplan-testpoint-generate",
};

function inferSkillFromCommand(command: string): QaSkillLayer | undefined {
    return RESOURCE_VERB_TO_SKILL[command];
}

/**
 * Signal 2 — parse assistant Bash tool_use blocks for
 * `cawplan qa-insights <resource> <verb> [product_id] [requirement_id] ...`,
 * extract positional UUIDs, and infer skill from the resource/verb pair.
 */
export function tracesFromBashCommand(jsonlPath: string, date?: string): QaCommandTrace[] {
    const events = parseEvents(jsonlPath, date);
    const traces: QaCommandTrace[] = [];

    for (const event of events) {
        if (event["type"] !== "assistant") continue;
        const content = (event["message"] as {content?: unknown[]} | undefined)?.content;
        if (!Array.isArray(content)) continue;

        for (const block of content) {
            const b = block as {type?: string; name?: string; input?: {command?: string}};
            if (b.type !== "tool_use" || b.name !== "Bash") continue;
            const command = b.input?.command;
            if (typeof command !== "string" || !command.includes("qa-insights")) continue;

            const tokens = command.trim().split(/\s+/);
            const qaIdx = tokens.indexOf("qa-insights");
            if (qaIdx === -1 || tokens.length < qaIdx + 3) continue;

            const resource = tokens[qaIdx + 1];
            const verb = tokens[qaIdx + 2];
            const positional: string[] = [];
            for (let i = qaIdx + 3; i < tokens.length; i++) {
                if (tokens[i].startsWith("-")) break;
                if (UUID_RE.test(tokens[i])) positional.push(tokens[i]);
            }

            const commandName = `${resource} ${verb}`;
            traces.push({
                command: commandName,
                productId: positional[0],
                requirementId: positional[1],
                skillLayer: inferSkillFromCommand(commandName),
            });
        }
    }

    return traces;
}

export interface QaStdoutTrace {
    /** e.g. "testpoints archive", "requirements create" */
    command: string;
    outcome: string;
    productId?: string;
    requirementId?: string;
    dryRun?: boolean;
    /** api.data.test_points.length, when present (testpoints archive). */
    landedCount?: number;
    /** reconcile.decision, when present (testpoints/requirements reconcile). */
    reconcileDecision?: string;
    /** reconcile.batch_size, when present. */
    batchSize?: number;
    /** Inferred skill layer for this command, when known. */
    skillLayer?: QaSkillLayer;
}

/**
 * Parses one raw stdout string into a QaStdoutTrace, or undefined when it
 * doesn't contain a structured cawplan qa-insights JSON receipt.
 *
 * Shared core for signal 3 across data sources: Claude Code JSONL
 * (toolUseResult.stdout) and Cursor GUI vscdb (toolFormerData.result.output)
 * both emit the same `cawplan qa-insights ...` receipt shape on stdout — only
 * how the raw string is located differs per source.
 *
 * Template-trap guard: SKILL files inject Chinese receipt boilerplate into user
 * events with wording similar to real receipts. Only structured JSON is parsed;
 * never match on free-text Chinese phrases.
 */
function parseQaStdoutTrace(stdout: string): QaStdoutTrace | undefined {
    // Node emits runtime warnings (e.g. the experimental SQLite notice) on
    // stdout ahead of the CLI's JSON receipt in some environments. Strip
    // any such prefix by slicing from the first '{' so the parse below
    // sees only the JSON object; well-formed stdout is unaffected.
    const jsonStart = stdout.indexOf("{");
    if (jsonStart === -1) return undefined;

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(stdout.slice(jsonStart));
    } catch {
        return undefined;
    }

    const command = parsed["command"];
    const outcome = parsed["outcome"];
    if (typeof command !== "string" || typeof outcome !== "string") return undefined;

    const meta = parsed["meta"] as {product_id?: string; requirement_id?: string; dry_run?: boolean} | undefined;
    const api = parsed["api"] as {data?: {test_points?: unknown[]}} | undefined;
    const reconcile = parsed["reconcile"] as {decision?: string; batch_size?: number} | undefined;

    return {
        command,
        outcome,
        productId: meta?.product_id,
        requirementId: meta?.requirement_id,
        dryRun: meta?.dry_run,
        landedCount: Array.isArray(api?.data?.test_points) ? api!.data!.test_points!.length : undefined,
        reconcileDecision: reconcile?.decision,
        batchSize: reconcile?.batch_size,
        skillLayer: inferSkillFromCommand(command),
    };
}

/**
 * Signal 3 — parse structured JSON from user toolUseResult.stdout
 * (outcome / command / meta / api.data / reconcile). Authoritative source for
 * testpoint.added counts and stdout-derived product_id / requirement_id.
 */
export function tracesFromToolResultStdout(jsonlPath: string, date?: string): QaStdoutTrace[] {
    const events = parseEvents(jsonlPath, date);
    const traces: QaStdoutTrace[] = [];

    for (const event of events) {
        if (event["type"] !== "user") continue;
        const stdout = (event["toolUseResult"] as {stdout?: unknown} | undefined)?.stdout;
        if (typeof stdout !== "string") continue;

        const trace = parseQaStdoutTrace(stdout);
        if (trace) traces.push(trace);
    }

    return traces;
}

/**
 * Union of signals 1–3 (attributionSkill, Bash qa-insights commands, stdout
 * receipts), deduped into the final skill_layers[] for a session.
 */
export function collectSkillLayers(jsonlPath: string, date?: string): QaSkillLayer[] {
    const found = new Set<QaSkillLayer>(layersFromAttributionSkill(jsonlPath, date));
    for (const t of tracesFromBashCommand(jsonlPath, date)) {
        if (t.skillLayer) found.add(t.skillLayer);
    }
    for (const t of tracesFromToolResultStdout(jsonlPath, date)) {
        if (t.skillLayer) found.add(t.skillLayer);
    }
    return Array.from(found).sort();
}

/**
 * Product association, tier 1 (authoritative): the first stdout receipt that
 * carries a product_id, in event order. When a session touches multiple
 * products this yields the primary one (first archived requirement's product).
 * Later mismatched product_ids are not reconciled here — only requirement_ids[]
 * surfaces them for lookup.
 */
export function productIdFromStdoutTraces(jsonlPath: string, date?: string): string | undefined {
    for (const t of tracesFromToolResultStdout(jsonlPath, date)) {
        if (t.productId) return t.productId;
    }
    return undefined;
}

/**
 * Codex signal 3 — same JSON receipt shape as Claude Code's toolUseResult.stdout
 * and Cursor GUI's toolFormerData.result.output, sourced instead from Codex's
 * own rollout JSONL: each `custom_tool_call_output` event's text blocks
 * (collected by agents/codex.ts into SessionData.qa_tool_outputs). Codex has no
 * attributionSkill equivalent (signal 1) and no Bash tool_use blocks to scan
 * (signal 2, its tool name is "exec" with a different input shape) — same
 * signal-3-only fallback as Cursor GUI.
 */
export function tracesFromCodexToolOutputs(outputs: string[]): QaStdoutTrace[] {
    const traces: QaStdoutTrace[] = [];
    for (const output of outputs) {
        const trace = parseQaStdoutTrace(output);
        if (trace) traces.push(trace);
    }
    return traces;
}

/**
 * GUI-only skill_layers source: signal 3 (stdout receipts) only. Cursor GUI
 * has no attributionSkill equivalent (signal 1) and no Bash tool_use blocks
 * to scan (signal 2) — this is intentionally narrower than collectSkillLayers,
 * not a partial/broken copy of it. Do not merge the two.
 */
export function skillLayersFromTraces(traces: QaStdoutTrace[]): QaSkillLayer[] {
    const found = new Set<QaSkillLayer>();
    for (const t of traces) {
        if (t.skillLayer) found.add(t.skillLayer);
    }
    return Array.from(found).sort();
}

interface GuiToolFormerData {
    name?: string;
    result?: unknown;
    additionalData?: {startedAtMs?: number};
}

function toolFormerDataFromBubbleValue(value: string): GuiToolFormerData | undefined {
    try {
        const parsed = JSON.parse(value) as {toolFormerData?: GuiToolFormerData};
        return parsed.toolFormerData;
    } catch {
        return undefined;
    }
}

/**
 * Signal 3 for Cursor GUI sessions — same JSON receipt shape as Claude Code's
 * toolUseResult.stdout, but sourced from state.vscdb: each `bubbleId:<composerId>:*`
 * row that ran a terminal command stores its output at
 * toolFormerData.result.output (JSON-encoded string).
 *
 * Bubble rows are keyed by a random per-call uuid, not insertion order, so
 * they are re-sorted by toolFormerData.additionalData.startedAtMs before
 * parsing — otherwise "first receipt with a product_id" (productIdFromTraces
 * tier 1) could pick the wrong one on multi-product sessions. Rows without a
 * timestamp sort last rather than aborting the scan.
 *
 * Opens/closes its own DB connection per call (no long-lived handle is shared
 * across sessions) — the simplest option for the current low daily volume of
 * Cursor GUI QA sessions; revisit only if this becomes a measured bottleneck.
 * Any missing DB file, unreadable bubble row, or non-receipt tool result is
 * skipped rather than thrown — a GUI session with no readable trace data
 * yields [], the same "leave it for manual assignment" fallback as other
 * agents without a trace adapter.
 */
export function tracesFromGuiToolResults(composerId: string): QaStdoutTrace[] {
    const dbPath = cursorStateDbCandidates().find((p) => existsSync(p));
    if (!dbPath) return [];

    let db: DatabaseSync;
    try {
        db = new DatabaseSync(dbPath, {readOnly: true});
    } catch {
        return [];
    }

    try {
        let rows: Array<{key: string; value: string}>;
        try {
            rows = selectCursorDiskKvByKeyPrefix(db, `bubbleId:${composerId}:`);
        } catch {
            return [];
        }

        const withTiming = rows
            .map((row) => ({row, tfd: toolFormerDataFromBubbleValue(row.value)}))
            .filter((r): r is {row: {key: string; value: string}; tfd: GuiToolFormerData} => r.tfd !== undefined)
            .filter((r) => r.tfd.name === "run_terminal_command_v2");

        withTiming.sort((a, b) => {
            const aMs = a.tfd.additionalData?.startedAtMs;
            const bMs = b.tfd.additionalData?.startedAtMs;
            if (aMs == null && bMs == null) return 0;
            if (aMs == null) return 1;
            if (bMs == null) return -1;
            return aMs - bMs;
        });

        const traces: QaStdoutTrace[] = [];
        for (const {tfd} of withTiming) {
            if (typeof tfd.result !== "string") continue;
            let output: unknown;
            try {
                output = (JSON.parse(tfd.result) as {output?: unknown}).output;
            } catch {
                continue;
            }
            if (typeof output !== "string") continue;

            const trace = parseQaStdoutTrace(output);
            if (trace) traces.push(trace);
        }

        return traces;
    } finally {
        db.close();
    }
}
