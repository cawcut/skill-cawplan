import {writeFileSync, mkdirSync} from "node:fs";
import {dirname} from "node:path";
import {CollectOptions, DailyApiJson} from "./types.js";
import {gitAuthor, gitRemoteRepo} from "./git.js";
import {
    collectClaudeCodeSession,
    findSessionsByDate,
    mergeCompactionContinuations,
    type CollectedClaudeSession,
} from "./agents/claude-code.js";
import {collectGuiSessions} from "./agents/cursor-gui.js";
import {collectCursorCliSessions} from "./agents/cursor-cli.js";
import {collectCodexSessions} from "./agents/codex.js";
import {
    buildSessionCookie,
    fetchUsageEvents,
    aggregateCursorUsage,
    aggregateCursorUsageBySession,
    buildCursorAttributionWindows,
    refineCursorHumanInputsFromBillingEvents,
    refineHumanInputsFromAttributedEvents,
} from "./agents/cursor-api.js";
import {buildDailyApiJson} from "./aggregators/daily.js";
import {SessionData} from "./types.js";
import {findLocalProductMappingForDir} from "../user-config.js";
import {
    applyHumanInputTicketRefsToSessions,
    normalizeSessionTicketIdsToUniqueIds,
} from "../ai-session/ticket-context.js";

