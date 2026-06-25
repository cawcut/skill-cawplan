/**
 * Cursor GUI (Composer) session reader.
 *
 * Data source: ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb (SQLite, 3+ GB)
 *   Table: cursorDiskKV — key-value store for all Cursor state.
 *   Session rows use keys like "composerData:<composerId>"; the JSON value contains:
 *     composerId, name, createdAt (ms), lastUpdatedAt (ms), selectedModelId, headerCount
 *
 * What we extract:
 *   - Session list: composerData rows whose createdAt or lastUpdatedAt falls in the target date window
 *   - Time range: createdAt / lastUpdatedAt from the composerData blob
 *     Per-bubble timestamps (keys "bubbleId:<composerId>:*") are queried per matched
 *     session only — not scanned globally — to backfill human-input times when transcripts
 *     lack per-message timestamps.
 *   - Model: selectedModelId field
 *   - Cost / tokens: NOT available locally; fetched separately by cursor-api.ts
 *     only when CURSOR_ACCESS_TOKEN or CURSOR_SESSION_TOKEN is set.
 */
import {existsSync, readFileSync, readdirSync, statSync} from "node:fs";
import type {Dirent} from "node:fs";
import {dirname, isAbsolute, join} from "node:path";
import {createRequire} from "node:module";
import type {Database as DatabaseType} from "better-sqlite3";
import {activityOverlapsLocalDate, dayBoundsMs, isTimestampOnLocalDate, localDateString} from "../date-utils.js";
import {cursorProjectsDir, cursorStateDbCandidates} from "../paths.js";
import {FileChange, HumanInput, RepoTouched} from "../types.js";
import {gitRemoteRepo, gitFileNumstat} from "../git.js";
import {classifyHumanInput} from "../aggregators/human-category.js";

const require = createRequire(import.meta.url);
const USER_QUERY_RE = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/i;
const TS_TAG_RE = /<timestamp>([^<]+)<\/timestamp>/i;
const PATCH_FILE_RE = /^\*\*\* (?:Update|Add) File: (.+)$/;

function encodedPathSegmentTokens(name: string): string[] {
    return name
        .replace(/[^A-Za-z0-9]+/g, "-")
        .split("-")
        .filter(Boolean);
}

function projectDirTokens(projectDir: string): string[] {
    const normalized = projectDir.replace(/%252F/g, "-");
    try {
        return decodeURIComponent(normalized).split("-").filter(Boolean);
    } catch {
        return normalized.split("-").filter(Boolean);
    }
}

function tokensMatch(tokens: string[], offset: number, segmentTokens: string[]): boolean {
    if (segmentTokens.length === 0 || offset + segmentTokens.length > tokens.length) return false;
    for (let i = 0; i < segmentTokens.length; i++) {
        if (tokens[offset + i] !== segmentTokens[i]) return false;
    }
    return true;
}

function decodeCursorProjectDirByFilesystem(projectDir: string): string {
    const tokens = projectDirTokens(projectDir);
    if (tokens.length === 0) return "";

    const queue: Array<{ dir: string; offset: number }> = [{dir: "/", offset: 0}];
    let visited = 0;
    while (queue.length > 0 && visited < 2000) {
        const current = queue.shift();
        if (!current) break;
        visited++;
        if (current.offset === tokens.length) {
            return current.dir;
        }

        let entries: Dirent[];
        try {
            entries = readdirSync(current.dir, {withFileTypes: true});
        } catch {
            continue;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const segmentTokens = encodedPathSegmentTokens(entry.name);
            if (!tokensMatch(tokens, current.offset, segmentTokens)) continue;
            queue.push({
                dir: join(current.dir, entry.name),
                offset: current.offset + segmentTokens.length,
            });
        }
    }

    return "";
}

/** Exported for unit tests. */
export function decodeCursorProjectDirToCwd(projectDir: string): string {
    const trimmed = (projectDir ?? "").trim();
    if (!trimmed || trimmed === "agent-transcripts") return "";
    if (/^\d+$/.test(trimmed)) return "";
    try {
        // Cursor project dir is commonly an encoded workspace path.
        // Example: media-spx-work-github-flow-cawplan-skill -> /media/spx/work/github/flow-cawplan-skill
        const decoded = decodeURIComponent(trimmed.replace(/-/g, "%2F").replace(/%252F/g, "-"));
        const normalized = decoded.startsWith("/") ? decoded : `/${decoded}`;
        if (existsSync(normalized)) return normalized;
    } catch {
        // Fall through to filesystem-based decoding below.
    }
    return decodeCursorProjectDirByFilesystem(trimmed);
}

function inferCwdFromTranscriptPath(transcriptPath: string, projectsRoot: string): string {
    const prefix = `${projectsRoot}/`;
    if (!transcriptPath.startsWith(prefix)) return "";
    const rest = transcriptPath.slice(prefix.length);
    const first = rest.split("/")[0] ?? "";
    return decodeCursorProjectDirToCwd(first);
}

