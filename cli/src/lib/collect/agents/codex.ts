/**
 * Codex (OpenAI Codex CLI) session reader.
 *
 * Data source: ~/.codex/state_5.sqlite (SQLite)
 *   Table: threads — one row per session with columns:
 *     id, rollout_path, created_at (ISO8601), model, tokens_used (total), title, cwd
 *
 *   Rollout JSONL (optional): per-session event log at rollout_path or
 *     ~/.codex/sessions/<id>/rollout.jsonl — contains user/assistant messages with
 *     timestamps and tool_use blocks; used to derive message counts and time range.
 *
 * What we extract:
 *   - Session list: all threads where created_at matches the target date
 *   - Time range: timestamps from rollout JSONL; falls back to thread.created_at
 *   - Model: thread.model
 *   - Tokens: thread.tokens_used (total only — no input/output split; cost cannot be calculated)
 *   - Message counts / tool calls: parsed from rollout JSONL
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { codexStateDb, codexSessionsDir } from "../paths.js";

const require = createRequire(import.meta.url);
import { SessionData, ModelUsageEntry, UsageBucket, RepoTouched } from "../types.js";
import { getCurrency } from "../pricing.js";

interface CodexThread {
  id: string;
  rollout_path: string | null;
  created_at: string;
  model: string;
  tokens_used: number | null;
  title: string | null;
  cwd: string | null;
}

function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function formatLocalTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Parse Codex rollout JSONL to count messages and find time bounds.
 */
function parseRollout(
  rolloutPath: string | null,
  fallbackSessionsDir: string,
  sessionId: string
): {
  userCount: number;
  assistantCount: number;
  toolCallCount: number;
  firstTs: Date | null;
  lastTs: Date | null;
} {
  const result = { userCount: 0, assistantCount: 0, toolCallCount: 0, firstTs: null as Date | null, lastTs: null as Date | null };

  // Determine path to rollout JSONL
  const paths: string[] = [];
  if (rolloutPath) paths.push(rolloutPath);
  paths.push(join(fallbackSessionsDir, sessionId, "rollout.jsonl"));
  paths.push(join(fallbackSessionsDir, `${sessionId}.jsonl`));

  let content: string | null = null;
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        content = readFileSync(p, "utf-8");
        break;
      } catch {
        // try next
      }
    }
  }

  if (!content) return result;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      const role = event["role"] as string | undefined;
      const ts = event["timestamp"] as string | undefined;

      if (ts) {
        const d = new Date(ts);
        if (!isNaN(d.getTime())) {
          if (!result.firstTs || d < result.firstTs) result.firstTs = d;
          if (!result.lastTs || d > result.lastTs) result.lastTs = d;
        }
      }

      if (role === "user") result.userCount++;
      else if (role === "assistant") {
        result.assistantCount++;
        // Count tool calls in content
        const content = event["content"];
        if (Array.isArray(content)) {
          for (const block of content as unknown[]) {
            const b = block as Record<string, unknown>;
            if (b["type"] === "tool_use") result.toolCallCount++;
          }
        }
      }
    } catch {
      // skip
    }
  }

  return result;
}

/**
 * Collect Codex sessions from ~/.codex/state_5.sqlite for a given date.
 */
export function collectCodexSessions(filterDate: string): SessionData[] {
  const dbPath = codexStateDb();
  if (!existsSync(dbPath)) return [];

  const sessions: SessionData[] = [];
  const sessionsDir = codexSessionsDir();

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });

    try {
      const threads = db
        .prepare(
          "SELECT id, rollout_path, created_at, model, tokens_used, title, cwd FROM threads"
        )
        .all() as CodexThread[];

      for (const thread of threads) {
        // Filter by created_at date (ISO8601 — take first 10 chars)
        const threadDate = (thread.created_at ?? "").slice(0, 10);
        if (threadDate !== filterDate) continue;

        const model = thread.model || "unknown";
        const tokensUsed = thread.tokens_used ?? 0;
        const currency = getCurrency(model);
        const cwd = thread.cwd ?? "";

        // Parse rollout for message counts and timestamps
        const rolloutData = parseRollout(thread.rollout_path, sessionsDir, thread.id);

        // Build model usage — only total tokens available, no input/output split
        const modelEntry: ModelUsageEntry = {
          api_calls: rolloutData.assistantCount || 1,
          input_tokens: 0,
          output_tokens: tokensUsed,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          cost: "unknown",
          currency,
          token_source: "total_only",
          note: "Codex only provides total token count without input/output breakdown",
        };

        const modelUsage: Record<string, ModelUsageEntry> = { [model]: modelEntry };

        const usageBucket: UsageBucket = {
          ...modelEntry,
          model,
          speed: "standard",
          service_tier: "standard",
          effort: "default",
          agents: ["codex"],
        };

        const reposTouched: RepoTouched[] = cwd
          ? [{ repo: cwd, files: 0, added: 0, deleted: 0 }]
          : [];

        // Time range
        let timeDisplay = "unknown";
        let startLocal: string | undefined;

        if (rolloutData.firstTs && rolloutData.lastTs) {
          timeDisplay = `${formatLocalTime(rolloutData.firstTs)} - ${formatLocalTime(rolloutData.lastTs)}`;
          startLocal = rolloutData.firstTs.toISOString();
        } else if (thread.created_at) {
          const created = new Date(thread.created_at);
          if (!isNaN(created.getTime())) {
            timeDisplay = formatLocalTime(created);
            startLocal = created.toISOString();
          }
        }

        const sessionName = thread.title || thread.id.slice(0, 8);

        sessions.push({
          schema: "2.0",
          date: filterDate,
          agent: "codex",
          session_id: thread.id,
          session_name: sessionName,
          project: cwd ? cwd.split("/").pop() ?? cwd : thread.id.slice(0, 8),
          cwd,
          time_range: {
            display: timeDisplay,
            timezone: getLocalTimezone(),
            start_local: startLocal,
          },
          model_usage: modelUsage,
          usage_breakdown: [usageBucket],
          files_changed: 0,
          repos_touched: reposTouched,
          message_stats: {
            user: rolloutData.userCount,
            assistant: rolloutData.assistantCount,
            tool_calls: rolloutData.toolCallCount,
          },
        });
      }
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn(`Warning: codex reader: ${(e as Error).message}`);
  }

  return sessions;
}
