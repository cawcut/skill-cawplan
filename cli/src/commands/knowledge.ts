import { Command } from "commander";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { select } from "@inquirer/prompts";
import { cawplanRequest } from "../lib/http.js";
import { listCawplanProducts } from "../lib/product-catalog.js";
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

async function findExistingDocumentByName(
  datasetId: string,
  name: string,
): Promise<{ id: string; name: string } | undefined> {
  const result = await cawplanRequest({
    method: "GET",
    path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(datasetId)}/documents`,
    query: { keyword: name, limit: "100" },
  });
  const docs = (result as { data?: { data?: Array<{ id: string; name: string }> } })?.data?.data ?? [];
  return docs.find((d) => d.name === name);
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
    .description(
      "List all knowledge datasets accessible in the current workspace. Add --product to narrow to " +
        "one CawPlan product's linked datasets, and --module to further narrow to one " +
        "product_modules tree node (requires --product; see: cawplan knowledge datasets modules " +
        "--product <id>). Use -i/--interactive to pick a product from a menu instead -- and, only " +
        "when that product actually has any modules, a module too (otherwise this just lists every " +
        "dataset under the product, no module prompt shown).",
    )
    .option("--product <id>", "Product id to narrow to (see: cawplan products list)")
    .option("--module <id>", "product_modules tree node id to further narrow to (requires --product)")
    .option(
      "-i, --interactive",
      "Pick a product from a menu (when --product wasn't given), then a module too if that product " +
        "has any (else datasets are listed for the whole product). Requires an interactive terminal.",
    )
    .action(async (opts) => {
      let productId: string | undefined = opts.product;
      let moduleId: string | undefined = opts.module;

      if (opts.interactive) {
        assertInteractiveTerminal("cawplan knowledge datasets list --interactive requires an interactive terminal");
        if (!productId) {
          const picked = await selectProductIdInteractive();
          if (!picked) {
            console.error(JSON.stringify({ code: "CANCELLED", data: null, msg: TTY_CANCEL_MESSAGE }, null, 2));
            process.exitCode = 1;
            return;
          }
          productId = picked;
        }
        if (!moduleId) {
          const modules = await fetchFlatModules(productId);
          if (modules.length > 0) {
            const picked = await selectModuleIdInteractive(productId, { allowNone: "All datasets under this product" }, modules);
            if (picked === undefined) {
              console.error(JSON.stringify({ code: "CANCELLED", data: null, msg: TTY_CANCEL_MESSAGE }, null, 2));
              process.exitCode = 1;
              return;
            }
            if (typeof picked === "string") moduleId = picked;
          }
        }
      }

      const query: Record<string, string> = {};
      if (productId) query.product_id = productId;
      if (moduleId) query.module_id = moduleId;

      const result = await cawplanRequest({
        method: "GET",
        path: "/api/v1/public/openapi/knowledge/datasets",
        query,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  interface ModuleTreeNode {
    id?: string;
    parent_id?: string | null;
    name?: string;
    level?: number;
    children?: ModuleTreeNode[];
  }

  function flattenModuleTree(nodes: ModuleTreeNode[] | undefined, out: ModuleTreeNode[]): void {
    for (const node of nodes ?? []) {
      out.push({ id: node.id, parent_id: node.parent_id ?? null, name: node.name, level: node.level });
      flattenModuleTree(node.children, out);
    }
  }

  async function fetchFlatModules(productId: string): Promise<ModuleTreeNode[]> {
    const result = await cawplanRequest({
      method: "GET",
      path: `/api/v1/public/openapi/product/${encodeURIComponent(productId)}/module-tree`,
    });
    const nodes = (result as { data?: { nodes?: ModuleTreeNode[] } })?.data?.nodes;
    const flat: ModuleTreeNode[] = [];
    flattenModuleTree(nodes, flat);
    return flat;
  }

  const CLEAR_MODULE = Symbol("clear-module");
  const NO_MODULE = Symbol("no-module");
  type ModulePickerChoice = string | typeof CLEAR_MODULE | typeof NO_MODULE;

  // Interactively selects a module id from productId's module tree, indented by tree depth.
  // Returns the picked module id, CLEAR_MODULE / NO_MODULE if those extra choices were offered
  // and picked, or undefined if the list was empty or the user cancelled (Esc).
  async function selectModuleIdInteractive(
    productId: string,
    extraChoices: { allowClear?: string; allowNone?: string } = {},
    prefetchedModules?: ModuleTreeNode[],
  ): Promise<ModulePickerChoice | undefined> {
    const modules = prefetchedModules ?? (await fetchFlatModules(productId));
    if (modules.length === 0) {
      console.error(`No modules found for product ${productId}.`);
      return undefined;
    }
    const choices: Array<{ name: string; value: ModulePickerChoice }> = [];
    if (extraChoices.allowClear) choices.push({ name: extraChoices.allowClear, value: CLEAR_MODULE });
    if (extraChoices.allowNone) choices.push({ name: extraChoices.allowNone, value: NO_MODULE });
    for (const m of modules) {
      if (!m.id) continue;
      const indent = "  ".repeat(Math.max(0, (m.level ?? 1) - 1));
      choices.push({ name: `${indent}${m.name ?? m.id}`, value: m.id });
    }
    try {
      return await withTtyShortcuts(
        (context) =>
          select<ModulePickerChoice>(
            {
              message: `Select a module (product ${productId})`,
              choices,
              pageSize: 20,
              theme: { style: { keysHelpTip: ttyKeysHelpTip } },
            },
            context,
          ),
        { navigationKeys: true },
      );
    } catch (err) {
      if (err instanceof Error && err.message === TTY_CANCEL_MESSAGE) return undefined;
      throw err;
    }
  }

  interface CawplanProduct {
    unique_id?: string;
    name?: string;
  }

  // Interactively selects one product id from the full CawPlan product catalog. Returns
  // undefined if the catalog is empty or the user cancelled (Esc).
  async function selectProductIdInteractive(): Promise<string | undefined> {
    const result = await listCawplanProducts();
    const productList = (result as { data?: CawplanProduct[] })?.data ?? [];
    if (productList.length === 0) {
      console.error("No products found.");
      return undefined;
    }
    const choices = productList
      .filter((p): p is CawplanProduct & { unique_id: string } => Boolean(p.unique_id))
      .map((p) => ({ name: p.name ?? p.unique_id, value: p.unique_id }));
    try {
      return await withTtyShortcuts(
        (context) =>
          select<string>(
            { message: "Select a product", choices, pageSize: 20, theme: { style: { keysHelpTip: ttyKeysHelpTip } } },
            context,
          ),
        { navigationKeys: true },
      );
    } catch (err) {
      if (err instanceof Error && err.message === TTY_CANCEL_MESSAGE) return undefined;
      throw err;
    }
  }

  datasets
    .command("create")
    .description(
      "Create a new knowledge dataset. Pass --product to also bind it to one or more CawPlan " +
        "products (repeat for multiple), scoping it for product-scoped knowledge search. Pass " +
        "--module to also place it under a product_modules tree node for every --product given, " +
        "or -i/--interactive (with exactly one --product) to pick one from a menu instead.",
    )
    .requiredOption("--name <name>", "Dataset name")
    .option("--description <text>", "Optional dataset description")
    .option(
      "--permission <level>",
      "Access permission: only_me | all_team_members | partial_members (default: only_me)",
    )
    .option(
      "--product <id>",
      "Product id to bind the new dataset to (see: cawplan products list). Repeat for multiple.",
      collect,
      [] as string[],
    )
    .option(
      "--module <id>",
      "product_modules node id to place the dataset under, applied to every --product given " +
        "(see: cawplan knowledge datasets modules --product <id>). Requires at least one --product.",
    )
    .option(
      "-i, --interactive",
      "Pick product and/or module from a menu instead of --product/--module: prompts for a " +
        "product first when no --product was given, then for a module (with a \"No module\" " +
        "option) when exactly one product is in play. Requires an interactive terminal.",
    )
    .action(async (opts) => {
      let productIds = opts.product as string[];

      if (opts.interactive && productIds.length === 0) {
        assertInteractiveTerminal("cawplan knowledge datasets create --interactive requires an interactive terminal");
        const pickedProduct = await selectProductIdInteractive();
        if (!pickedProduct) {
          console.error(JSON.stringify({ code: "CANCELLED", data: null, msg: TTY_CANCEL_MESSAGE }, null, 2));
          process.exitCode = 1;
          return;
        }
        productIds = [pickedProduct];
      }

      let moduleId: string | undefined = opts.module;
      if (!moduleId && opts.interactive) {
        assertInteractiveTerminal("cawplan knowledge datasets create --interactive requires an interactive terminal");
        if (productIds.length !== 1) {
          console.error(
            JSON.stringify({ code: "ERROR", data: null, msg: "--interactive module selection requires exactly one product" }, null, 2),
          );
          process.exitCode = 1;
          return;
        }
        const picked = await selectModuleIdInteractive(productIds[0], { allowNone: "No module" });
        if (picked === undefined) {
          console.error(JSON.stringify({ code: "CANCELLED", data: null, msg: TTY_CANCEL_MESSAGE }, null, 2));
          process.exitCode = 1;
          return;
        }
        if (typeof picked === "string") moduleId = picked;
      }

      const body: Record<string, unknown> = { name: opts.name };
      if (opts.description) body.description = opts.description;
      if (opts.permission) body.permission = opts.permission;

      const result = await cawplanRequest({
        method: "POST",
        path: "/api/v1/public/openapi/knowledge/datasets",
        body,
      });

      if (productIds.length === 0) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const datasetId = (result as { data?: { id?: string } })?.data?.id;
      if ((result as { code?: string })?.code !== "SUCCESS" || !datasetId) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const productsResult = await cawplanRequest({
        method: "PUT",
        path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(datasetId)}/products`,
        body: { product_ids: productIds },
      });

      let moduleResults: unknown[] | undefined;
      if (moduleId) {
        moduleResults = [];
        for (const productId of productIds) {
          const moduleResult = await cawplanRequest({
            method: "PUT",
            path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(datasetId)}/products/${encodeURIComponent(productId)}/module`,
            body: { module_id: moduleId },
          });
          moduleResults.push({ product_id: productId, ...(moduleResult as Record<string, unknown>) });
        }
      }

      const merged = {
        ...(result as Record<string, unknown>),
        data: {
          ...(result as { data?: Record<string, unknown> }).data,
          product_ids: (productsResult as { data?: { product_ids?: string[] } })?.data?.product_ids ?? productIds,
          ...(moduleResults ? { modules: moduleResults } : {}),
        },
      };
      console.log(JSON.stringify(merged, null, 2));
    });

  const datasetProducts = datasets.command("products").description("Manage which CawPlan products a dataset is bound to");

  datasetProducts
    .command("get")
    .description("List the CawPlan products a dataset is bound to")
    .requiredOption("--dataset <id>", "Dataset id (see: cawplan knowledge datasets list)")
    .action(async (opts) => {
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(opts.dataset)}/products`,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  datasetProducts
    .command("set")
    .description("Replace the full set of CawPlan products a dataset is bound to (not additive)")
    .requiredOption("--dataset <id>", "Dataset id (see: cawplan knowledge datasets list)")
    .option(
      "--product <id>",
      "Product id to bind the dataset to (see: cawplan products list). Repeat for multiple; omit to unbind all.",
      collect,
      [] as string[],
    )
    .action(async (opts) => {
      const result = await cawplanRequest({
        method: "PUT",
        path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(opts.dataset)}/products`,
        body: { product_ids: opts.product as string[] },
      });
      console.log(JSON.stringify(result, null, 2));
    });

  datasetProducts
    .command("set-module")
    .description(
      "Place a dataset (within one already-bound product) under a product_modules tree node, or " +
        "clear the placement with --clear. Creates the (dataset, product) binding if it doesn't " +
        "already exist. Use -i/--interactive to pick from a menu instead of --module/--clear.",
    )
    .requiredOption("--dataset <id>", "Dataset id (see: cawplan knowledge datasets list)")
    .requiredOption("--product <id>", "Product id to place the dataset under in this product's module tree")
    .option("--module <id>", "product_modules node id to place the dataset under")
    .option("--clear", "Clear the current module placement instead of setting one")
    .option("-i, --interactive", "Pick --module (or clear) from a menu instead. Requires an interactive terminal.")
    .action(async (opts) => {
      if (opts.module && opts.clear) {
        console.error(
          JSON.stringify({ code: "ERROR", data: null, msg: "Use --module or --clear, not both" }, null, 2),
        );
        process.exitCode = 1;
        return;
      }

      let moduleId: string | undefined;
      if (opts.clear) {
        moduleId = "";
      } else if (opts.module) {
        moduleId = opts.module;
      } else if (opts.interactive) {
        assertInteractiveTerminal("cawplan knowledge datasets products set-module --interactive requires an interactive terminal");
        const picked = await selectModuleIdInteractive(opts.product, { allowClear: "Clear current placement" });
        if (picked === undefined) {
          console.error(JSON.stringify({ code: "CANCELLED", data: null, msg: TTY_CANCEL_MESSAGE }, null, 2));
          process.exitCode = 1;
          return;
        }
        moduleId = picked === CLEAR_MODULE ? "" : (picked as string);
      } else {
        console.error(
          JSON.stringify({ code: "ERROR", data: null, msg: "Provide --module <id>, --clear, or -i/--interactive" }, null, 2),
        );
        process.exitCode = 1;
        return;
      }

      const result = await cawplanRequest({
        method: "PUT",
        path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(opts.dataset)}/products/${encodeURIComponent(opts.product)}/module`,
        body: { module_id: moduleId },
      });
      console.log(JSON.stringify(result, null, 2));
    });

  datasets
    .command("modules")
    .description(
      "List a product's module tree (id, parent_id, name only) to find a module id for " +
        "'datasets create --module' / 'datasets products set-module'. Use -i/--interactive to pick " +
        "one from a menu and print just that entry instead of the full list.",
    )
    .requiredOption("--product <id>", "Product id (see: cawplan products list)")
    .option("-i, --interactive", "Pick one module from a menu instead of listing all of them. Requires an interactive terminal.")
    .action(async (opts) => {
      if (opts.interactive) {
        assertInteractiveTerminal("cawplan knowledge datasets modules --interactive requires an interactive terminal");
        const picked = await selectModuleIdInteractive(opts.product);
        if (picked === undefined) {
          console.error(JSON.stringify({ code: "CANCELLED", data: null, msg: TTY_CANCEL_MESSAGE }, null, 2));
          process.exitCode = 1;
          return;
        }
        const modules = await fetchFlatModules(opts.product);
        const chosen = modules.find((m) => m.id === picked);
        console.log(JSON.stringify({ code: "SUCCESS", data: chosen, msg: "success" }, null, 2));
        return;
      }
      const flat = await fetchFlatModules(opts.product);
      console.log(JSON.stringify({ code: "SUCCESS", data: flat, msg: "success" }, null, 2));
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
    .option(
      "--force",
      "Create the document even if the dataset already has one with the same name (default: skip it and " +
        "point at 'documents update' instead of creating a duplicate)",
    )
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
          const name = basename(filePath);
          if (!opts.force) {
            const dup = await findExistingDocumentByName(opts.dataset, name);
            if (dup) {
              submissions.push({
                file: filePath,
                code: "SKIPPED_DUPLICATE",
                document_id: dup.id,
                msg: `A document named "${name}" already exists (id: ${dup.id}); use 'documents update --dataset ${opts.dataset} --document ${dup.id} --file ${filePath}' to replace it, or pass --force to create a duplicate anyway.`,
              });
              continue;
            }
          }
          const bytes = readFileSync(filePath);
          const formData = new FormData();
          formData.append("file", new Blob([new Uint8Array(bytes)]), name);
          // Dify requires indexing_technique on the resulting create-by-text call; it's only
          // inherited from the dataset's own config, which is unset for datasets created without
          // it, so send it explicitly here rather than relying on that inheritance.
          const fileData: Record<string, unknown> = { indexing_technique: "high_quality" };
          formData.append("data", JSON.stringify(fileData));
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
        const name = basename(filePath);
        if (!opts.force) {
          const dup = await findExistingDocumentByName(opts.dataset, name);
          if (dup) {
            results.push({
              file: filePath,
              code: "SKIPPED_DUPLICATE",
              data: null,
              document_id: dup.id,
              msg: `A document named "${name}" already exists (id: ${dup.id}); use 'documents update --dataset ${opts.dataset} --document ${dup.id} --text-file ${filePath}' to replace it, or pass --force to create a duplicate anyway.`,
            });
            continue;
          }
        }
        const body: Record<string, unknown> = { name, text: readFileSync(filePath, "utf8") };
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
    .command("update")
    .description(
      "Update an existing document's content, as a file or as plain text. " +
        "Use this to re-sync a document whose source changed (e.g. edited since the last upload) — " +
        "for a brand-new document use 'documents upload' instead.",
    )
    .requiredOption("--dataset <id>", "Dataset id the document belongs to (see: cawplan knowledge datasets list)")
    .requiredOption("--document <id>", "Document id to update (see: cawplan knowledge documents list)")
    .option("--file <path>", "Path to a local file whose content replaces the document (sent as a real file / multipart)")
    .option("--text-file <path>", "Path to a local text file whose content replaces the document (sent as JSON)")
    .option(
      "--no-wait",
      "For --file updates, submit and return the job id immediately instead of polling for completion (poll separately with: cawplan knowledge documents job-status)",
    )
    .option("--poll-interval <seconds>", "Seconds between job-status polls when waiting on a --file update", "3")
    .option("--poll-timeout <seconds>", "Give up polling after this many seconds", "180")
    .action(async (opts) => {
      const hasFile = Boolean(opts.file);
      const hasTextFile = Boolean(opts.textFile);

      if (!hasFile && !hasTextFile) {
        console.error(
          JSON.stringify({ code: "ERROR", data: null, msg: "Provide --file or --text-file" }, null, 2),
        );
        process.exitCode = 1;
        return;
      }
      if (hasFile && hasTextFile) {
        console.error(
          JSON.stringify({ code: "ERROR", data: null, msg: "Use --file or --text-file in one call, not both" }, null, 2),
        );
        process.exitCode = 1;
        return;
      }

      if (hasFile) {
        const bytes = readFileSync(opts.file);
        const formData = new FormData();
        formData.append("file", new Blob([new Uint8Array(bytes)]), basename(opts.file));
        const fileData: Record<string, unknown> = {};
        formData.append("data", JSON.stringify(fileData));

        let result: unknown;
        try {
          result = await cawplanRequest({
            method: "POST",
            path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(opts.dataset)}/documents/${encodeURIComponent(opts.document)}/update-by-file`,
            formData,
          });
        } catch (err) {
          console.error(
            JSON.stringify({ code: "ERROR", data: null, msg: err instanceof Error ? err.message : String(err) }, null, 2),
          );
          process.exitCode = 1;
          return;
        }
        const data = extractJobStatusData(result);

        if (opts.wait === false || !data?.job_id) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const pollIntervalMs = Math.max(1, Number(opts.pollInterval) || 3) * 1000;
        const pollTimeoutMs = Math.max(1, Number(opts.pollTimeout) || 180) * 1000;
        const finalStatus = await pollDocumentAiJob(opts.dataset, data.job_id, pollIntervalMs, pollTimeoutMs);
        console.log(JSON.stringify({ code: "SUCCESS", data: finalStatus, msg: "success" }, null, 2));
        return;
      }

      const body: Record<string, unknown> = {};
      if (hasTextFile) {
        body.name = basename(opts.textFile);
        body.text = readFileSync(opts.textFile, "utf8");
      }

      const result = await cawplanRequest({
        method: "POST",
        path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(opts.dataset)}/documents/${encodeURIComponent(opts.document)}/update-by-text`,
        body,
      });
      console.log(JSON.stringify(result, null, 2));
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
  const NEXT_PAGE = Symbol("next-page");
  const PREV_PAGE = Symbol("prev-page");
  const DOCUMENT_PAGE_SIZE = 20;

  knowledge
    .command("browse")
    .description(
      "Interactively browse the knowledge base end to end: pick a dataset, then a document (previewing " +
        "its first lines as you highlight it, paging through " +
        `${DOCUMENT_PAGE_SIZE} at a time when a dataset has more), then browse that document's heading tree ` +
        "like 'documents get --interactive'. Esc goes back one level; Esc at the dataset list exits. Use " +
        "'documents list --dataset <id> --keyword ...' to search instead of paging through a large dataset. " +
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

        let page = 1;
        for (;;) {
          const documentsResult = await cawplanRequest({
            method: "GET",
            path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(dataset.id)}/documents`,
            query: { limit: String(DOCUMENT_PAGE_SIZE), page: String(page) },
          });
          const documents = (documentsResult as { data?: { data?: BrowseDocument[] } })?.data?.data ?? [];
          if (documents.length === 0) {
            if (page > 1) {
              console.log("No more documents.");
              page -= 1;
              continue;
            }
            console.log(`No documents in "${dataset.name}".`);
            break;
          }
          const totalPages =
            typeof dataset.document_count === "number" && dataset.document_count > 0
              ? Math.max(1, Math.ceil(dataset.document_count / DOCUMENT_PAGE_SIZE))
              : page + (documents.length === DOCUMENT_PAGE_SIZE ? 1 : 0);

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

          type DocumentChoice = BrowseDocument | typeof BACK_TO_DATASETS | typeof NEXT_PAGE | typeof PREV_PAGE;
          const documentChoices: Array<{ name: string; value: DocumentChoice; description?: string }> = [
            ...documents.map((doc, i) => ({
              name: doc.name,
              value: doc as DocumentChoice,
              description: previews[i] || undefined,
            })),
          ];
          if (page > 1) documentChoices.push({ name: "◀ Previous page", value: PREV_PAGE });
          if (documents.length === DOCUMENT_PAGE_SIZE && page < totalPages) {
            documentChoices.push({ name: "Next page ▶", value: NEXT_PAGE });
          }
          documentChoices.push({ name: "Back", value: BACK_TO_DATASETS });

          let document: DocumentChoice;
          try {
            document = await withTtyShortcuts(
              (context) =>
                select<DocumentChoice>(
                  {
                    message:
                      totalPages > 1
                        ? `${dataset.name} — select a document (page ${page}/${totalPages})`
                        : `${dataset.name} — select a document`,
                    choices: documentChoices,
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
          if (document === NEXT_PAGE) {
            page += 1;
            continue;
          }
          if (document === PREV_PAGE) {
            page -= 1;
            continue;
          }

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
