import { Command } from "commander";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { select } from "@inquirer/prompts";
import { cawplanRequest } from "../lib/http.js";
import { getCache, setCache, buildScopedCacheKey } from "../lib/cache.js";
import { assertInteractiveTerminal, TTY_CANCEL_MESSAGE, ttyKeysHelpTip, withTtyShortcuts } from "../lib/tty-prompt.js";
import {
  buildOutlineWithPreview,
  extractSection,
  extractSectionBody,
  findHeadings,
  flattenOutline,
  parseMarkdownOutline,
  type FlatOutlineNode,
} from "../lib/knowledge/outline.js";
import { getMarkedForTerminal, renderMarkdownPreview } from "../lib/knowledge/terminal-markdown.js";
import { markdownToPlainText } from "../lib/knowledge/plaintext.js";

function collect(value: string, prev: string[]): string[] {
  return prev.concat([value]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface JobStatusData {
  status?: string;
  job_id?: string;
  document_id?: string;
  error_message?: string;
  batch?: string;
}

function extractJobStatusData(result: unknown): JobStatusData | undefined {
  return result && typeof result === "object" && "data" in result
    ? (result as { data?: JobStatusData }).data
    : undefined;
}

/** Polls a create-by-file job until it reaches a terminal status, or the timeout elapses. */
async function pollDocumentAiJob(
  datasetId: string,
  jobId: string,
  pollIntervalMs: number,
  timeoutMs: number,
): Promise<JobStatusData & { job_id: string; timed_out?: boolean }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await cawplanRequest({
      method: "GET",
      path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(datasetId)}/documents/ai-jobs/${encodeURIComponent(jobId)}`,
    });
    const data = extractJobStatusData(result) ?? {};
    if (data.status === "succeeded" || data.status === "failed") {
      return { ...data, job_id: jobId };
    }
    if (Date.now() >= deadline) {
      return { ...data, job_id: jobId, timed_out: true };
    }
    await sleep(pollIntervalMs);
  }
}

/** Fetches a document's content, using the same dataset+document scoped local cache as `documents get`. */
async function fetchDocumentContentResult(datasetId: string, documentId: string, refresh = false): Promise<unknown> {
  const cacheKey = await buildScopedCacheKey(`knowledge:document-content:${datasetId}:${documentId}`, undefined);
  let result = getCache(cacheKey, refresh);
  if (!result) {
    result = await cawplanRequest({
      method: "GET",
      path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/content`,
    });
    setCache(cacheKey, result);
  }
  return result;
}

function extractDocumentContentData(result: unknown): { name?: string; content?: string } | undefined {
  return result && typeof result === "object" && "data" in result
    ? (result as { data?: { content?: string; name?: string } }).data
    : undefined;
}

const EXIT_OUTLINE = Symbol("exit-outline");


const SECTION_PREVIEW_LINES = 6;
const SECTION_PREVIEW_RENDERED_LINES = 12;

/**
 * Displays already-rendered ANSI text in `less`, which owns the screen until the user quits.
 * Printing straight to stdout does not work here: the caller redraws its `select` prompt
 * immediately afterwards, and that repaint — taller than the viewport once choice descriptions are
 * included — scrolls the section away and erases past the top of the screen. `less` reads
 * keystrokes from /dev/tty, so piping the content through its stdin still leaves it interactive.
 */
function showInPager(text: string): Promise<void> {
  return new Promise((resolve) => {
    const pager = spawn("less", ["-R"], { stdio: ["pipe", "inherit", "inherit"] });
    pager.on("error", () => {
      process.stdout.write(`${text}\n`);
      resolve();
    });
    pager.on("close", () => resolve());
    // Quitting less before it has consumed the whole document breaks the pipe.
    pager.stdin.on("error", () => {});
    pager.stdin.end(text);
  });
}