function formatElapsed(ms: number): string {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function createCollectLogger(enabled: boolean): {
    log: (message: string) => void;
    step: <T>(label: string, run: () => T) => T;
} {
    const startedAt = Date.now();
    const log = (message: string) => {
        if (!enabled) return;
        console.error(`[collect +${formatElapsed(Date.now() - startedAt)}] ${message}`);
    };
    return {
        log,
        step: <T>(label: string, run: () => T): T => {
            log(`${label}...`);
            const stepStartedAt = Date.now();
            try {
                const result = run();
                log(`${label} done in ${formatElapsed(Date.now() - stepStartedAt)}.`);
                return result;
            } catch (e) {
                log(`${label} failed after ${formatElapsed(Date.now() - stepStartedAt)}: ${(e as Error).message}`);
                throw e;
            }
        },
    };
}

/**
 * Get the start and end of a date in local time as Unix milliseconds.
 */
function dayBoundsMs(date: string): { startMs: number; endMs: number } {
    const startMs = new Date(date + "T00:00:00").getTime();
    const endMs = new Date(date + "T23:59:59.999").getTime();
    return {startMs, endMs};
}

function toRepoName(repo?: string): string | undefined {
    if (!repo) return undefined;
    const trimmed = repo.trim();
    if (!trimmed) return undefined;
    const parts = trimmed.split("/");
    return parts[parts.length - 1] || trimmed;
}

function inferCursorProject(gs: {
    id: string;
    cwd?: string;
    repos_touched?: { repo: string; files: number }[];
}): string {
    if (gs.repos_touched && gs.repos_touched.length > 0) {
        const topRepo = [...gs.repos_touched]
            .sort((a, b) => (b.files ?? 0) - (a.files ?? 0))
            .find((r) => !!r.repo);
        const repoName = toRepoName(topRepo?.repo);
        if (repoName) return repoName;
    }

    const cwd = (gs.cwd ?? "").trim();
    if (cwd) {
        const segs = cwd.split("/").filter(Boolean);
        const last = segs[segs.length - 1];
        if (last) return last;
    }

    return gs.id.slice(0, 8);
}

export function normalizeSessionRepoContext(sessions: SessionData[], resolveRepo = gitRemoteRepo): void {
    for (const session of sessions) {
        const localMapping = session.cwd ? findLocalProductMappingForDir(session.cwd) : undefined;
        if (localMapping) {
            session.product_id = localMapping.product_id;
            session.product_name = undefined;
        }

        const cwd = (session.cwd ?? "").trim();
        if (cwd) {
            const resolvedRepo = (resolveRepo(cwd) ?? "").trim();
            const repoName = toRepoName(resolvedRepo);
            // gitRemoteRepo() returns the original cwd as a fallback when it cannot
            // read a git remote. Treat only a different value as a real repo match.
            if (repoName && resolvedRepo !== cwd) {
                session.project = repoName;
                continue;
            }
        }

        const topRepo = [...(session.repos_touched ?? [])]
            .sort((a, b) => (b.files ?? 0) - (a.files ?? 0))
            .find((r) => !!r.repo);
        const topRepoName = toRepoName(topRepo?.repo_name ?? topRepo?.repo_url ?? topRepo?.repo);
        if (topRepoName) {
            session.project = topRepoName;
            continue;
        }
    }
}

function inferCursorTitle(gs: {
    name?: string;
    id: string;
    human_inputs?: Array<{ content?: string }>;
}): string {
    const fromHuman = (gs.human_inputs ?? [])
        .map((h) => String(h.content ?? "").trim())
        .find((text) => text.length > 0);
    if (fromHuman) {
        const oneLine = fromHuman.replace(/\s+/g, " ").trim();
        return oneLine.length > 40 ? `${oneLine.slice(0, 40)}...` : oneLine;
    }
    return gs.name || gs.id.slice(0, 8);
}

export function enrichCursorGuiFallbackContext(sessions: SessionData[]): void {
    const gui = sessions.filter((s) => s.agent === "cursor-gui");
    if (gui.length === 0) return;

    for (const s of gui) {
        if (s.project && s.project.length > 8) continue;
        const ownRepo = [...(s.repos_touched ?? [])]
            .sort((a, b) => (b.files ?? 0) - (a.files ?? 0))
            .find((r) => !!r.repo);
        const ownRepoName = toRepoName(ownRepo?.repo);
        if (ownRepoName) s.project = ownRepoName;
    }
}

/**
 * Collect all coding session data for a given date and return a DailyApiJson.
 */
export async function collect(opts: CollectOptions): Promise<DailyApiJson> {
    const date = opts.date;
    const logger = createCollectLogger(Boolean(opts.verbose));
    const author = logger.step("Resolve git author", () => gitAuthor());
    const sessions: SessionData[] = [];

    const defaultAgents: CollectOptions["agents"] = ["claude-code", "cursor", "codex"];
    const targetAgents = opts.agents ?? defaultAgents;
    logger.log(`Target agents: ${targetAgents.join(", ")}`);

    // Collect Claude Code sessions
    if (targetAgents.includes("claude-code")) {
        const claudeSessions = logger.step("Discover Claude Code sessions", () => findSessionsByDate(date, undefined, {
            log: logger.log,
        }));
        logger.log(`Found ${claudeSessions.length} Claude Code candidate session(s).`);
        const collectedClaudeSessions: CollectedClaudeSession[] = [];
        for (const {jsonlPath, projectName, sessionId} of claudeSessions) {
            try {
                const s = logger.step(`Collect Claude Code session ${sessionId}`, () =>
                    collectClaudeCodeSession(jsonlPath, projectName, sessionId, date, {
                        log: logger.log,
                    })
                );
                // Skip sessions with no activity on this date (multi-day sessions overlap detected
                // by file date range, but the session may have zero events on the target date)
                if (s.message_stats.user === 0 && s.message_stats.assistant === 0) {
                    logger.log(`Skip Claude Code session ${sessionId}: no activity on ${date}.`);
                    continue;
                }
                collectedClaudeSessions.push({jsonlPath, sessionId, session: s});
            } catch (e) {
                console.warn(`Warning: claude-code session ${sessionId}: ${(e as Error).message}`);
            }
        }
        // Claude Code's auto-compact splits one long work thread across multiple
        // session files; merge those back into a single reported session so they
        // don't show up as several duplicate-looking entries in the same report.
        const mergedClaudeSessions = logger.step("Merge Claude compaction-continuation sessions", () =>
            mergeCompactionContinuations(collectedClaudeSessions, {log: logger.log})
        );
        sessions.push(...mergedClaudeSessions);
    }

    // Collect Cursor GUI sessions
    if (targetAgents.includes("cursor")) {
        try {
            const guiSessions = logger.step("Collect Cursor GUI sessions", () => collectGuiSessions(date, {
                log: logger.log,
            }));
            logger.log(`Found ${guiSessions.length} Cursor GUI candidate session(s).`);
            // Convert GuiSession to SessionData — skip sessions with no activity.
            for (const gs of guiSessions) {
                if (
                    gs.message_stats.user === 0 &&
                    gs.message_stats.assistant === 0 &&
                    gs.files_changed.length === 0
                ) {
                    logger.log(`Skip Cursor GUI session ${gs.id}: no activity on ${date}.`);
                    continue;
                }
                const actStart = gs.activity_start;
                const actEnd = gs.activity_end ?? gs.activity_start;

                let timeDisplay = "unknown";
                let startLocal: string | undefined;
                if (actStart) {
                    const formatT = (d: Date) =>
                        `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
                    timeDisplay = actEnd
                        ? `${formatT(actStart)} - ${formatT(actEnd)}`
                        : formatT(actStart);
                    startLocal = actStart.toISOString();
                }

                sessions.push({
                    schema: "2.0",
                    date,
                    agent: "cursor-gui",
                    session_id: gs.id,
                    session_name: gs.name || gs.id.slice(0, 8),
                    title: inferCursorTitle(gs),
                    project: inferCursorProject(gs),
                    cwd: gs.cwd ?? "",
                    time_range: {
                        display: timeDisplay,
                        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                        start: startLocal,
                    },
                    model_usage: {},
                    usage_breakdown: [],
                    files_changed: gs.files_changed.length,
                    files_added: gs.files_changed.reduce((sum, f) => sum + (f.added ?? 0), 0),
                    files_deleted: gs.files_changed.reduce((sum, f) => sum + (f.deleted ?? 0), 0),
                    repos_touched: gs.repos_touched,
                    message_stats: gs.message_stats,
                    human_inputs: gs.human_inputs?.map((h) => ({
                        ...h,
                        session_title: h.session_title ?? (gs.name || gs.id.slice(0, 8)),
                        session_agent: h.session_agent ?? "cursor-gui",
                    })),
                });
            }
        } catch (e) {
            console.warn(`Warning: cursor-gui: ${(e as Error).message}`);
        }
    }

    // Collect Cursor CLI sessions
    if (targetAgents.includes("cursor")) {
        try {
            const cliSessions = logger.step("Collect Cursor CLI sessions", () => collectCursorCliSessions(date, {
                log: logger.log,
            }));
            logger.log(`Collected ${cliSessions.length} Cursor CLI session(s).`);
            sessions.push(...cliSessions);
        } catch (e) {
            console.warn(`Warning: cursor-cli: ${(e as Error).message}`);
        }
    }

    // Collect Codex sessions
    if (targetAgents.includes("codex")) {
        try {
            const codexSessions = logger.step("Collect Codex sessions", () => collectCodexSessions(date, {
                log: logger.log,
            }));
            logger.log(`Collected ${codexSessions.length} Codex session(s).`);
            sessions.push(...codexSessions);
        } catch (e) {
            console.warn(`Warning: codex: ${(e as Error).message}`);
        }
    }

    logger.step("Enrich Cursor GUI fallback context", () => enrichCursorGuiFallbackContext(sessions));
    logger.step("Normalize session repository context", () => normalizeSessionRepoContext(sessions));
    logger.log("Apply human input ticket refs to sessions...");
    let humanInputTicketLinks = 0;
    try {
        humanInputTicketLinks = await applyHumanInputTicketRefsToSessions(sessions);
    } catch (e) {
        console.warn(`Warning: ticket context linking: ${(e as Error).message}`);
    }
    try {
        const normalized = await normalizeSessionTicketIdsToUniqueIds(sessions);
        logger.log(`Applied ${humanInputTicketLinks} human input ticket link(s); normalized ${normalized} display ID(s).`);
    } catch (e) {
        console.warn(`Warning: ticket context normalization: ${(e as Error).message}`);
        logger.log(`Applied ${humanInputTicketLinks} human input ticket link(s).`);
    }

    // Fetch Cursor API exact usage data
    let cursorApiUsage:
        | { byModel: Record<string, import("./types.js").ModelUsageEntry>; totalCost: number; currency: string }
        | undefined;

    if (targetAgents.includes("cursor")) {
        try {
            const {cookie} = logger.step("Build Cursor Dashboard session cookie", () => buildSessionCookie());
            const {startMs, endMs} = dayBoundsMs(date);
            logger.log(`Fetch Cursor Dashboard usage events for ${new Date(startMs).toISOString()} - ${new Date(endMs).toISOString()}...`);
            const cursorApiStartedAt = Date.now();
            const events = await fetchUsageEvents(startMs, endMs, cookie);
            logger.log(`Fetched ${events.length} Cursor Dashboard usage event(s) in ${formatElapsed(Date.now() - cursorApiStartedAt)}.`);

            // First try session-level attribution (uid-team style)
            const cursorSessions = sessions.filter((s) => s.agent === "cursor-gui" || s.agent === "cursor-cli");
            logger.step("Refine Cursor human input windows from billing events", () =>
                refineCursorHumanInputsFromBillingEvents(cursorSessions, events, date, false)
            );
            let windows = logger.step("Build Cursor attribution windows", () =>
                buildCursorAttributionWindows(cursorSessions, date)
            );
            let bySession = logger.step("Aggregate Cursor usage by session", () =>
                aggregateCursorUsageBySession(events, date, windows)
            );
            let attributedSessions = 0;
            const applyCursorAttribution = (): number => {
                let count = 0;
                for (const s of sessions) {
                    const assigned = bySession[s.session_id];
                    if (!assigned) continue;
                    s.model_usage = assigned.modelUsage;
                    s.usage_breakdown = assigned.usageBreakdown;
                    if (assigned.humanInputCosts && s.human_inputs?.length) {
                        s.human_inputs = s.human_inputs.map((h, i) => ({
                            ...h,
                            usage_cost: assigned.humanInputCosts?.[i],
                            api_calls: assigned.humanInputApiCalls?.[i],
                        }));
                    }
                    count++;
                }
                return count;
            };
            attributedSessions = logger.step("Apply Cursor usage attribution", () => applyCursorAttribution());
            logger.log(`Attributed Cursor usage to ${attributedSessions} session(s).`);

            if (attributedSessions > 0) {
                logger.step("Refine human inputs from attributed Cursor events", () =>
                    refineHumanInputsFromAttributedEvents(cursorSessions, events, date, windows)
                );
                windows = logger.step("Rebuild Cursor attribution windows", () =>
                    buildCursorAttributionWindows(cursorSessions, date)
                );
                bySession = logger.step("Re-aggregate Cursor usage by session", () =>
                    aggregateCursorUsageBySession(events, date, windows)
                );
                attributedSessions = logger.step("Re-apply Cursor usage attribution", () => applyCursorAttribution());
                logger.log(`Re-attributed Cursor usage to ${attributedSessions} session(s).`);
            }

            // Fallback: if no session got attribution, keep global model rollup behavior.
            if (attributedSessions === 0) {
                cursorApiUsage = logger.step("Aggregate Cursor usage globally", () => aggregateCursorUsage(events, date));
            }
        } catch (e) {
            console.warn(`Warning: cursor API: ${(e as Error).message}`);
        }
    }

    const daily = logger.step("Build daily API JSON", () => buildDailyApiJson(sessions, date, author, cursorApiUsage));

    if (opts.outputPath) {
        logger.step(`Write report to ${opts.outputPath}`, () => {
            mkdirSync(dirname(opts.outputPath!), {recursive: true});
            writeFileSync(opts.outputPath!, JSON.stringify(daily, null, 2), "utf-8");
        });
    }

    logger.log(`Collect finished with ${daily.sessions.length} session(s).`);
    return daily;
}
