import {findSessionsByDate, parseEvents} from "./agents/claude-code.js";
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
 * Signal 3 — parse structured JSON from user toolUseResult.stdout
 * (outcome / command / meta / api.data / reconcile). Authoritative source for
 * testpoint.added counts and stdout-derived product_id / requirement_id.
 *
 * Template-trap guard: SKILL files inject Chinese receipt boilerplate into user
 * events with wording similar to real receipts. Only structured JSON is parsed;
 * never match on free-text Chinese phrases.
 */
export function tracesFromToolResultStdout(jsonlPath: string, date?: string): QaStdoutTrace[] {
    const events = parseEvents(jsonlPath, date);
    const traces: QaStdoutTrace[] = [];

    for (const event of events) {
        if (event["type"] !== "user") continue;
        const stdout = (event["toolUseResult"] as {stdout?: unknown} | undefined)?.stdout;
        if (typeof stdout !== "string") continue;

        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(stdout);
        } catch {
            continue;
        }

        const command = parsed["command"];
        const outcome = parsed["outcome"];
        if (typeof command !== "string" || typeof outcome !== "string") continue;

        const meta = parsed["meta"] as {product_id?: string; requirement_id?: string; dry_run?: boolean} | undefined;
        const api = parsed["api"] as {data?: {test_points?: unknown[]}} | undefined;
        const reconcile = parsed["reconcile"] as {decision?: string; batch_size?: number} | undefined;

        traces.push({
            command,
            outcome,
            productId: meta?.product_id,
            requirementId: meta?.requirement_id,
            dryRun: meta?.dry_run,
            landedCount: Array.isArray(api?.data?.test_points) ? api!.data!.test_points!.length : undefined,
            reconcileDecision: reconcile?.decision,
            batchSize: reconcile?.batch_size,
            skillLayer: inferSkillFromCommand(command),
        });
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
