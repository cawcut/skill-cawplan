import {execFileSync} from "node:child_process";
import {statSync} from "node:fs";
import {dirname, isAbsolute, join} from "node:path";
import type {DailyApiJson, HumanInputFileChange, SessionData} from "../collect/types.js";

/**
 * Plans which markdown documents a coding session wrote (technical notes, test cases, ...) and
 * where they would go in CawPlan Knowledge: the product and module come from the session's linked
 * tickets, the dataset from the product's module tree. It only reads; nothing is uploaded here.
 */

export const DOC_MAX_BYTES = 1024 * 1024;

const MARKDOWN_EXT = /\.(md|markdown)$/i;
// Agent configuration and repo boilerplate are not documents a session was asked to write.
const EXCLUDED_NAMES = new Set(["claude.md", "agents.md", "readme.md", "changelog.md", "memory.md", "skill.md", "license.md"]);
const EXCLUDED_DIRS = ["node_modules/", ".git/", ".claude/", ".cursor/", ".codex/"];

export interface DocCandidate {
    session_id: string;
    session_name: string;
    project: string;
    /** The path as the session reported it (relative to its cwd, or absolute). */
    path: string;
    abs_path: string;
    added: number;
    deleted: number;
    /** True when the session only added lines (a file it wrote, not one it edited). */
    created: boolean;
    ticket_ids: string[];
    ticket_display_ids: string[];
    session_start?: string;
}

export interface TicketInfo {
    unique_id: string;
    display_id?: string;
    product_id?: string;
    module_id?: string | null;
    module_name?: string | null;
}

export interface ModuleNode {
    id?: string;
    name?: string;
    knowledge?: {id?: string; name?: string}[];
}

export interface DatasetRef {
    id: string;
    name?: string;
}

export interface PlanDeps {
    fetchTickets(uniqueIds: string[]): Promise<TicketInfo[]>;
    fetchModuleNodes(productId: string): Promise<ModuleNode[]>;
    fetchDatasets(productId: string): Promise<DatasetRef[]>;
    /** The size of a file, or undefined when it does not exist (or is not a file). */
    statFile(absPath: string): {size: number} | undefined;
}

export type DocPlanStatus =
    | "ready"
    | "file_missing"
    | "file_too_large"
    | "no_ticket"
    | "ticket_not_found"
    | "ticket_no_module"
    | "product_mismatch"
    | "choose_ticket"
    | "choose_dataset"
    | "no_dataset";

export interface DocPlanItem {
    session_id: string;
    session_name: string;
    path: string;
    abs_path: string;
    size?: number;
    created: boolean;
    status: DocPlanStatus;
    /** What to do next, in words, when the status is not ready. */
    hint?: string;
    tickets: TicketInfo[];
    product_id?: string;
    module_id?: string;
    module_name?: string;
    dataset_id?: string;
    /** Datasets to pick from when the status is choose_dataset (or no module dataset is known). */
    dataset_options?: DatasetRef[];
    /** Present when the status is ready. */
    upload_command?: string;
}

export function isDocPath(path: string): boolean {
    const normalized = path.replace(/\\/g, "/");
    if (!MARKDOWN_EXT.test(normalized)) return false;
    const base = normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
    if (EXCLUDED_NAMES.has(base)) return false;
    const lowered = `/${normalized.toLowerCase()}`;
    return !EXCLUDED_DIRS.some((dir) => lowered.includes(`/${dir}`));
}

function addChange(into: Map<string, HumanInputFileChange>, change: HumanInputFileChange): void {
    const existing = into.get(change.path);
    if (existing) {
        existing.added += change.added;
        existing.deleted += change.deleted;
    } else {
        into.set(change.path, {path: change.path, added: change.added, deleted: change.deleted});
    }
}

/**
 * Every markdown file a session touched, from the file changes the collector recorded (code files
 * are never looked at). `created` is the report's own hint (only lines added); selectDocCandidates
 * settles it against git and keeps the new documents.
 */