function cwdFromWorkspaceIdentifier(data: Record<string, unknown>): string {
    const workspace = data["workspaceIdentifier"] as Record<string, unknown> | undefined;
    const uri = workspace?.["uri"] as Record<string, unknown> | undefined;
    const fsPath = uri?.["fsPath"];
    const path = uri?.["path"];
    const candidate = typeof fsPath === "string" && fsPath.trim()
        ? fsPath
        : typeof path === "string" && path.trim()
            ? path
            : "";
    return candidate && existsSync(candidate) ? candidate : "";
}


function extractHumanInputText(raw: string): string {
    const query = raw.match(USER_QUERY_RE)?.[1]?.trim();
    if (query) return query;
    // Strip metadata-ish tags if present
    return raw
        .replace(TS_TAG_RE, "")
        .replace(/<\/?user_query>/gi, "")
        .trim();
}

function parseApplyPatchStats(patch: string): Array<{ path: string; added: number; deleted: number }> {
    const lines = patch.split("\n");
    const result: Array<{ path: string; added: number; deleted: number }> = [];
    let current: { path: string; added: number; deleted: number } | null = null;
    const flush = () => {
        if (!current) return;
        result.push(current);
        current = null;
    };

    for (const line of lines) {
        const fm = line.match(PATCH_FILE_RE);
        if (fm) {
            flush();
            current = {path: fm[1].trim(), added: 0, deleted: 0};
            continue;
        }
        if (!current) continue;
        if (line.startsWith("+") && !line.startsWith("+++")) {
            current.added += 1;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
            current.deleted += 1;
        }
    }
    flush();
    return result;
}

function lineCount(text: string): number {
    if (!text) return 0;
    return text.split("\n").length;
}

function formatIsoTime(ts: Date | null): string | undefined {
    if (!ts || Number.isNaN(ts.getTime())) return undefined;
    return ts.toISOString();
}

function parseTsValue(raw: unknown): Date | null {
    if (raw == null) return null;
    if (typeof raw === "number") {
        const ms = raw > 1_000_000_000_000 ? raw : raw * 1000;
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof raw === "string") {
        const text = raw.trim();
        if (!text) return null;
        if (/^\d+(\.\d+)?$/.test(text)) {
            const n = Number(text);
            return parseTsValue(n);
        }
        const d = new Date(text);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
}

function transcriptLinesHaveTimestamps(lines: string[]): boolean {
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const obj = JSON.parse(trimmed) as Record<string, unknown>;
            // Only user turns carry Cursor activity timestamps; assistant text may quote
            // "<timestamp>" examples and must not disable the mtime fallback.
            if (obj["role"] !== "user") continue;
            const message = (obj["message"] as Record<string, unknown> | undefined) ?? obj;
            const content = message["content"];
            let textFallback = "";
            if (Array.isArray(content)) {
                for (const block of content) {
                    const b = block as Record<string, unknown>;
                    if (b["type"] !== "text") continue;
                    textFallback += String(b["text"] ?? "");
                }
            }
            if (parseEventTimestamp(obj, message, textFallback || undefined)) return true;
        } catch {
            continue;
        }
    }
    return false;
}

function resolveTranscriptPrimaryLocalDate(
    transcriptPath: string,
    lastUpdatedAtMs?: number
): string | null {
    if (lastUpdatedAtMs != null && lastUpdatedAtMs > 0) {
        return localDateString(new Date(lastUpdatedAtMs));
    }
    try {
        return localDateString(statSync(transcriptPath).mtime);
    } catch {
        return null;
    }
}

/** Exported for unit tests. */
export function shouldSkipTranscriptDateFilter(
    filterDate: string | undefined,
    lines: string[],
    transcriptPath: string,
    lastUpdatedAtMs?: number
): boolean {
    if (!filterDate) return true;
    if (transcriptLinesHaveTimestamps(lines)) return false;
    const primary = resolveTranscriptPrimaryLocalDate(transcriptPath, lastUpdatedAtMs);
    return primary === filterDate;
}

/** Exported for unit tests. */
export function normalizeBubbleMatchText(text: string): string {
    return extractHumanInputText(text).replace(/\s+/g, " ").trim().toLowerCase();
}

interface UserBubble {
    createdAt: Date;
    text: string;
    normalized: string;
}

interface SessionBubbleTimeline {
    userBubbles: UserBubble[];
    assistantTimes: Date[];
}

