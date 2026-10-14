/**
 * VS Code (GitHub Copilot agent) session reader.
 *
 * VS Code's agent host runs the Copilot CLI engine, which keeps one directory per session:
 *   ~/.copilot/session-state/<session-id>/
 *     workspace.yaml  — flat "key: value" header: id, cwd, git_root, repository, branch,
 *                       client_name ("vscode-agent-host" when started from VS Code), name,
 *                       created_at, updated_at
 *     events.jsonl    — one event per line: { type, data, id, timestamp, parentId }
 *
 * Events used here:
 *   session.start / session.auto_mode_resolved — model (auto mode records the routed model)
 *   user.message                               — human input (data.content)
 *   assistant.message                          — assistant text (data.content), model, toolRequests
 *   tool.execution_start                       — tool call count
 *
 * Limits: Copilot records no token usage and no structured file edits in these events, so tokens
 * and cost are reported as unknown and file/line counts stay zero. Sessions started from the
 * standalone Copilot CLI (a different client_name) are intentionally not collected here.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { copilotSessionStateDir } from "../paths.js";
import { SessionData, ModelUsageEntry, UsageBucket, RepoTouched, HumanInput } from "../types.js";
import { COST_CURRENCY } from "../pricing.js";
import { classifyHumanInput } from "../aggregators/human-category.js";
import { appendAssistantMessage } from "../aggregators/human-assistant.js";
import { formatLocalTime, getLocalTimezone, isTimestampOnLocalDate, localDateString } from "../date-utils.js";

interface VscodeCollectOptions {
  log?: (message: string) => void;
}

interface WorkspaceMeta {
  id: string;
  cwd: string;
  name: string;
  clientName: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface ParsedEvents {
  userCount: number;
  assistantCount: number;
  toolCallCount: number;
  firstTs: Date | null;
  lastTs: Date | null;
  humanInputs: HumanInput[];
  model: string | null;
}

const VSCODE_CLIENT_PREFIX = "vscode";

function logVscode(opts: VscodeCollectOptions | undefined, message: string): void {
  opts?.log?.(`[vscode] ${message}`);
}

/** workspace.yaml is a flat list of `key: value` lines; no nesting, so no YAML parser needed. */
export function parseWorkspaceYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2]!.trim();
    if (value.length >= 2 && /^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    out[m[1]!] = value;
  }
  return out;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function readWorkspaceMeta(dir: string, id: string): WorkspaceMeta | null {
  const path = join(dir, "workspace.yaml");
  if (!existsSync(path)) return null;
  const fields = parseWorkspaceYaml(readFileSync(path, "utf-8"));
  return {
    id: fields["id"] || id,
    cwd: fields["cwd"] ?? fields["git_root"] ?? "",
    name: fields["name"] ?? "",
    clientName: fields["client_name"] ?? "",
    createdAt: parseDate(fields["created_at"]),
    updatedAt: parseDate(fields["updated_at"]),
  };
}

function isVscodeClient(clientName: string): boolean {
  return clientName.toLowerCase().startsWith(VSCODE_CLIENT_PREFIX);
}

