import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DailyApiJson, HumanInput, SessionData } from "./types.js";

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

function readJsonFile<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function summaryKeyCandidates(session: SessionData): string[] {
  const shortId = session.session_id.slice(0, 8);
  return [
    `${session.agent}-${shortId}`,
    `${session.agent}-${session.session_id}`,
    shortId,
    session.session_id,
    session.session_name,
  ];
}

function loadSummaries(summariesDir: string): { byKey: SummaryMap; overallSummary: string } {
  if (!existsSync(summariesDir)) return { byKey: {}, overallSummary: "" };

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
  return { byKey, overallSummary };
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
  return top.repo || session.project || "";
}

function flattenSummaryHumanInputs(
  session: SessionData,
  summary: SessionSummary
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  const title = summary.session_title || session.session_name;
  const agent = session.agent;
  const sessionTime = session.time_range?.display ?? "";
  const modelNames = Object.keys(session.model_usage ?? {});
  const sessionModel = modelNames.length > 0 ? modelNames[0] : "";
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

export function renderDailyApiJson(
  daily: DailyApiJson,
  summariesDir: string
): Record<string, unknown> {
  const { byKey, overallSummary } = loadSummaries(summariesDir);
  const mergedSessions = daily.sessions.map((session) => {
    const summary = pickSessionSummary(session, byKey);
    const models = Object.keys(session.model_usage ?? {});
    const modelEntries = Object.values(session.model_usage ?? {});
    const totalTokens = modelEntries.reduce((sum, entry) => (
      sum +
      (entry.input_tokens ?? 0) +
      (entry.output_tokens ?? 0) +
      (entry.cache_read_input_tokens ?? 0) +
      (entry.cache_creation_input_tokens ?? 0)
    ), 0);
    const sessionCost = modelEntries.reduce((sum, entry) => (
      sum + (typeof entry.cost === "number" ? entry.cost : 0)
    ), 0);
    const notes = modelEntries.map((entry) => String(entry.note ?? ""));
    const tokenSources = modelEntries.map((entry) => String(entry.token_source ?? "")).filter((v) => v.length > 0);
    const costBasis = notes.some((n) => n.includes("dashboard API") || n.includes("nearest-message"))
      ? "api_exact"
      : (notes.some((n) => n.toLowerCase().includes("estimate")) ? "estimate" : "unknown");
    return {
      ...session,
      source: session.agent === "cursor-gui" ? "gui" : "",
      agent_display: session.agent,
      title: summary.session_title ?? session.session_name,
      project: pickProject(session),
      models,
      total_tokens: totalTokens,
      session_cost: Number(sessionCost.toFixed(4)),
      cost_basis: costBasis,
      token_source: tokenSources[0] ?? (notes.find((n) => n.length > 0) ?? ""),
      repos_touched_detail: (session.repos_touched ?? []).map((r) => ({
        repo: r.repo,
        files: r.files,
        added: r.added,
        deleted: r.deleted,
      })),
      files_added: session.files_added ?? 0,
      files_deleted: session.files_deleted ?? 0,
      human_input: summary.human_input ?? {},
      summary: summary.summary ?? "",
    };
  });

  const summaryHumanInputs = mergedSessions.flatMap((session) =>
    flattenSummaryHumanInputs(
      session as SessionData,
      pickSessionSummary(session as SessionData, byKey)
    )
  );
  const combinedHumanInputs = summaryHumanInputs.length > 0
    ? summaryHumanInputs
    : daily.human_inputs.map((h) => ({
      ...h,
      session_time: "",
      session_model: "",
      project: "",
    }));

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