function loadSessionBubbleTimeline(
    db: DatabaseType,
    composerId: string
): SessionBubbleTimeline | null {
    try {
        const rows = db
            .prepare("SELECT value FROM cursorDiskKV WHERE key LIKE ?")
            .all(`bubbleId:${composerId}:%`) as Array<{ value: string }>;
        if (!rows.length) return null;

        const userBubbles: UserBubble[] = [];
        const assistantTimes: Date[] = [];

        for (const row of rows) {
            try {
                const data = JSON.parse(row.value) as Record<string, unknown>;
                const createdAt = parseTsValue(data["createdAt"]);
                if (!createdAt) continue;
                if (data["type"] === 1) {
                    const text = String(data["text"] ?? "").trim();
                    if (!text) continue;
                    userBubbles.push({
                        createdAt,
                        text,
                        normalized: normalizeBubbleMatchText(text),
                    });
                } else {
                    assistantTimes.push(createdAt);
                }
            } catch {
                continue;
            }
        }

        if (!userBubbles.length) return null;
        userBubbles.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        assistantTimes.sort((a, b) => a.getTime() - b.getTime());
        return {userBubbles, assistantTimes};
    } catch {
        return null;
    }
}

/** Exported for unit tests. */
export function matchUserBubble(
    content: string,
    userBubbles: UserBubble[],
    usedIndices: Set<number>
): UserBubble | null {
    const norm = normalizeBubbleMatchText(content);
    if (!norm) return null;

    for (let i = 0; i < userBubbles.length; i++) {
        if (usedIndices.has(i)) continue;
        if (userBubbles[i].normalized === norm) {
            usedIndices.add(i);
            return userBubbles[i];
        }
    }

    const prefix = norm.slice(0, 80);
    for (let i = 0; i < userBubbles.length; i++) {
        if (usedIndices.has(i)) continue;
        const candidate = userBubbles[i].normalized;
        if (
            (prefix.length >= 20 && candidate.startsWith(prefix)) ||
            (candidate.length >= 20 && norm.startsWith(candidate.slice(0, 80)))
        ) {
            usedIndices.add(i);
            return userBubbles[i];
        }
    }

    for (let i = 0; i < userBubbles.length; i++) {
        if (!usedIndices.has(i)) {
            usedIndices.add(i);
            return userBubbles[i];
        }
    }
    return null;
}

function resolveBubbleEndTime(
    start: Date,
    nextUserStart: Date | null,
    assistantTimes: Date[]
): Date | null {
    const startMs = start.getTime();
    const upper = nextUserStart?.getTime() ?? Number.POSITIVE_INFINITY;
    let end: Date | null = null;
    for (const ts of assistantTimes) {
        const ms = ts.getTime();
        if (ms <= startMs) continue;
        if (ms >= upper) break;
        if (!end || ms > end.getTime()) end = ts;
    }
    return end ?? start;
}

function tryOpenCursorStateDb(): DatabaseType | null {
    for (const dbPath of cursorStateDbCandidates()) {
        if (!existsSync(dbPath)) continue;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const Database = require("better-sqlite3") as typeof import("better-sqlite3");
            return new Database(dbPath, {readonly: true});
        } catch {
            continue;
        }
    }
    return null;
}

function parseEventTimestamp(
    obj: Record<string, unknown>,
    message: Record<string, unknown>,
    fallbackText?: string
): Date | null {
    const candidates = [
        obj["timestamp"], obj["ts"], obj["time"], obj["createdAt"], obj["created_at"], obj["updatedAt"], obj["updated_at"],
        message["timestamp"], message["ts"], message["time"], message["createdAt"], message["created_at"], message["updatedAt"], message["updated_at"],
    ];
    for (const c of candidates) {
        const parsed = parseTsValue(c);
        if (parsed) return parsed;
    }
    if (fallbackText) return parseTimestampFromText(fallbackText);
    return null;
}

function estimateDeltaFromToolInput(
    toolName: string,
    rawInput: unknown
): { path: string | null; added: number; deleted: number } {
    const input = (rawInput as Record<string, unknown> | undefined) ?? {};
    const getPath = (): string | null => {
        const p = (input["path"] ?? input["file_path"] ?? input["target_file"] ?? input["target_notebook"]) as string | undefined;
        return p && p.trim() ? p.trim() : null;
    };

    if (toolName === "StrReplace" || toolName === "Edit" || toolName === "EditNotebook") {
        const oldStr = String(input["old_string"] ?? "");
        const newStr = String(input["new_string"] ?? "");
        return {path: getPath(), added: lineCount(newStr), deleted: lineCount(oldStr)};
    }

    if (toolName === "MultiEdit") {
        const edits = input["edits"] as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(edits) || edits.length === 0) return {path: getPath(), added: 0, deleted: 0};
        const firstPath = (edits[0]["path"] ?? edits[0]["target_file"] ?? getPath()) as string | null;
        let added = 0;
        let deleted = 0;
        for (const e of edits) {
            added += lineCount(String(e["new_string"] ?? ""));
            deleted += lineCount(String(e["old_string"] ?? ""));
        }
        return {path: firstPath, added, deleted};
    }

    if (toolName === "Write") {
        const content = String(input["content"] ?? input["new_string"] ?? "");
        return {path: getPath(), added: lineCount(content), deleted: 0};
    }

    if (toolName === "Delete") {
        return {path: getPath(), added: 0, deleted: 1};
    }

    return {path: null, added: 0, deleted: 0};
}