/** A session can only hold activity on `filterDate` if that day falls inside [created, updated]. */
function mayHaveActivityOn(meta: WorkspaceMeta, filterDate: string): boolean {
  if (meta.createdAt && localDateString(meta.createdAt) > filterDate) return false;
  if (meta.updatedAt && localDateString(meta.updatedAt) < filterDate) return false;
  return true;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(record: Record<string, unknown> | undefined, field: string): string {
  const value = record?.[field];
  return typeof value === "string" ? value.trim() : "";
}

export function parseSessionEvents(eventsPath: string, filterDate: string): ParsedEvents {
  const result: ParsedEvents = {
    userCount: 0,
    assistantCount: 0,
    toolCallCount: 0,
    firstTs: null,
    lastTs: null,
    humanInputs: [],
    model: null,
  };
  if (!existsSync(eventsPath)) return result;

  let currentInput: HumanInput | null = null;
  // "auto" is the router, not a model; keep the first concrete model seen.
  let fallbackModel: string | null = null;
  const setModel = (candidate: string, concrete: boolean): void => {
    if (!candidate || candidate === "auto") return;
    if (concrete) result.model ??= candidate;
    else fallbackModel ??= candidate;
  };

  for (const line of readFileSync(eventsPath, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const type = String(event["type"] ?? "");
      const data = asRecord(event["data"]);
      const ts = typeof event["timestamp"] === "string" ? (event["timestamp"] as string) : undefined;

      // Model hints come from session header events, which may predate the target day.
      if (type === "session.start") setModel(stringField(data, "selectedModel"), false);
      if (type === "session.auto_mode_resolved") setModel(stringField(data, "chosenModel"), false);

      if (!ts || !isTimestampOnLocalDate(ts, filterDate)) continue;
      const d = new Date(ts);

      if (type === "user.message" || type === "assistant.message" || type === "tool.execution_start") {
        if (!result.firstTs || d < result.firstTs) result.firstTs = d;
        if (!result.lastTs || d > result.lastTs) result.lastTs = d;
      }

      if (type === "user.message") {
        result.userCount++;
        const text = stringField(data, "content");
        if (text) {
          currentInput = {
            category: classifyHumanInput(text),
            content: text,
            session_agent: "vscode",
            start_time: ts,
            time_precision: "exact",
            files_changed: 0,
            lines_added: 0,
            lines_deleted: 0,
          };
          result.humanInputs.push(currentInput);
        }
      } else if (type === "assistant.message") {
        result.assistantCount++;
        setModel(stringField(data, "model"), true);
        if (currentInput) {
          currentInput.end_time = ts;
          const text = stringField(data, "content");
          if (text) currentInput.assistant_message = appendAssistantMessage(currentInput.assistant_message, text);
        }
      } else if (type === "tool.execution_start") {
        result.toolCallCount++;
      }
    } catch {
      // skip malformed line
    }
  }

  result.model ??= fallbackModel;
  for (const input of result.humanInputs) input.session_model = result.model ?? undefined;
  return result;
}

/**
 * Collect VS Code Copilot agent sessions from ~/.copilot/session-state for a given date.
 */
export function collectVscodeSessions(filterDate: string, opts?: VscodeCollectOptions): SessionData[] {
  const stateDir = copilotSessionStateDir();
  logVscode(opts, `Session state dir: ${stateDir}`);
  if (!existsSync(stateDir)) {
    logVscode(opts, "Copilot session-state dir does not exist; no sessions collected.");
    return [];
  }

  const sessions: SessionData[] = [];
  for (const entry of readdirSync(stateDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = join(stateDir, entry.name);
    try {
      const meta = readWorkspaceMeta(dir, entry.name);
      if (!meta) continue;
      if (!isVscodeClient(meta.clientName)) {
        logVscode(opts, `Skip ${meta.id}: client_name "${meta.clientName}" is not VS Code.`);
        continue;
      }
      if (!mayHaveActivityOn(meta, filterDate)) continue;

      const parsed = parseSessionEvents(join(dir, "events.jsonl"), filterDate);
      if (parsed.userCount === 0 && parsed.assistantCount === 0) {
        logVscode(opts, `Skip ${meta.id}: no activity on ${filterDate}.`);
        continue;
      }

      const model = parsed.model ?? "unknown";
      const modelEntry: ModelUsageEntry = {
        api_calls: parsed.assistantCount,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cost: 0,
        currency: COST_CURRENCY,
        token_source: "unavailable",
        note: "GitHub Copilot does not record token usage locally",
      };
      const usageBreakdown: UsageBucket[] = [{
        ...modelEntry,
        model,
        speed: "standard",
        service_tier: "standard",
        effort: "default",
        agents: ["vscode"],
      }];
      const reposTouched: RepoTouched[] = meta.cwd
        ? [{ repo: meta.cwd, files: 0, added: 0, deleted: 0 }]
        : [];

      let timeDisplay = "unknown";
      let start: string | undefined;
      if (parsed.firstTs && parsed.lastTs) {
        timeDisplay = `${formatLocalTime(parsed.firstTs)} - ${formatLocalTime(parsed.lastTs)}`;
        start = parsed.firstTs.toISOString();
      }

      sessions.push({
        schema: "2.0",
        date: filterDate,
        agent: "vscode",
        session_id: meta.id,
        session_name: meta.name || meta.id.slice(0, 8),
        project: meta.cwd ? meta.cwd.split("/").pop() ?? meta.cwd : meta.id.slice(0, 8),
        cwd: meta.cwd,
        time_range: { display: timeDisplay, timezone: getLocalTimezone(), start },
        model_usage: { [model]: modelEntry },
        usage_breakdown: usageBreakdown,
        cost_basis: "unknown",
        token_source: "unavailable",
        files_changed: 0,
        files_added: 0,
        files_deleted: 0,
        repos_touched: reposTouched,
        message_stats: {
          user: parsed.userCount,
          assistant: parsed.assistantCount,
          tool_calls: parsed.toolCallCount,
        },
        human_inputs: parsed.humanInputs.length > 0 ? parsed.humanInputs : undefined,
      });
      logVscode(opts, `Collected VS Code session ${meta.id}: model=${model}, users=${parsed.userCount}, assistants=${parsed.assistantCount}, tool_calls=${parsed.toolCallCount}.`);
    } catch (e) {
      logVscode(opts, `Skip ${entry.name}: ${(e as Error).message}`);
    }
  }
  return sessions;
}