/** Live TTY loop: show the document's heading tree, print the picked section, then show the tree again until the user exits. */
async function runInteractiveOutline(name: string | undefined, content: string): Promise<void> {
  const marked = await getMarkedForTerminal();
  const flat = flattenOutline(parseMarkdownOutline(content));
  if (flat.length === 0) {
    console.log("No markdown headings found in this document; nothing to browse.");
    return;
  }

  const previews = await Promise.all(
    flat.map((node) =>
      renderMarkdownPreview(
        extractSectionBody(content, flat, node),
        SECTION_PREVIEW_LINES,
        SECTION_PREVIEW_RENDERED_LINES,
      ),
    ),
  );

  for (;;) {
    let choice: FlatOutlineNode | typeof EXIT_OUTLINE;
    try {
      choice = await withTtyShortcuts(
        (context) =>
          select<FlatOutlineNode | typeof EXIT_OUTLINE>(
            {
              message: name ? `${name} — select a section` : "Select a section",
              choices: [
                ...flat.map((node, i) => ({
                  name: `${"  ".repeat(node.depth)}${node.title}`,
                  value: node,
                  description: previews[i] || undefined,
                })),
                { name: "Exit", value: EXIT_OUTLINE },
              ],
              pageSize: 20,
              theme: { style: { keysHelpTip: ttyKeysHelpTip } },
            },
            context,
          ),
        { navigationKeys: true },
      );
    } catch (err) {
      if (err instanceof Error && err.message === TTY_CANCEL_MESSAGE) return;
      throw err;
    }

    if (choice === EXIT_OUTLINE) return;
    await showInPager((await marked.parse(extractSection(content, flat, choice))) as string);
  }
}