function isMutationTool(toolName: string): boolean {
    return ["StrReplace", "Edit", "EditNotebook", "MultiEdit", "Write", "Delete"].includes(toolName);
}

function inferGitRootFromPath(filePath: string | null | undefined): string {
    if (!filePath || !isAbsolute(filePath)) return "";
    let current = filePath;
    try {
        if (existsSync(current) && !statSync(current).isDirectory()) {
            current = dirname(current);
        }
    } catch {
        // Continue by walking parent paths; the target file may not exist yet.
    }
    while (current && current !== dirname(current)) {
        if (existsSync(join(current, ".git"))) return current;
        current = dirname(current);
    }
    return "";
}

function resolveCwdForFile(sessionCwd: string, filePath: string): string {
    return inferGitRootFromPath(filePath) || sessionCwd;
}

export interface GuiSession {
    id: string;
    name: string;
    created_at_ms: number;
    last_updated_at_ms: number;
    model: string;
    header_count: number;
    activity_start: Date | null;
    activity_end: Date | null;
    cwd: string;
    files_changed: FileChange[];
    repos_touched: RepoTouched[];
    message_stats: { user: number; assistant: number; tool_calls: number };
    human_inputs?: HumanInput[];
}

interface ParseTranscriptOptions {
    lastUpdatedAtMs?: number;
    initialCwd?: string;
    db?: DatabaseType;
}

