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
 *     Per-bubble timestamps (keys "bubbleId:<composerId>:*") are intentionally NOT queried —
 *     scanning 1000+ LIKE patterns on a 3+ GB database causes multi-minute hangs.
 *   - Model: selectedModelId field
 *   - Cost / tokens: NOT available locally; fetched separately by cursor-api.ts
 *     only when CURSOR_ACCESS_TOKEN or CURSOR_SESSION_TOKEN is set.
 */
import {existsSync, readFileSync, readdirSync, statSync} from "node:fs";
import {join} from "node:path";
import {createRequire} from "node:module";
import type {Database as DatabaseType} from "better-sqlite3";
import {activityOverlapsLocalDate, dayBoundsMs, isTimestampOnLocalDate, localDateString} from "../date-utils.js";
import {cursorProjectsDir, cursorStateDbCandidates} from "../paths.js";
import {FileChange, HumanInput, RepoTouched} from "../types.js";
import {gitRemoteRepo, gitFileNumstat} from "../git.js";

const require = createRequire(import.meta.url);
const USER_QUERY_RE = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/i;
const TS_TAG_RE = /<timestamp>([^<]+)<\/timestamp>/i;
const PATCH_FILE_RE = /^\*\*\* (?:Update|Add) File: (.+)$/;

function decodeCursorProjectDirToCwd(projectDir: string): string {
    const trimmed = (projectDir ?? "").trim();
    if (!trimmed || trimmed === "agent-transcripts") return "";
    try {
        // Cursor project dir is commonly an encoded workspace path.
        // Example: media-spx-work-github-flow-cawplan-skill -> /media/spx/work/github/flow-cawplan-skill
        const decoded = decodeURIComponent(trimmed.replace(/-/g, "%2F").replace(/%252F/g, "-"));
        const normalized = decoded.startsWith("/") ? decoded : `/${decoded}`;
        return existsSync(normalized) ? normalized : "";
    } catch {
        return "";
    }
}

function inferCwdFromTranscriptPath(transcriptPath: string, projectsRoot: string): string {
    const prefix = `${projectsRoot}/`;
    if (!transcriptPath.startsWith(prefix)) return "";
    const rest = transcriptPath.slice(prefix.length);
    const first = rest.split("/")[0] ?? "";
    return decodeCursorProjectDirToCwd(first);
}

