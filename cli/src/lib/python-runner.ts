import { spawn } from "node:child_process";
import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type AiSessionAgent = "claude-code" | "cursor" | "cursor-gui" | "codex";

interface PythonCollectOptions {
  date: string;
  agents?: AiSessionAgent[];
  outputPath: string;
  rootDir?: string;
  keepIntermediates?: boolean;
}

interface PythonDateAgentOptions {
  date: string;
  agents?: AiSessionAgent[];
  rootDir?: string;
}

interface PythonChunkOptions extends PythonDateAgentOptions {
  outputDir?: string;
}

interface PythonRenderOptions {
  date: string;
  outputPath?: string;
  format?: "md" | "json";
  rootDir?: string;
}

function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Works from both src/lib under tsx and dist/lib after build.
  return join(here, "..", "..");
}

function pythonRoot(): string {
  return join(packageRoot(), "python");
}

function normalizeAgents(agents?: AiSessionAgent[]): string[] {
  if (!agents?.length) return [];
  return [...new Set(agents.map((agent) => agent === "cursor-gui" ? "cursor" : agent))];
}

function runPython(args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", args, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        PYTHONPATH: pythonRoot(),
        AI_CODING_REPORTS_ROOT: opts.cwd,
        ...opts.env,
      },
      stdio: "inherit",
    });

    child.on("error", (err) => {
      reject(new Error(`python3 is required to run ai-session commands: ${err.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Python ai-coding-reports exited with code ${code}`));
      }
    });
  });
}

async function assertPythonDependencies(cwd: string): Promise<void> {
  await runPython(
    [
      "-c",
      "import click, jinja2",
    ],
    { cwd }
  ).catch((err) => {
    throw new Error(
      `${(err as Error).message}\nInstall Python dependencies with: python3 -m pip install click jinja2`
    );
  });
}

function addAgentArgs(args: string[], agents?: AiSessionAgent[]): void {
  for (const agent of normalizeAgents(agents)) {
    args.push("--agent", agent);
  }
}

function flattenSummaryHumanInputs(summary: Record<string, unknown>, fileName: string): Array<Record<string, unknown>> {
  const humanInput = summary["human_input"] as Record<string, unknown> | undefined;
  if (!humanInput) return [];

  const sessionTitle = (summary["session_title"] as string | undefined) ?? fileName.replace(/\.json$/, "");
  const sessionAgent = fileName.startsWith("claude-code-")
    ? "claude-code"
    : fileName.startsWith("cursor-")
      ? "cursor"
      : fileName.startsWith("codex-")
        ? "codex"
        : undefined;
  const mappings: Array<[string, string]> = [
    ["decisions", "decision"],
    ["direction", "direction"],
    ["bugs", "correction"],
    ["planning", "planning"],
  ];
  const rows: Array<Record<string, unknown>> = [];

  for (const [sourceKey, category] of mappings) {
    const items = humanInput[sourceKey];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const content = String(item ?? "").trim();
      if (!content) continue;
      rows.push({
        category,
        content,
        session_title: sessionTitle,
        session_agent: sessionAgent || undefined,
      });
    }
  }

  return rows;
}

async function loadSummaryHumanInputs(dayDir: string): Promise<Array<Record<string, unknown>>> {
  const summariesDir = join(dayDir, "summaries");
  let files: string[] = [];
  try {
    files = await readdir(summariesDir);
  } catch {
    return [];
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const file of files.sort()) {
    if (!file.endsWith(".json") || file === "_overall.json") continue;
    try {
      const summary = JSON.parse(await readFile(join(summariesDir, file), "utf-8")) as Record<string, unknown>;
      rows.push(...flattenSummaryHumanInputs(summary, file));
    } catch {
      // Ignore malformed optional summary files; daily.json remains the fallback.
    }
  }
  return rows;
}

async function buildDailyApiPayload(dayDir: string): Promise<Record<string, unknown>> {
  const daily = JSON.parse(await readFile(join(dayDir, "daily.json"), "utf-8")) as Record<string, unknown>;
  const summaryInputs = await loadSummaryHumanInputs(dayDir);
  return {
    schema: daily["schema"] ?? "2.0",
    date: daily["date"],
    author: daily["author"],
    generated_at: new Date().toISOString(),
    include_conversation: false,
    totals: daily["totals"] ?? {},
    usage_breakdown: daily["usage_breakdown"] ?? [],
    model_usage: daily["model_usage"] ?? {},
    sessions: daily["sessions"] ?? [],
    repos: daily["repos"] ?? [],
    human_inputs: summaryInputs.length ? summaryInputs : (daily["human_inputs"] ?? []),
  };
}

export async function collectAiSessionsWithPython(
  opts: PythonCollectOptions
): Promise<Record<string, unknown>> {
  const rootDir = opts.rootDir ?? process.cwd();
  await assertPythonDependencies(rootDir);

  const args = ["-m", "ai_coding_reports", "collect", "--date", opts.date];
  addAgentArgs(args, opts.agents);

  await runPython(args, { cwd: rootDir });

  const dayDir = join(rootDir, "Outputs", "reports", opts.date);
  const apiPath = join(dayDir, "daily.api.json");
  const daily = await buildDailyApiPayload(dayDir);
  await writeFile(apiPath, JSON.stringify(daily, null, 2), "utf-8");

  const outputPath = resolve(rootDir, opts.outputPath);
  if (outputPath !== apiPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(apiPath, outputPath);
  }

  const raw = await readFile(outputPath, "utf-8");
  const result = JSON.parse(raw) as Record<string, unknown>;
  if (!opts.keepIntermediates) {
    await rm(dayDir, { recursive: true, force: true });
  }
  return result;
}

export async function prepareAiSessionChunksWithPython(opts: PythonChunkOptions): Promise<string> {
  const rootDir = opts.rootDir ?? process.cwd();
  await assertPythonDependencies(rootDir);

  const args = ["-m", "ai_coding_reports", "prepare", "chunks", "--date", opts.date];
  addAgentArgs(args, opts.agents);
  await runPython(args, { cwd: rootDir });

  const chunksDir = join(rootDir, "Outputs", "reports", opts.date, "chunks");
  if (opts.outputDir) {
    const outputDir = resolve(rootDir, opts.outputDir);
    await mkdir(outputDir, { recursive: true });
    await cp(chunksDir, outputDir, { recursive: true, force: true });
    return outputDir;
  }

  return chunksDir;
}

export async function renderAiSessionReportWithPython(opts: PythonRenderOptions): Promise<string | undefined> {
  const rootDir = opts.rootDir ?? process.cwd();
  await assertPythonDependencies(rootDir);

  const args = [
    "-m",
    "ai_coding_reports",
    "render",
    "--date",
    opts.date,
    "--format",
    opts.format ?? "md",
  ];

  if (opts.outputPath) {
    const outputPath = resolve(rootDir, opts.outputPath);
    await mkdir(dirname(outputPath), { recursive: true });
    args.push("--output", outputPath);
  }

  await runPython(args, { cwd: rootDir });
  return opts.outputPath ? resolve(rootDir, opts.outputPath) : undefined;
}