function parseTranscript(sessionId: string, filterDate?: string, opts?: ParseTranscriptOptions): {
    cwd: string;
    files: FileChange[];
    repos: RepoTouched[];
    messageStats: { user: number; assistant: number; tool_calls: number };
    humanInputs: HumanInput[];
    activityStart: Date | null;
    activityEnd: Date | null;
} {
    const projectsRoot = cursorProjectsDir();
    const transcriptCandidates = [
        join(projectsRoot, "agent-transcripts", sessionId, `${sessionId}.jsonl`),
    ];

    // Support per-project layout: ~/.cursor/projects/<project>/agent-transcripts/<id>/<id>.jsonl
    try {
        const entries = readdirSync(projectsRoot, { withFileTypes: true });
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            transcriptCandidates.push(join(projectsRoot, e.name, "agent-transcripts", sessionId, `${sessionId}.jsonl`));
        }
    } catch {
        // ignore
    }

    const transcriptPath = transcriptCandidates.find((p) => existsSync(p));
    if (!transcriptPath) {
        return {
            cwd: "",
            files: [],
            repos: [],
            messageStats: { user: 0, assistant: 0, tool_calls: 0 },
            humanInputs: [],
            activityStart: null,
            activityEnd: null,
        };
    }

    const lines = readFileSync(transcriptPath, "utf-8").split("\n");
    const bubbleTimeline =
        !transcriptLinesHaveTimestamps(lines) && opts?.db
            ? loadSessionBubbleTimeline(opts.db, sessionId)
            : null;
    const useBubbleDayFilter = !!bubbleTimeline && !!filterDate;
    const skipDateFilter =
        !useBubbleDayFilter &&
        shouldSkipTranscriptDateFilter(filterDate, lines, transcriptPath, opts?.lastUpdatedAtMs);
    const usedBubbleIndices = new Set<number>();

    let activityStart: Date | null = null;
    let activityEnd: Date | null = null;
    const touchActivity = (ts: Date | null | undefined): void => {
        if (!ts) return;
        if (filterDate && !isTimestampOnLocalDate(ts, filterDate)) return;
        if (!activityStart || ts < activityStart) activityStart = ts;
        if (!activityEnd || ts > activityEnd) activityEnd = ts;
    };

    let cwd = opts?.initialCwd || inferCwdFromTranscriptPath(transcriptPath, projectsRoot);
    let userCount = 0;
    let assistantCount = 0;
    let toolCallCount = 0;
    const files: FileChange[] = [];
    const fileIndex = new Map<string, number>();
    const humanInputs: HumanInput[] = [];
    let currentPromptOnDate = skipDateFilter;
    const seenInput = new Set<string>();
    type PromptContext = {
        idx: number;
        start: Date | null;
        firstTool: Date | null;
        lastTool: Date | null;
        files: Set<string>;
        linesAdded: number;
        linesDeleted: number;
    };
    const contexts: PromptContext[] = [];
    let currentContext: PromptContext | null = null;

    const pickPathFromInput = (input: Record<string, unknown>): string | null => {
        const keys = ["path", "file_path", "target_file", "target_notebook"] as const;
        for (const key of keys) {
            const val = input[key];
            if (typeof val === "string" && val.trim()) return val.trim();
        }
        return null;
    };


    const upsertFile = (path: string, added: number, deleted: number, changeType?: string): void => {
        const key = path.trim();
        if (!key) return;
        const idx = fileIndex.get(key);
        if (idx == null) {
            fileIndex.set(key, files.length);
            files.push({
                path: key,
                added: Math.max(0, added),
                deleted: Math.max(0, deleted),
                repo: "",
                change_type: changeType,
            });
            return;
        }
        const f = files[idx];
        f.added = (f.added ?? 0) + Math.max(0, added);
        f.deleted = (f.deleted ?? 0) + Math.max(0, deleted);
        if (!f.change_type && changeType) f.change_type = changeType;
    };

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj: Record<string, unknown>;
        try {
            obj = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
            continue;
        }

        if (!cwd && typeof obj["cwd"] === "string") cwd = obj["cwd"];

        const role = obj["role"];
        const message = (obj["message"] as Record<string, unknown> | undefined) ?? obj;
        const content = message["content"];

        if (role === "user" && Array.isArray(content)) {
            let textAcc = "";
            for (const block of content) {
                const b = block as Record<string, unknown>;
                if (b["type"] !== "text") continue;
                const text = String(b["text"] ?? "").trim();
                if (!text) continue;
                textAcc = textAcc ? `${textAcc}\n${text}` : text;
            }
            if (textAcc) {
                const extracted = extractHumanInputText(textAcc);
                let promptTs = parseEventTimestamp(obj, message, textAcc);
                if (!promptTs && bubbleTimeline && extracted) {
                    const matched = matchUserBubble(extracted, bubbleTimeline.userBubbles, usedBubbleIndices);
                    if (matched) promptTs = matched.createdAt;
                }
                currentPromptOnDate = skipDateFilter ||
                    (!!filterDate && !!promptTs && isTimestampOnLocalDate(promptTs, filterDate));
                if (!currentPromptOnDate) {
                    currentContext = null;
                    continue;
                }
                userCount++;
                touchActivity(promptTs);
                const norm = textAcc.slice(0, 200);
                if (!seenInput.has(norm) && extracted.length > 0 && extracted.length <= 1500) {
                    seenInput.add(norm);
                    const inputIdx = humanInputs.length;
                    humanInputs.push({
                        category: classifyHumanInput(extracted),
                        content: extracted,
                        session_agent: "cursor-gui",
                        session_time: formatIsoTime(promptTs),
                        start_time: formatIsoTime(promptTs),
                        end_time: formatIsoTime(promptTs),
                        files_changed: 0,
                        lines_added: 0,
                        lines_deleted: 0,
                    });
                    currentContext = {
                        idx: inputIdx,
                        start: promptTs,
                        firstTool: null,
                        lastTool: null,
                        files: new Set<string>(),
                        linesAdded: 0,
                        linesDeleted: 0,
                    };
                    contexts.push(currentContext);
                } else {
                    currentContext = null;
                }
            }
        } else if (role === "assistant" && Array.isArray(content)) {
            const eventTs = parseEventTimestamp(obj, message);
            const assistantOnDate = skipDateFilter ||
                (!!filterDate && eventTs ? isTimestampOnLocalDate(eventTs, filterDate) : currentPromptOnDate);
            if (!assistantOnDate) continue;
            assistantCount++;
            touchActivity(eventTs);
            for (const block of content) {
                const b = block as Record<string, unknown>;
                if (b["type"] !== "tool_use") continue;
                toolCallCount++;
                const rawInput = b["input"];
                if (typeof rawInput === "string" && String(b["name"] ?? "") === "ApplyPatch") {
                    const patchFiles = parseApplyPatchStats(rawInput);
                    for (const pf of patchFiles) {
                        upsertFile(pf.path, pf.added, pf.deleted, "ApplyPatch");
                        if (currentContext) {
                            currentContext.files.add(pf.path);
                            currentContext.linesAdded += Math.max(0, pf.added);
                            currentContext.linesDeleted += Math.max(0, pf.deleted);
                            if (eventTs) {
                                currentContext.firstTool = currentContext.firstTool ?? eventTs;
                                currentContext.lastTool = eventTs;
                            }
                        }
                    }
                    continue;
                }

                const input = (rawInput as Record<string, unknown> | undefined) ?? {};
                if (!cwd && typeof input["working_directory"] === "string") {
                    cwd = String(input["working_directory"]);
                }
                const toolName = typeof b["name"] === "string" ? b["name"] : "";
                const inputPath = pickPathFromInput(input);
                if (!cwd) {
                    const pathCwd = inferGitRootFromPath(inputPath);
                    if (pathCwd) cwd = pathCwd;
                }
                if (!isMutationTool(toolName)) continue;
                const delta = estimateDeltaFromToolInput(toolName, rawInput);
                const p = delta.path ?? inputPath;
                if (!p) continue;
                upsertFile(p, delta.added, delta.deleted, toolName || undefined);
                if (currentContext) {
                    currentContext.files.add(p);
                    currentContext.linesAdded += Math.max(0, delta.added);
                    currentContext.linesDeleted += Math.max(0, delta.deleted);
                    if (eventTs) {
                        currentContext.firstTool = currentContext.firstTool ?? eventTs;
                        currentContext.lastTool = eventTs;
                    }
                }
            }
        }
    }

    for (let i = 0; i < contexts.length; i++) {
        const ctx = contexts[i];
        const h = humanInputs[ctx.idx];
        if (!h) continue;
        const start = ctx.start ?? ctx.firstTool;
        let end = ctx.lastTool ?? ctx.firstTool ?? start;
        if (!ctx.lastTool && bubbleTimeline && start) {
            const nextStart = contexts[i + 1]?.start ?? null;
            end = resolveBubbleEndTime(start, nextStart, bubbleTimeline.assistantTimes) ?? end;
        }
        h.files_changed = ctx.files.size;
        h.lines_added = ctx.linesAdded;
        h.lines_deleted = ctx.linesDeleted;
        h.start_time = formatIsoTime(start);
        h.end_time = formatIsoTime(end);
        h.session_time = h.start_time;
        touchActivity(start);
        touchActivity(end);
    }

    const repoStats = new Map<string, { files: number; added: number; deleted: number }>();
    for (const f of files) {
        const fileCwd = resolveCwdForFile(cwd, f.path);
        const repo = gitRemoteRepo(fileCwd);
        f.repo = repo;
        const stat = gitFileNumstat(fileCwd, f.path);
        if (stat.added !== 0 || stat.deleted !== 0) {
            f.added = stat.added;
            f.deleted = stat.deleted;
        }
        if (!repo) continue;
        const current = repoStats.get(repo) ?? {files: 0, added: 0, deleted: 0};
        current.files += 1;
        current.added += f.added ?? 0;
        current.deleted += f.deleted ?? 0;
        repoStats.set(repo, current);
    }
    const repos: RepoTouched[] = Array.from(repoStats.entries()).map(([repo, stats]) => ({
        repo,
        files: stats.files,
        added: stats.added,
        deleted: stats.deleted,
    }));

    return {
        cwd,
        files,
        repos,
        messageStats: { user: userCount, assistant: assistantCount, tool_calls: toolCallCount },
        humanInputs: humanInputs.length > 0 ? humanInputs : [],
        activityStart,
        activityEnd,
    };
}