export function registerKnowledgeCommand(program: Command): void {
  const knowledge = program.command("knowledge").description("Knowledge base operations");

  knowledge
    .command("search")
    .description(
      "Search the knowledge base. Searches all accessible datasets by default; pass one or more --dataset to narrow.",
    )
    .requiredOption("--query <text>", "Search query text")
    .option(
      "--dataset <id>",
      "Dataset id to narrow the search to (see: cawplan knowledge datasets list). Repeat to select multiple.",
      (id: string, prev: string[]) => prev.concat([id]),
      [] as string[],
    )
    .option("--product_id <id>", "Optional product ID to scope the search")
    .option("--limit <n>", "Result limit (default 10)", "10")
    .action(async (opts) => {
      const body: Record<string, unknown> = {
        query: opts.query,
        limit: Number(opts.limit),
      };
      const datasetIds = opts.dataset as string[];
      if (datasetIds.length === 1) body.dataset_id = datasetIds[0];
      else if (datasetIds.length > 1) body.dataset_ids = datasetIds;
      if (opts.product_id) body.product_id = opts.product_id;

      const result = await cawplanRequest({
        method: "POST",
        path: "/api/v1/public/openapi/knowledge/search",
        body,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  const datasets = knowledge.command("datasets").description("Manage knowledge datasets");

  datasets
    .command("list")
    .description("List all knowledge datasets accessible in the current workspace")
    .action(async () => {
      const result = await cawplanRequest({
        method: "GET",
        path: "/api/v1/public/openapi/knowledge/datasets",
      });
      console.log(JSON.stringify(result, null, 2));
    });

  datasets
    .command("create")
    .description("Create a new knowledge dataset")
    .requiredOption("--name <name>", "Dataset name")
    .option("--description <text>", "Optional dataset description")
    .option(
      "--permission <level>",
      "Access permission: only_me | all_team_members | partial_members (default: only_me)",
    )
    .action(async (opts) => {
      const body: Record<string, unknown> = { name: opts.name };
      if (opts.description) body.description = opts.description;
      if (opts.permission) body.permission = opts.permission;

      const result = await cawplanRequest({
        method: "POST",
        path: "/api/v1/public/openapi/knowledge/datasets",
        body,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  const documents = knowledge.command("documents").description("Manage knowledge documents");

  documents
    .command("list")
    .description("List documents in a knowledge dataset")
    .requiredOption("--dataset <id>", "Dataset id (see: cawplan knowledge datasets list)")
    .option("--keyword <text>", "Filter documents by keyword")
    .option("--page <n>", "Page number")
    .option("--limit <n>", "Page size")
    .action(async (opts) => {
      const query: Record<string, string> = {};
      if (opts.keyword) query.keyword = opts.keyword;
      if (opts.page) query.page = String(opts.page);
      if (opts.limit) query.limit = String(opts.limit);

      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(opts.dataset)}/documents`,
        query,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  documents
    .command("get")
    .description("Get the full raw content of a document (read from the original source file, not search-index segments)")
    .requiredOption("--dataset <id>", "Dataset id (see: cawplan knowledge datasets list)")
    .requiredOption("--document <id>", "Document id (see: cawplan knowledge documents list)")
    .option(
      "--output <path>",
      "Also write the full document content to this file",
    )
    .option(
      "--grep <pattern>",
      "Return only lines matching this pattern (case-insensitive substring or regex) with surrounding context, instead of the whole document",
    )
    .option("--context <n>", "Lines of context around each --grep match (like grep -C)", "3")
    .option(
      "--outline",
      "Return the document's markdown heading tree as structured JSON ({level, title, line, preview, " +
        "children}), instead of the content — for building a navigable menu without regex-parsing the raw " +
        "markdown yourself. Each node's `preview` is its own first few non-blank body lines, so one call " +
        "carries enough to preview every heading without a follow-up fetch per heading; use --section " +
        "afterward for a chosen heading's full content. Cannot be combined with --grep, --section, or " +
        "--interactive.",
    )
    .option(
      "--section <heading>",
      "Return the complete, cleanly-bounded content of the heading(s) whose title contains this text " +
        "(case-insensitive substring match) — from the heading's own line up to (not including) the next " +
        "heading at the same or a shallower level, so it never bleeds into a neighboring section like a " +
        "fixed-line-count --grep --context can. Use after --outline once you know which heading you want. " +
        "Cannot be combined with --grep, --outline, or --interactive.",
    )
    .option("--refresh", "Bypass the local content cache and re-fetch from the server")
    .option(
      "-i, --interactive",
      "Browse the document's markdown headings as a live menu in the terminal: pick a section to print it, " +
        "then return to the menu (Esc or 'Exit' to quit). This is the default when run at a real terminal " +
        "with no --grep; the flag is only needed to be explicit. Not for scripted/agent use — those never " +
        "have a real terminal, so they keep getting plain JSON regardless of this flag. Cannot be combined with --grep.",
    )
    .option(
      "--no-interactive",
      "Force plain JSON output even at a real terminal, instead of the interactive browser.",
    )
    .action(async (opts) => {
      const exclusiveFlags = [
        opts.interactive ? "--interactive" : null,
        opts.grep ? "--grep" : null,
        opts.outline ? "--outline" : null,
        opts.section ? "--section" : null,
      ].filter((flag): flag is string => flag !== null);
      if (exclusiveFlags.length > 1) {
        console.error(
          JSON.stringify(
            { code: "ERROR", data: null, msg: `${exclusiveFlags.join(", ")} cannot be combined with each other` },
            null,
            2,
          ),
        );
        process.exitCode = 1;
        return;
      }
      const isRealTerminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
      const interactive =
        opts.interactive !== false &&
        !opts.grep &&
        !opts.outline &&
        !opts.section &&
        (opts.interactive === true || isRealTerminal);
      if (interactive) {
        assertInteractiveTerminal("cawplan knowledge documents get --interactive requires an interactive terminal");
      }

      const result = await fetchDocumentContentResult(opts.dataset, opts.document, Boolean(opts.refresh));
      const data = extractDocumentContentData(result);

      if (data?.content === undefined) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (opts.output) {
        writeFileSync(opts.output, data.content, "utf8");
      }

      if (interactive) {
        await runInteractiveOutline(data.name, data.content);
        return;
      }

      if (opts.outline) {
        console.log(
          JSON.stringify(
            { code: "SUCCESS", data: { name: data.name, outline: buildOutlineWithPreview(data.content) }, msg: "success" },
            null,
            2,
          ),
        );
        return;
      }

      if (opts.section) {
        const content = data.content;
        const flat = flattenOutline(parseMarkdownOutline(content));
        const found = findHeadings(flat, opts.section);
        const matches = found.map((node) => ({
          title: node.title,
          level: node.level,
          line: node.line,
          content: extractSection(content, flat, node),
        }));

        console.log(
          JSON.stringify(
            {
              code: "SUCCESS",
              data: {
                name: data.name,
                query: opts.section,
                match_count: matches.length,
                matches,
                ...(opts.output ? { output_path: opts.output } : {}),
              },
              msg: matches.length ? "success" : "no matching heading",
            },
            null,
            2,
          ),
        );
        return;
      }

      if (opts.grep) {
        let pattern: RegExp;
        try {
          pattern = new RegExp(opts.grep, "i");
        } catch {
          pattern = new RegExp(opts.grep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        }
        const context = Math.max(0, Number(opts.context) || 0);
        const lines = data.content.split("\n");

        const ranges: Array<[number, number]> = [];
        for (let i = 0; i < lines.length; i++) {
          if (!pattern.test(lines[i])) continue;
          const start = Math.max(0, i - context);
          const end = Math.min(lines.length - 1, i + context);
          const last = ranges[ranges.length - 1];
          if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
          else ranges.push([start, end]);
        }

        const matches = ranges.map(([start, end]) => ({
          start_line: start + 1,
          end_line: end + 1,
          text: lines.slice(start, end + 1).join("\n"),
        }));

        console.log(
          JSON.stringify(
            {
              code: "SUCCESS",
              data: {
                name: data.name,
                pattern: opts.grep,
                match_count: matches.length,
                matches,
                ...(opts.output ? { output_path: opts.output } : {}),
              },
              msg: matches.length ? "success" : "no matches",
            },
            null,
            2,
          ),
        );
        return;
      }

      if (opts.output) {
        console.log(
          JSON.stringify(
            { code: "SUCCESS", data: { name: data.name, output_path: opts.output, length: data.content.length }, msg: "success" },
            null,
            2,
          ),
        );
        return;
      }

      console.log(JSON.stringify(result, null, 2));
    });

  documents
    .command("upload")
    .description(
      "Upload one or more documents into a dataset, as files or as plain text. Repeat --file or " +
        "--text-file to batch multiple documents into the same dataset in one call — each file is " +
        "submitted as its own request (the underlying API takes one file/text per call).",
    )
    .requiredOption("--dataset <id>", "Dataset id to upload into (see: cawplan knowledge datasets list)")
    .option(
      "--file <path>",
      "Path to a local file to upload as a document (sent as a real file / multipart, one per request). Repeat for multiple files.",
      collect,
      [] as string[],
    )
    .option(
      "--text-file <path>",
      "Path to a local text file whose content is uploaded as a text document (sent as JSON, one per request). Repeat for multiple.",
      collect,
      [] as string[],
    )
    .option(
      "--no-wait",
      "For --file uploads, submit and return job ids immediately instead of polling for completion (poll separately with: cawplan knowledge documents job-status)",
    )
    .option("--poll-interval <seconds>", "Seconds between job-status polls when waiting on --file uploads", "3")
    .option("--poll-timeout <seconds>", "Give up polling a single file's job after this many seconds", "180")
    .action(async (opts) => {
      const files = opts.file as string[];
      const textFiles = opts.textFile as string[];

      if (files.length === 0 && textFiles.length === 0) {
        console.error(JSON.stringify({ code: "ERROR", data: null, msg: "Provide at least one --file or --text-file" }, null, 2));
        process.exitCode = 1;
        return;
      }
      if (files.length > 0 && textFiles.length > 0) {
        console.error(
          JSON.stringify(
            { code: "ERROR", data: null, msg: "Use --file or --text-file in one call, not both — run the command twice for a mixed batch" },
            null,
            2,
          ),
        );
        process.exitCode = 1;
        return;
      }

      if (files.length > 0) {
        const submissions: Array<Record<string, unknown>> = [];
        for (const filePath of files) {
          const bytes = readFileSync(filePath);
          const formData = new FormData();
          formData.append("file", new Blob([new Uint8Array(bytes)]), basename(filePath));
          // Dify requires indexing_technique on the resulting create-by-text call; it's only
          // inherited from the dataset's own config, which is unset for datasets created without
          // it, so send it explicitly here rather than relying on that inheritance.
          formData.append("data", JSON.stringify({ indexing_technique: "high_quality" }));
          try {
            const result = await cawplanRequest({
              method: "POST",
              path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(opts.dataset)}/documents/create-by-file`,
              formData,
            });
            const data = extractJobStatusData(result);
            submissions.push({ file: filePath, code: (result as { code?: string })?.code, job_id: data?.job_id, status: data?.status });
          } catch (err) {
            submissions.push({ file: filePath, code: "ERROR", msg: err instanceof Error ? err.message : String(err) });
          }
        }

        if (opts.wait === false) {
          console.log(JSON.stringify({ code: "SUCCESS", data: { submissions }, msg: "submitted, not waiting" }, null, 2));
          return;
        }

        const pollIntervalMs = Math.max(1, Number(opts.pollInterval) || 3) * 1000;
        const pollTimeoutMs = Math.max(1, Number(opts.pollTimeout) || 180) * 1000;
        const results = [];
        for (const submission of submissions) {
          const jobId = submission.job_id as string | undefined;
          if (!jobId) {
            results.push(submission);
            continue;
          }
          const finalStatus = await pollDocumentAiJob(opts.dataset, jobId, pollIntervalMs, pollTimeoutMs);
          results.push({ file: submission.file, ...finalStatus });
        }
        console.log(JSON.stringify({ code: "SUCCESS", data: { results }, msg: "success" }, null, 2));
        return;
      }

      const results = [];
      for (const filePath of textFiles) {
        const body = { name: basename(filePath), text: readFileSync(filePath, "utf8") };
        try {
          const result = await cawplanRequest({
            method: "POST",
            path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(opts.dataset)}/documents/create-by-text`,
            body,
          });
          results.push({ file: filePath, ...(result as Record<string, unknown>) });
        } catch (err) {
          results.push({ file: filePath, code: "ERROR", msg: err instanceof Error ? err.message : String(err) });
        }
      }
      console.log(JSON.stringify({ code: "SUCCESS", data: { results }, msg: "success" }, null, 2));
    });

  documents
    .command("job-status")
    .description("Poll the status of an async document upload job submitted by 'documents upload --file' (with --no-wait)")
    .requiredOption("--dataset <id>", "Dataset id the job belongs to")
    .requiredOption("--job <id>", "Job id returned by 'documents upload --file'")
    .action(async (opts) => {
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(opts.dataset)}/documents/ai-jobs/${encodeURIComponent(opts.job)}`,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  interface BrowseDataset {
    id: string;
    name: string;
    document_count?: number;
  }
  interface BrowseDocument {
    id: string;
    name: string;
  }
  const EXIT_BROWSE = Symbol("exit-browse");
  const BACK_TO_DATASETS = Symbol("back-to-datasets");
  const DOCUMENT_PAGE_SIZE = 10;

  knowledge
    .command("browse")
    .description(
      "Interactively browse the knowledge base end to end: pick a dataset, then a document (previewing " +
        "its first lines as you highlight it), then browse that document's heading tree like 'documents " +
        `get --interactive'. Esc goes back one level; Esc at the dataset list exits. Shows the first ${DOCUMENT_PAGE_SIZE} ` +
        "documents per dataset — use 'documents list --dataset <id> --keyword ...' to search a larger set. " +
        "Requires a real interactive terminal.",
    )
    .action(async () => {
      assertInteractiveTerminal("cawplan knowledge browse requires an interactive terminal");

      for (;;) {
        const datasetsResult = await cawplanRequest({
          method: "GET",
          path: "/api/v1/public/openapi/knowledge/datasets",
        });
        const datasets = (datasetsResult as { data?: { datasets?: BrowseDataset[] } })?.data?.datasets ?? [];
        if (datasets.length === 0) {
          console.log("No knowledge datasets accessible.");
          return;
        }

        let dataset: BrowseDataset | typeof EXIT_BROWSE;
        try {
          dataset = await withTtyShortcuts(
            (context) =>
              select<BrowseDataset | typeof EXIT_BROWSE>(
                {
                  message: "Select a dataset",
                  choices: [
                    ...datasets.map((d) => ({ name: `${d.name} (${d.document_count ?? 0} docs)`, value: d })),
                    { name: "Exit", value: EXIT_BROWSE },
                  ],
                  pageSize: 20,
                  theme: { style: { keysHelpTip: ttyKeysHelpTip } },
                },
                context,
              ),
            { navigationKeys: true },
          );
        } catch (err) {
          if (err instanceof Error && err.message === TTY_CANCEL_MESSAGE) return;
          throw err;
        }
        if (dataset === EXIT_BROWSE) return;

        for (;;) {
          const documentsResult = await cawplanRequest({
            method: "GET",
            path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(dataset.id)}/documents`,
            query: { limit: String(DOCUMENT_PAGE_SIZE) },
          });
          const documents = (documentsResult as { data?: { data?: BrowseDocument[] } })?.data?.data ?? [];
          if (documents.length === 0) {
            console.log(`No documents in "${dataset.name}".`);
            break;
          }

          // Previews go through the plain-text renderer, not the ANSI one: this is a `select`
          // choice description, where escape codes are fragile, and plain text still lands
          // headings/tables readably. The ANSI path stays for full section display below.
          const previews = await Promise.all(
            documents.map(async (doc) => {
              try {
                const content = extractDocumentContentData(await fetchDocumentContentResult(dataset.id, doc.id));
                if (!content?.content) return "";
                return markdownToPlainText(content.content, { maxLines: 4, stripCodeBlocks: true, compact: true });
              } catch {
                return "";
              }
            }),
          );

          let document: BrowseDocument | typeof BACK_TO_DATASETS;
          try {
            document = await withTtyShortcuts(
              (context) =>
                select<BrowseDocument | typeof BACK_TO_DATASETS>(
                  {
                    message: `${dataset.name} — select a document`,
                    choices: [
                      ...documents.map((doc, i) => ({
                        name: doc.name,
                        value: doc,
                        description: previews[i] || undefined,
                      })),
                      { name: "Back", value: BACK_TO_DATASETS },
                    ],
                    pageSize: 20,
                    theme: { style: { keysHelpTip: ttyKeysHelpTip } },
                  },
                  context,
                ),
              { navigationKeys: true },
            );
          } catch (err) {
            if (err instanceof Error && err.message === TTY_CANCEL_MESSAGE) break;
            throw err;
          }
          if (document === BACK_TO_DATASETS) break;

          const content = extractDocumentContentData(await fetchDocumentContentResult(dataset.id, document.id));
          if (content?.content !== undefined) {
            await runInteractiveOutline(content.name ?? document.name, content.content);
          } else {
            console.log(`Could not load content for "${document.name}".`);
          }
        }
      }
    });
}