export function collectDocCandidates(report: DailyApiJson, opts: {includeEdited?: boolean} = {}): DocCandidate[] {
    const bySession = new Map<string, Map<string, HumanInputFileChange>>();
    const slot = (sessionId: string) => {
        let m = bySession.get(sessionId);
        if (!m) {
            m = new Map();
            bySession.set(sessionId, m);
        }
        return m;
    };
    for (const session of report.sessions ?? []) {
        for (const change of session.file_changes ?? []) addChange(slot(session.session_id), change);
        for (const input of session.human_inputs ?? []) {
            for (const change of input.file_changes ?? []) addChange(slot(session.session_id), change);
        }
    }
    // Report-level inputs repeat the per-session ones for the same turns; they are only used for a
    // session that has no per-session changes, so nothing is counted twice.
    const covered = new Set([...bySession.entries()].filter(([, m]) => m.size > 0).map(([id]) => id));
    for (const input of report.human_inputs ?? []) {
        if (!input.session_id || covered.has(input.session_id)) continue;
        for (const change of input.file_changes ?? []) addChange(slot(input.session_id), change);
    }

    const out: DocCandidate[] = [];
    for (const session of report.sessions ?? []) {
        const changes = bySession.get(session.session_id);
        if (!changes) continue;
        for (const change of changes.values()) {
            if (!isDocPath(change.path)) continue;
            const created = change.deleted === 0 && change.added > 0;
            if (!created && opts.includeEdited === false) continue;
            out.push({
                session_id: session.session_id,
                session_name: session.session_name,
                project: session.project,
                path: change.path,
                abs_path: isAbsolute(change.path) ? change.path : join(session.cwd ?? "", change.path),
                added: change.added,
                deleted: change.deleted,
                created,
                ticket_ids: session.ticket_ids ?? [],
                ticket_display_ids: session.ticket_display_ids ?? [],
                session_start: session.time_range?.start,
            });
        }
    }
    return out;
}

/** Whether git says a file is new for a session: untracked, or first committed after session start. */
export type GitNewness = "new" | "existing" | "unknown";

/**
 * Keeps the new technical documents, newest-written first. A file git calls new is kept (even if
 * the session rewrote it); one git calls existing is an edit and is dropped unless includeEdited;
 * when git cannot tell, the report's hint decides.
 */
export function selectDocCandidates(
    candidates: DocCandidate[],
    opts: {includeEdited?: boolean; gitNewness?: (absPath: string, sinceIso?: string) => GitNewness} = {},
): DocCandidate[] {
    const kept: DocCandidate[] = [];
    for (const c of candidates) {
        const verdict = opts.gitNewness?.(c.abs_path, c.session_start) ?? "unknown";
        const created = verdict === "new" ? true : verdict === "existing" ? false : c.created;
        if (!created && !opts.includeEdited) continue;
        kept.push({...c, created});
    }
    // New documents first, then the bigger ones: a long write-up matters more than a stub.
    return kept.sort((a, b) => Number(b.created) - Number(a.created) || b.added - a.added || a.path.localeCompare(b.path));
}

export function uploadCommand(datasetId: string, moduleId: string, absPath: string): string {
    const quote = (s: string) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
    return `cawplan knowledge documents upload --dataset ${datasetId} --module ${moduleId} --file ${quote(absPath)}`;
}

export function updateModuleCommand(ticket: TicketInfo): string {
    return `cawplan tickets update <product_id> <version_id> ${ticket.display_id ?? ticket.unique_id} --module "<module name or path>"`;
}

