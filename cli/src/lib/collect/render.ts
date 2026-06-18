import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {DailyApiJson, HumanInput, SessionData} from "./types.js";

interface SessionSummary {
    session_title?: string;
    human_input?: {
        decisions?: string[];
        direction?: string[];
        bugs?: string[];
        planning?: string[];
    };
    summary?: string;
    next_steps?: string[];
}

type SummaryMap = Record<string, SessionSummary>;

function toRepoName(repo?: string): string {
    const trimmed = String(repo ?? "").trim();
    if (!trimmed) return "";
    const parts = trimmed.split("/").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : trimmed;
}

function readJsonFile<T>(path: string): T | null {
    try {
        return JSON.parse(readFileSync(path, "utf-8")) as T;
    } catch {
        return null;
    }
}

function summaryKeyCandidates(session: SessionData): string[] {
    const shortId = session.session_id.slice(0, 8);
    const agent = renderAgent(session);
    return [
        `${agent}-${shortId}`,
        `${session.agent}-${shortId}`,
        `${agent}-${session.session_id}`,
        `${session.agent}-${session.session_id}`,
        shortId,
        session.session_id,
        session.session_name,
    ];
}

function loadSummaries(summariesDir: string): { byKey: SummaryMap; overallSummary: string } {
    if (!existsSync(summariesDir)) return {byKey: {}, overallSummary: ""};

    const byKey: SummaryMap = {};
    let overallSummary = "";
    const files = readdirSync(summariesDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
        const fullPath = join(summariesDir, file);
        const payload = readJsonFile<SessionSummary & { summary?: string }>(fullPath);
        if (!payload) continue;

        if (file === "_overall.json") {
            overallSummary = payload.summary ?? "";
            continue;
        }

        const key = file.replace(/\.json$/i, "");
        byKey[key] = payload;
    }
    return {byKey, overallSummary};
}

function pickSessionSummary(session: SessionData, summaryByKey: SummaryMap): SessionSummary {
    const candidates = summaryKeyCandidates(session);
    for (const key of candidates) {
        if (summaryByKey[key]) return summaryByKey[key];
    }
    const shortId = session.session_id.slice(0, 8);
    for (const [key, summary] of Object.entries(summaryByKey)) {
        if (key.endsWith(`-${shortId}`) || key === shortId || key === session.session_id) return summary;
    }
    return {};
}

function pickProject(session: SessionData): string {
    const repos = Array.isArray(session.repos_touched) ? session.repos_touched : [];
    if (!repos.length) return session.project ?? "";
    const top = [...repos].sort((a, b) => {
        if (a.files !== b.files) return b.files - a.files;
        const aLines = a.added + a.deleted;
        const bLines = b.added + b.deleted;
        if (aLines !== bLines) return bLines - aLines;
        return a.repo.localeCompare(b.repo);
    })[0];
    return toRepoName(top.repo) || session.project || "";
}

function renderAgent(session: SessionData): string {
    if (session.agent === "cursor") {
        return session.message_stats.tool_calls > 0 ? "cursor-gui" : "cursor-cli";
    }
    return session.agent;
}

function renderTimeRange(session: SessionData): string {
    return session.time_range.display ?? "";
}

function sessionModels(session: SessionData): string[] {
    return Object.keys(session.model_usage ?? {});
}

function enrichRenderedSessionContext(sessions: SessionData[]): SessionData[] {
    const knownRepos = Array.from(
        new Set(
            sessions.flatMap((s) => s.repos_touched ?? []).map((r) => String(r.repo ?? "").trim()).filter(Boolean)
        )
    );

    const fallbackRepo = knownRepos.length === 1 ? knownRepos[0] : "";
    const fallbackProject = toRepoName(fallbackRepo);

    return sessions.map((s) => {
        const next: SessionData = {...s};
        if ((!next.project || next.project.length <= 8) && fallbackProject) next.project = fallbackProject;
        if ((next.repos_touched?.length ?? 0) === 0 && fallbackRepo) {
            next.repos_touched = [{
                repo: fallbackRepo,
                files: next.files_changed,
                added: next.files_added ?? 0,
                deleted: next.files_deleted ?? 0,
            }];
        }
        return next;
    });
}