/** Exported for unit tests. */
export function parseGuiSessionTranscript(
    sessionId: string,
    filterDate?: string,
    opts?: ParseTranscriptOptions
) {
    return parseTranscript(sessionId, filterDate, opts);
}

function applyParsedDayActivity(session: GuiSession, parsed: ReturnType<typeof parseTranscript>): void {
    if (parsed.activityStart) {
        session.activity_start = parsed.activityStart;
    }
    if (parsed.activityEnd) {
        session.activity_end = parsed.activityEnd;
    } else if (parsed.activityStart) {
        session.activity_end = parsed.activityStart;
    }
}

function sessionHasDayActivity(session: GuiSession): boolean {
    return (
        session.message_stats.user > 0 ||
        session.message_stats.assistant > 0 ||
        session.files_changed.length > 0
    );
}

function parseTimestampFromText(text: string): Date | null {
    const m = text.match(TS_TAG_RE);
    if (!m) return null;
    const raw = m[1].trim();
    const direct = new Date(raw.replace("(UTC+8)", "GMT+0800").replace("(UTC-8)", "GMT-0800"));
    if (!Number.isNaN(direct.getTime())) return direct;

    // Fallback for strings like: "Tuesday, Jun 16, 2026, 5:17 PM (UTC+8)"
    const tzMatch = raw.match(/\(UTC([+-]\d+)\)/i);
    const tzHour = tzMatch ? Number.parseInt(tzMatch[1], 10) : 0;
    const tzSign = tzHour >= 0 ? "+" : "-";
    const tzAbs = Math.abs(tzHour).toString().padStart(2, "0");
    const tz = `${tzSign}${tzAbs}:00`;
    const withoutWeekday = raw.replace(/^[A-Za-z]+,\s*/, "").replace(/\s*\(UTC[+-]\d+\)\s*$/i, "");
    const d2 = new Date(`${withoutWeekday} ${tz}`);
    return Number.isNaN(d2.getTime()) ? null : d2;
}

function bubbleText(data: Record<string, unknown>): string {
    const candidates = [data["text"], data["richText"], data["content"], data["message"], data["prompt"]];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    return "";
}