/** Resolves every candidate to a plan item: where it goes, or why it cannot go yet. */
export async function planDocs(
    candidates: DocCandidate[],
    sessions: Pick<SessionData, "session_id" | "product_id">[],
    deps: PlanDeps,
): Promise<DocPlanItem[]> {
    const sessionProduct = new Map(sessions.map((s) => [s.session_id, s.product_id]));
    const wantedTickets = [...new Set(candidates.flatMap((c) => c.ticket_ids))];
    const ticketList = wantedTickets.length > 0 ? await deps.fetchTickets(wantedTickets) : [];
    const tickets = new Map(ticketList.map((t) => [t.unique_id, t]));
    const moduleCache = new Map<string, Promise<ModuleNode[]>>();
    const datasetCache = new Map<string, Promise<DatasetRef[]>>();
    const nodesOf = (productId: string) => {
        if (!moduleCache.has(productId)) moduleCache.set(productId, deps.fetchModuleNodes(productId));
        return moduleCache.get(productId)!;
    };
    const datasetsOf = (productId: string) => {
        if (!datasetCache.has(productId)) datasetCache.set(productId, deps.fetchDatasets(productId));
        return datasetCache.get(productId)!;
    };

    const items: DocPlanItem[] = [];
    for (const c of candidates) {
        const item: DocPlanItem = {
            session_id: c.session_id,
            session_name: c.session_name,
            path: c.path,
            abs_path: c.abs_path,
            created: c.created,
            status: "ready",
            tickets: [],
        };
        items.push(item);

        const stat = deps.statFile(c.abs_path);
        if (!stat) {
            item.status = "file_missing";
            item.hint = "The file is no longer on disk.";
            continue;
        }
        item.size = stat.size;
        if (stat.size > DOC_MAX_BYTES) {
            item.status = "file_too_large";
            item.hint = `The file is larger than ${DOC_MAX_BYTES / 1024} KB.`;
            continue;
        }
        if (c.ticket_ids.length === 0) {
            item.status = "no_ticket";
            item.hint = "The session has no linked ticket, so the product and module are unknown. Link a ticket on the assignment page, or give the product and module by hand.";
            continue;
        }
        item.tickets = c.ticket_ids.map((id) => tickets.get(id) ?? {unique_id: id});
        const found = item.tickets.filter((t) => t.product_id);
        if (found.length === 0) {
            item.status = "ticket_not_found";
            item.hint = "None of the session's tickets could be read from CawPlan.";
            continue;
        }
        const wantProduct = sessionProduct.get(c.session_id);
        const sameProduct = wantProduct ? found.filter((t) => t.product_id === wantProduct) : found;
        if (sameProduct.length === 0) {
            item.status = "product_mismatch";
            item.hint = "The session's product differs from its tickets' product; fix the assignment first.";
            continue;
        }
        const withModule = sameProduct.filter((t) => t.module_id);
        if (withModule.length === 0) {
            item.status = "ticket_no_module";
            item.hint = `No linked ticket has a module. Add one first, e.g.: ${updateModuleCommand(sameProduct[0])}`;
            continue;
        }
        const targets = new Map(withModule.map((t) => [`${t.product_id}|${t.module_id}`, t]));
        if (targets.size > 1) {
            item.status = "choose_ticket";
            item.hint = "The linked tickets point to different modules; pick which one the document belongs to.";
            continue;
        }
        const target = [...targets.values()][0];
        item.product_id = target.product_id;
        item.module_id = target.module_id ?? undefined;
        item.module_name = target.module_name ?? undefined;

        // Datasets that already hold documents under this module come first: that is where
        // the module's documents live. Otherwise the product's datasets are offered to pick from.
        const nodes = await nodesOf(target.product_id!);
        const node = nodes.find((n) => n.id === target.module_id);
        const inModule = (node?.knowledge ?? []).filter((d): d is {id: string; name?: string} => Boolean(d.id));
        if (inModule.length === 1) {
            item.dataset_id = inModule[0].id;
            item.upload_command = uploadCommand(inModule[0].id, target.module_id!, c.abs_path);
            continue;
        }
        if (inModule.length > 1) {
            item.status = "choose_dataset";
            item.dataset_options = inModule.map((d) => ({id: d.id, name: d.name}));
            item.hint = "Several datasets already hold documents under this module; pick one.";
            continue;
        }
        const productDatasets = await datasetsOf(target.product_id!);
        if (productDatasets.length === 0) {
            item.status = "no_dataset";
            item.hint = "The product has no knowledge dataset yet. Create one owned by the product (cawplan knowledge datasets create --owner-product ...).";
            continue;
        }
        item.status = "choose_dataset";
        item.dataset_options = productDatasets;
        item.hint = "No dataset has documents under this module yet; pick one owned by the product (a linked dataset cannot take the module).";
    }
    return items;
}

export function summarizePlan(items: DocPlanItem[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
}

export function statFileOnDisk(absPath: string): {size: number} | undefined {
    try {
        const s = statSync(absPath);
        return s.isFile() ? {size: s.size} : undefined;
    } catch {
        return undefined;
    }
}

/** Asks git whether a file is new: untracked, or first added by a commit made after sinceIso. */
export function gitNewnessOnDisk(absPath: string, sinceIso?: string): GitNewness {
    const dir = dirname(absPath);
    const git = (args: string[]): string | undefined => {
        try {
            return execFileSync("git", ["-C", dir, ...args], {encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000}).trim();
        } catch {
            return undefined;
        }
    };
    if (git(["rev-parse", "--is-inside-work-tree"]) !== "true") return "unknown";
    if (git(["ls-files", "--error-unmatch", "--", absPath]) === undefined) return "new";
    const added = git(["log", "--diff-filter=A", "--format=%aI", "--", absPath]);
    if (!added) return "unknown";
    const first = added.split("\n").filter(Boolean).pop();
    const since = sinceIso ? Date.parse(sinceIso) : NaN;
    const when = first ? Date.parse(first) : NaN;
    if (Number.isNaN(since) || Number.isNaN(when)) return "unknown";
    return when >= since ? "new" : "existing";
}