function classifyHumanInput(text: string): HumanInput["category"] {
    const lower = text.toLowerCase();
    const has = (arr: string[]) => arr.some((w) => lower.includes(w));
    if (has(["决定", "決定", "采用", "採用", "改成", "改為", "最终", "最終", "结论", "結論", "agreed", "decide", "decision"])) {
        return "decision";
    }
    if (has(["修复", "修復", "修正", "报错", "報錯", "错误", "錯誤", "不对", "不對", "bug", "fix", "failed"])) {
        return "correction";
    }
    if (has(["计划", "計劃", "方案", "下一步", "roadmap", "plan", "planning", "排期"])) {
        return "planning";
    }
    return "direction";
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

    return {path: getPath(), added: 0, deleted: 0};
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

function parseTranscript(sessionId: string, filterDate?: string): {
    cwd: string;
    files: FileChange[];
    repos: RepoTouched[];
    messageStats: { user: number; assistant: number; tool_calls: number };
    humanInputs: HumanInput[];
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
        };
    }

    const lines = readFileSync(transcriptPath, "utf-8").split("\n");
    let cwd = inferCwdFromTranscriptPath(transcriptPath, projectsRoot);
    let userCount = 0;
    let assistantCount = 0;
    let toolCallCount = 0;
    const files: FileChange[] = [];
    const fileIndex = new Map<string, number>();
    const humanInputs: HumanInput[] = [];
    let currentPromptOnDate = filterDate ? false : true;
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
                const promptTs = parseEventTimestamp(obj, message, textAcc);
                currentPromptOnDate = !filterDate || (!!promptTs && isTimestampOnLocalDate(promptTs, filterDate));
                if (!currentPromptOnDate) {
                    currentContext = null;
                    continue;
                }
                userCount++;
                const norm = textAcc.slice(0, 200);
                const extracted = extractHumanInputText(textAcc);
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
            const assistantOnDate = !filterDate ||
                (eventTs ? isTimestampOnLocalDate(eventTs, filterDate) : currentPromptOnDate);
            if (!assistantOnDate) continue;
            assistantCount++;
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
                const delta = estimateDeltaFromToolInput(toolName, rawInput);
                const p = delta.path ?? pickPathFromInput(input);
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

    for (const ctx of contexts) {
        const h = humanInputs[ctx.idx];
        if (!h) continue;
        const start = ctx.start ?? ctx.firstTool;
        const end = ctx.lastTool ?? start;
        h.files_changed = ctx.files.size;
        h.lines_added = ctx.linesAdded;
        h.lines_deleted = ctx.linesDeleted;
        h.start_time = formatIsoTime(start);
        h.end_time = formatIsoTime(end);
        h.session_time = h.start_time;
    }

    const repo = gitRemoteRepo(cwd);
    let totalAdded = 0;
    let totalDeleted = 0;
    for (const f of files) {
        f.repo = repo;
        const stat = gitFileNumstat(cwd, f.path);
        if (stat.added !== 0 || stat.deleted !== 0) {
            f.added = stat.added;
            f.deleted = stat.deleted;
        }
        totalAdded += f.added ?? 0;
        totalDeleted += f.deleted ?? 0;
    }
    const repos: RepoTouched[] = repo
        ? [{ repo, files: files.length, added: totalAdded, deleted: totalDeleted }]
        : [];

    return {
        cwd,
        files,
        repos,
        messageStats: { user: userCount, assistant: assistantCount, tool_calls: toolCallCount },
        humanInputs: humanInputs.length > 0 ? humanInputs : [],
    };
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

            let userCount = 0;
            let assistantCount = 0;
            let toolCalls = 0;
            let firstTs: Date | null = null;
            let lastTs: Date | null = null;
            let name = fallbackSessionName(project, sid);
            let cwd = decodeCursorProjectDirToCwd(project);
            const files: FileChange[] = [];
            const fileIndex = new Map<string, number>();
            const humanInputs: HumanInput[] = [];
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
            let currentPromptOnDate = false;
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
            const lines = readFileSync(jsonl, "utf-8").split("\n");
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
                    let textCombined = "";
                    for (const c of content) {
                        const b = c as Record<string, unknown>;
                        if (b["type"] !== "text") continue;
                        const text = String(b["text"] ?? "").trim();
                        if (!text) continue;
                        textCombined = textCombined ? `${textCombined}\n${text}` : text;
                    }
                    if (textCombined) {
                        const ts = parseEventTimestamp(obj, message, textCombined);
                        currentPromptOnDate = !filterDate || (!!ts && isTimestampOnLocalDate(ts, filterDate));
                        if (!currentPromptOnDate) continue;
                        userCount++;
                        if (ts) {
                            if (!firstTs || ts < firstTs) firstTs = ts;
                            if (!lastTs || ts > lastTs) lastTs = ts;
                        }
                        if (textCombined.length <= 1500) {
                            const extracted = extractHumanInputText(textCombined);
                            if (!extracted) continue;
                            const inputIdx = humanInputs.length;
                            humanInputs.push({
                                category: classifyHumanInput(extracted),
                                content: extracted,
                                session_title: name,
                                session_agent: "cursor-gui",
                                session_time: formatIsoTime(ts),
                                start_time: formatIsoTime(ts),
                                end_time: formatIsoTime(ts),
                                files_changed: 0,
                                lines_added: 0,
                                lines_deleted: 0,
                            });
                            currentContext = {
                                idx: inputIdx,
                                start: ts,
                                firstTool: null,
                                lastTool: null,
                                files: new Set<string>(),
                                linesAdded: 0,
                                linesDeleted: 0,
                            };
                            contexts.push(currentContext);
                        }
                    }
                } else if (role === "assistant" && Array.isArray(content)) {
                    const eventTs = parseEventTimestamp(obj, message);
                    const assistantOnDate = !filterDate ||
                        (eventTs ? isTimestampOnLocalDate(eventTs, filterDate) : currentPromptOnDate);
                    if (!assistantOnDate) continue;
                    assistantCount++;
                    if (eventTs) {
                        if (!firstTs || eventTs < firstTs) firstTs = eventTs;
                        if (!lastTs || eventTs > lastTs) lastTs = eventTs;
                    }
                    for (const c of content) {
                        const b = c as Record<string, unknown>;
                        if (b["type"] !== "tool_use") continue;
                        toolCalls++;
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
                        if (!cwd && typeof input["working_directory"] === "string") cwd = String(input["working_directory"]);
                        const toolName = typeof b["name"] === "string" ? b["name"] : "";
                        const delta = estimateDeltaFromToolInput(toolName, rawInput);
                        const p = delta.path ??
                            (input["path"] ?? input["file_path"] ?? input["target_file"] ?? input["target_notebook"]) as string | undefined;
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

            for (const ctx of contexts) {
                const h = humanInputs[ctx.idx];
                if (!h) continue;
                const start = ctx.start ?? ctx.firstTool;
                const end = ctx.lastTool ?? start;
                h.files_changed = ctx.files.size;
                h.lines_added = ctx.linesAdded;
                h.lines_deleted = ctx.linesDeleted;
                h.start_time = formatIsoTime(start);
                h.end_time = formatIsoTime(end);
                h.session_time = h.start_time;
            }

            // Filter by target day using parsed timestamps, fallback to mtime
            let active = false;
            if (firstTs || lastTs) {
                const inDate = (d: Date | null) => !!d && localDateString(d) === filterDate;
                active = inDate(firstTs) || inDate(lastTs);
            } else {
                try {
                    const mtimeDate = localDateString(statSync(jsonl).mtime);
                    active = mtimeDate === filterDate;
                } catch {
                    active = false;
                }
            }
            if (!active) continue;

            const repo = gitRemoteRepo(cwd);
            let totalAdded = 0;
            let totalDeleted = 0;
            for (const f of files) {
                f.repo = repo;
                const stat = gitFileNumstat(cwd, f.path);
                if (stat.added !== 0 || stat.deleted !== 0) {
                    f.added = stat.added;
                    f.deleted = stat.deleted;
                }
                totalAdded += f.added ?? 0;
                totalDeleted += f.deleted ?? 0;
            }
            const reposTouched: RepoTouched[] = repo ? [{ repo, files: files.length, added: 0, deleted: 0 }] : [];
            if (reposTouched.length > 0) {
                reposTouched[0].added = totalAdded;
                reposTouched[0].deleted = totalDeleted;
            }
            const createdAt = firstTs ?? lastTs ?? new Date();
            const endAt = lastTs ?? firstTs ?? createdAt;
            out.push({
                id: sid,
                name,
                created_at_ms: createdAt.getTime(),
                last_updated_at_ms: endAt.getTime(),
                model: "",
                header_count: userCount + assistantCount,
                activity_start: createdAt,
                activity_end: endAt,
                cwd,
                files_changed: files,
                repos_touched: reposTouched,
                message_stats: { user: userCount, assistant: assistantCount, tool_calls: toolCalls },
                human_inputs: humanInputs.length > 0 ? humanInputs : undefined,
            });
        }
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
                    cwd: "",
                    files_changed: [],
                    repos_touched: [],
                    message_stats: { user: 0, assistant: 0, tool_calls: 0 },
                });
            } catch {
                // skip malformed entries
            }
        }

        for (let i = 0; i < sessions.length; i++) {
            const parsed = parseTranscript(sessions[i].id, filterDate);
            sessions[i] = {
                ...sessions[i],
                cwd: parsed.cwd,
                files_changed: parsed.files,
                repos_touched: parsed.repos,
                message_stats: parsed.messageStats,
                human_inputs: parsed.humanInputs.length > 0 ? parsed.humanInputs : undefined,
            };
        }

        return sessions.length > 0 ? sessions : collectGuiSessionsFromTranscripts(filterDate);
    } finally {
        db.close();
    }
}