function parseBubbleSession(
    db: DatabaseType,
    sessionId: string,
    filterDate: string,
    initialCwd = ""
): ReturnType<typeof parseTranscript> {
    let activityStart: Date | null = null;
    let activityEnd: Date | null = null;
    let userCount = 0;
    let assistantCount = 0;
    const humanInputs: HumanInput[] = [];
    const seenInput = new Set<string>();

    const touchActivity = (ts: Date | null | undefined): void => {
        if (!ts || !isTimestampOnLocalDate(ts, filterDate)) return;
        if (!activityStart || ts < activityStart) activityStart = ts;
        if (!activityEnd || ts > activityEnd) activityEnd = ts;
    };

    let rows: Array<{ key: string; value: string }> = [];
    try {
        rows = db
            .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE ? ORDER BY key")
            .all(`bubbleId:${sessionId}:%`) as Array<{ key: string; value: string }>;
    } catch {
        rows = [];
    }

    for (const row of rows) {
        let data: Record<string, unknown>;
        try {
            data = JSON.parse(row.value) as Record<string, unknown>;
        } catch {
            continue;
        }

        const ts = parseTsValue(data["createdAt"] ?? data["created_at"] ?? data["timestamp"]);
        if (!ts || !isTimestampOnLocalDate(ts, filterDate)) continue;

        const type = data["type"];
        const text = bubbleText(data);
        touchActivity(ts);

        if (type === 1) {
            userCount++;
            const extracted = extractHumanInputText(text);
            const norm = extracted.slice(0, 200);
            if (extracted && extracted.length <= 1500 && !seenInput.has(norm)) {
                seenInput.add(norm);
                humanInputs.push({
                    category: classifyHumanInput(extracted),
                    content: extracted,
                    session_agent: "cursor-gui",
                    session_time: formatIsoTime(ts),
                    start_time: formatIsoTime(ts),
                    end_time: formatIsoTime(ts),
                    files_changed: 0,
                    lines_added: 0,
                    lines_deleted: 0,
                });
            }
            continue;
        }

        if (type === 2 && text) {
            assistantCount++;
        }
    }

    return {
        cwd: initialCwd,
        files: [],
        repos: [],
        messageStats: {user: userCount, assistant: assistantCount, tool_calls: 0},
        humanInputs,
        activityStart,
        activityEnd,
    };
}

function fallbackSessionName(projectDir: string, sid: string): string {
    const shortId = sid.slice(0, 8);
    const cwd = decodeCursorProjectDirToCwd(projectDir);
    if (cwd) {
        const parts = cwd.split("/").filter(Boolean);
        const repo = parts[parts.length - 1] ?? "";
        if (repo) return `${repo}/${shortId}`;
    }
    const normalizedProject = (projectDir ?? "").trim();
    if (normalizedProject && normalizedProject !== "agent-transcripts") {
        return `${normalizedProject}/${shortId}`;
    }
    return shortId;
}