function flattenSummaryHumanInputs(
    session: SessionData,
    summary: SessionSummary
): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];
    const title = summary.session_title || session.session_name;
    const agent = renderAgent(session);
    const sessionTime = renderTimeRange(session);
    const models = sessionModels(session);
    const sessionModel = models.length > 0 ? models[0] ?? "" : "";
    const project = pickProject(session);

    const pushCategory = (
        category: HumanInput["category"],
        items: string[] | undefined
    ): void => {
        if (!Array.isArray(items)) return;
        for (const content of items) {
            const text = String(content || "").trim();
            if (!text) continue;
            result.push({
                category,
                content: text,
                session_title: title,
                session_agent: agent,
                session_time: sessionTime,
                session_model: sessionModel,
                project,
            });
        }
    };

    pushCategory("decision", summary.human_input?.decisions);
    pushCategory("direction", summary.human_input?.direction);
    pushCategory("correction", summary.human_input?.bugs);
    pushCategory("planning", summary.human_input?.planning);
    return result;
}

function buildTokenUsage(daily: DailyApiJson): Array<Record<string, unknown>> {
    return (daily.usage_breakdown ?? []).map((item) => ({
        model: item.model,
        speed: item.speed,
        service_tier: item.service_tier,
        effort: item.effort,
        agents: item.agents ?? [],
        input_tokens: item.input_tokens,
        output_tokens: item.output_tokens,
        cache_read_tokens: item.cache_read_input_tokens,
        api_calls: item.api_calls,
        total_tokens:
            item.input_tokens + item.output_tokens + item.cache_read_input_tokens + item.cache_creation_input_tokens,
        cost: typeof item.cost === "number" ? item.cost : 0,
        currency: item.currency,
        note: item.note ?? "",
    }));
}

function nonEmpty(v?: string | null): string | undefined {
    const t = (v ?? "").trim();
    return t.length > 0 ? t : undefined;
}

export function renderDailyApiJson(
    daily: DailyApiJson,
    summariesDir: string
): Record<string, unknown> {
    const {byKey, overallSummary} = loadSummaries(summariesDir);
    const normalizedSessions = enrichRenderedSessionContext(daily.sessions);
    const mergedSessions = normalizedSessions.map((session) => {
        const summary = pickSessionSummary(session, byKey);
        const stableTitle = summary.session_title ?? session.session_title ?? session.title ?? session.session_name;
        const {title: _legacyTitle, ...sessionWithoutLegacyTitle} = session;
        return {
            ...sessionWithoutLegacyTitle,
            session_title: stableTitle,
            project: pickProject(session),
            files_added: session.files_added ?? 0,
            files_deleted: session.files_deleted ?? 0,
            human_input: summary.human_input ?? {},
            summary: summary.summary ?? "",
        };
    });

    const summaryHumanInputs = mergedSessions.flatMap((session) =>
        flattenSummaryHumanInputs(
            session,
            pickSessionSummary(session, byKey)
        )
    );
    const combinedHumanInputs = summaryHumanInputs.length > 0
        ? summaryHumanInputs
        : daily.human_inputs.map((h) => {
            const matched = normalizedSessions.find((s) =>
                s.session_name === h.session_title || renderAgent(s) === h.session_agent || s.agent === h.session_agent
            );
            return {
                ...h,
                session_time: nonEmpty(h.session_time ?? h.start_time),
                session_model: h.session_model ?? (matched ? sessionModels(matched)[0] ?? "" : ""),
                project: h.project ?? (matched ? pickProject(matched) : ""),
                files_changed: h.files_changed ?? 0,
                lines_added: h.lines_added ?? 0,
                lines_deleted: h.lines_deleted ?? 0,
                start_time: nonEmpty(h.start_time ?? h.session_time),
                end_time: nonEmpty(h.end_time ?? h.start_time ?? h.session_time),
            };
        });

    const nextSteps = Object.values(byKey).flatMap((s) =>
        Array.isArray(s.next_steps) ? s.next_steps.filter((x) => String(x || "").trim().length > 0) : []
    );
    const fallbackSummary = mergedSessions
        .map((s) => String(s.summary || "").trim())
        .filter((s) => s.length > 0)
        .join(" ");

    return {
        schema: daily.schema,
        date: daily.date,
        author: daily.author,
        generated_at: daily.generated_at,
        include_conversation: daily.include_conversation,
        summary: overallSummary || fallbackSummary,
        totals: daily.totals,
        usage_breakdown: daily.usage_breakdown,
        model_usage: daily.model_usage,
        sessions: mergedSessions,
        repos: daily.repos,
        human_inputs: combinedHumanInputs,
        next_steps: nextSteps,
        token_usage: buildTokenUsage(daily),
    };
}