function collectGuiSessionsFromTranscripts(filterDate: string): GuiSession[] {
    const root = cursorProjectsDir();
    let projectDirs: string[] = [];
    try {
        projectDirs = readdirSync(root, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
    } catch {
        return [];
    }

    const out: GuiSession[] = [];
    const seen = new Set<string>();
    const db = tryOpenCursorStateDb();
    try {
        for (const project of projectDirs) {
        const atRoot = join(root, project, "agent-transcripts");
        let sessionDirs: string[] = [];
        try {
            sessionDirs = readdirSync(atRoot, { withFileTypes: true })
                .filter((e) => e.isDirectory())
                .map((e) => e.name);
        } catch {
            continue;
        }

        for (const sid of sessionDirs) {
            const jsonl = join(atRoot, sid, `${sid}.jsonl`);
            if (!existsSync(jsonl) || seen.has(sid)) continue;
            seen.add(sid);

            const parsed = parseTranscript(sid, filterDate, {db: db ?? undefined});
            const hasActivity =
                parsed.messageStats.user > 0 ||
                parsed.messageStats.assistant > 0 ||
                parsed.files.length > 0;
            if (!hasActivity) continue;

            const name = fallbackSessionName(project, sid);
            let createdAt = parsed.activityStart;
            let endAt = parsed.activityEnd ?? parsed.activityStart;
            if (!createdAt || !endAt) {
                try {
                    const mtime = statSync(jsonl).mtime;
                    createdAt = createdAt ?? mtime;
                    endAt = endAt ?? mtime;
                } catch {
                    createdAt = createdAt ?? new Date();
                    endAt = endAt ?? createdAt;
                }
            }

            out.push({
                id: sid,
                name,
                created_at_ms: createdAt.getTime(),
                last_updated_at_ms: endAt.getTime(),
                model: "",
                header_count: parsed.messageStats.user + parsed.messageStats.assistant,
                activity_start: createdAt,
                activity_end: endAt,
                cwd: parsed.cwd,
                files_changed: parsed.files,
                repos_touched: parsed.repos,
                message_stats: parsed.messageStats,
                human_inputs: parsed.humanInputs.length > 0 ? parsed.humanInputs : undefined,
            });
        }
        }
    } finally {
        db?.close();
    }
    return out;
}

/**
 * Get the bubble timestamps for a Cursor composer session.
 * Queries cursorDiskKV for bubble entries keyed as bubbleId:{composerId}:*
 */
export function getGuiSessionBubbleTimestamps(
    db: DatabaseType,
    composerId: string
): { start: Date | null; end: Date | null } {
    try {
        const rows = db
            .prepare("SELECT value FROM cursorDiskKV WHERE key LIKE ?")
            .all(`bubbleId:${composerId}:%`) as Array<{ value: string }>;

        let start: Date | null = null;
        let end: Date | null = null;

        for (const row of rows) {
            try {
                const parsed = JSON.parse(row.value) as Record<string, unknown>;
                const createdAt = parsed["createdAt"] as number | string | undefined;
                if (!createdAt) continue;

                const d = new Date(typeof createdAt === "number" ? createdAt : createdAt);
                if (isNaN(d.getTime())) continue;

                if (!start || d < start) start = d;
                if (!end || d > end) end = d;
            } catch {
                // ignore parse errors
            }
        }

        return {start, end};
    } catch {
        return {start: null, end: null};
    }
}

/**
 * Collect Cursor GUI (Composer) sessions from the state.vscdb for a given date.
 * A session is included when its [createdAt, lastUpdatedAt] range overlaps the target local day.
 */
export function collectGuiSessions(filterDate: string): GuiSession[] {
    const candidates = cursorStateDbCandidates();
    let dbPath: string | null = null;

    for (const p of candidates) {
        if (existsSync(p)) {
            dbPath = p;
            break;
        }
    }

    if (!dbPath) {
        return collectGuiSessionsFromTranscripts(filterDate);
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(dbPath, {readonly: true});

    try {
        const {startMs, endMs} = dayBoundsMs(filterDate);

        let rows: Array<{ key: string; value: string }> = [];
        try {
            rows = db
                .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
                .all() as Array<{ key: string; value: string }>;
        } catch {
            // Table might not exist in older versions
            return collectGuiSessionsFromTranscripts(filterDate);
        }

        const sessions: GuiSession[] = [];

        for (const row of rows) {
            try {
                const data = JSON.parse(row.value) as Record<string, unknown>;
                const composerId = (data["composerId"] ?? row.key.replace("composerData:", "")) as string;
                const name = (data["name"] ?? data["title"] ?? "") as string;
                const createdAtMs = (data["createdAt"] ?? data["created_at"] ?? 0) as number;
                const lastUpdatedAtMs = (data["lastUpdatedAt"] ?? data["last_updated_at"] ?? createdAtMs) as number;
                const model = (data["selectedModelId"] ?? data["model"] ?? "") as string;
                const headerCount = (data["headerCount"] ?? 0) as number;
                const cwd = cwdFromWorkspaceIdentifier(data);

                if (!createdAtMs) continue;
                if (!activityOverlapsLocalDate(createdAtMs, lastUpdatedAtMs || createdAtMs, filterDate)) {
                    continue;
                }

                // Use created_at/last_updated_at as activity bounds (skipping per-bubble queries on large DBs).
                // Clamp activity_end to end-of-day so multi-day sessions don't show a future timestamp.
                const activityStartMs = Math.max(createdAtMs, startMs);
                const clampedEndMs = lastUpdatedAtMs
                    ? Math.min(Math.max(lastUpdatedAtMs, activityStartMs), endMs)
                    : Math.min(createdAtMs, endMs);
                sessions.push({
                    id: composerId,
                    name,
                    created_at_ms: createdAtMs,
                    last_updated_at_ms: lastUpdatedAtMs,
                    model,
                    header_count: headerCount,
                    activity_start: new Date(activityStartMs),
                    activity_end: new Date(clampedEndMs),
                    cwd,
                    files_changed: [],
                    repos_touched: [],
                    message_stats: { user: 0, assistant: 0, tool_calls: 0 },
                });
            } catch {
                // skip malformed entries
            }
        }

        for (let i = 0; i < sessions.length; i++) {
            const parsed = parseTranscript(sessions[i].id, filterDate, {
                lastUpdatedAtMs: sessions[i].last_updated_at_ms,
                initialCwd: sessions[i].cwd,
                db,
            });
            const dayParsed = (
                parsed.messageStats.user > 0 ||
                parsed.messageStats.assistant > 0 ||
                parsed.files.length > 0
            )
                ? parsed
                : parseBubbleSession(db, sessions[i].id, filterDate, sessions[i].cwd);
            sessions[i] = {
                ...sessions[i],
                cwd: dayParsed.cwd || sessions[i].cwd,
                files_changed: dayParsed.files,
                repos_touched: dayParsed.repos,
                message_stats: dayParsed.messageStats,
                human_inputs: dayParsed.humanInputs.length > 0 ? dayParsed.humanInputs : undefined,
            };
            applyParsedDayActivity(sessions[i], dayParsed);
        }

        const activeSessions = sessions.filter(sessionHasDayActivity);
        return sessions.length > 0 ? activeSessions : collectGuiSessionsFromTranscripts(filterDate);
    } finally {
        db.close();
    }
}
