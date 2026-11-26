import { Command } from "commander";
import { cawplanRequest } from "../lib/http.js";
import { stringifyKnowledgeOutput } from "../lib/knowledge/terminal-markdown.js";

// A product's module tree (product_modules) is shared by QA requirements and test suites,
// tickets, QA reports and knowledge documents, so its commands live under `products modules`.

interface ModuleTreeNode {
  id?: string;
  parent_id?: string | null;
  name?: string;
  level?: number;
  children?: ModuleTreeNode[];
}

function moduleTreePath(productId: string): string {
  return `/api/v1/public/openapi/product/${encodeURIComponent(productId)}/module-tree`;
}

function modulePath(productId: string, moduleId: string): string {
  return `${moduleTreePath(productId)}/${encodeURIComponent(moduleId)}`;
}

function flatten(nodes: ModuleTreeNode[] | undefined, out: ModuleTreeNode[]): void {
  for (const node of nodes ?? []) {
    out.push({ id: node.id, parent_id: node.parent_id ?? null, name: node.name, level: node.level });
    flatten(node.children, out);
  }
}

function printInputError(msg: string): void {
  console.error(stringifyKnowledgeOutput({ code: "ERROR", data: null, msg }, null, 2));
  process.exitCode = 1;
}

/** Print a module write result; a business error in an HTTP success response exits non-zero. */
function printWriteResult(result: unknown): void {
  const failed = !result || typeof result !== "object" || (result as { code?: unknown }).code !== "SUCCESS";
  (failed ? console.error : console.log)(stringifyKnowledgeOutput(result, null, 2));
  if (failed) process.exitCode = 1;
}

export async function createProductModule(opts: { product: string; name: string; parent?: string }): Promise<void> {
  const body: Record<string, unknown> = { name: opts.name };
  if (opts.parent) body.parent_id = opts.parent;
  const result = await cawplanRequest({ method: "POST", path: moduleTreePath(opts.product), body });
  printWriteResult(result);
}

export const CREATE_MODULE_DESCRIPTION =
  "Create a module in a product's module tree, optionally under a parent module (at most 5 levels). " +
  "The response's data.id is the new module id.";

export function registerProductModulesCommand(program: Command): void {
  const products = program.commands.find((cmd) => cmd.name() === "products") ?? program.command("products");
  const modules = products
    .command("modules")
    .description(
      "Manage a product's module tree, shared by QA requirements, tickets, QA reports and knowledge documents",
    );

  modules
    .command("list")
    .description("List a product's modules as a flat list of {id, parent_id, name, level}")
    .requiredOption("--product <id>", "Product id (see: cawplan products list)")
    .action(async (opts) => {
      const result = await cawplanRequest({ method: "GET", path: moduleTreePath(opts.product) });
      if ((result as { code?: unknown })?.code !== "SUCCESS") {
        printWriteResult(result);
        return;
      }
      const flat: ModuleTreeNode[] = [];
      flatten((result as { data?: { nodes?: ModuleTreeNode[] } }).data?.nodes, flat);
      console.log(stringifyKnowledgeOutput({ code: "SUCCESS", data: flat, msg: "success" }, null, 2));
    });

  modules
    .command("create")
    .description(CREATE_MODULE_DESCRIPTION)
    .requiredOption("--product <id>", "Product id (see: cawplan products list)")
    .requiredOption("--name <name>", "Module name")
    .option("--parent <id>", "Parent module id (see: cawplan products modules list); omit for a top-level module")
    .action((opts) => createProductModule(opts));

  modules
    .command("update")
    .description(
      "Rename a module, or move it under another parent module (--parent) or to the top level (--root). " +
        "Pass at least one of --name, --parent or --root.",
    )
    .requiredOption("--product <id>", "Product id (see: cawplan products list)")
    .requiredOption("--module <id>", "Module id (see: cawplan products modules list)")
    .option("--name <name>", "New module name")
    .option("--parent <id>", "Move the module under this parent module")
    .option("--root", "Move the module to the top level")
    .action(async (opts) => {
      if (opts.parent && opts.root) {
        return printInputError("Use --parent or --root, not both");
      }
      if (opts.name === undefined && !opts.parent && !opts.root) {
        return printInputError("Provide --name, --parent or --root");
      }
      const body: Record<string, unknown> = {};
      if (opts.name !== undefined) body.name = opts.name;
      if (opts.parent) body.parent_id = opts.parent;
      if (opts.root) body.parent_id = null;
      const result = await cawplanRequest({ method: "PATCH", path: modulePath(opts.product, opts.module), body });
      printWriteResult(result);
    });

  modules
    .command("delete")
    .description(
      "Delete a module. A module that still has sub-modules is refused. Requirements, knowledge documents, " +
        "tickets and QA reports under it are kept but no longer belong to any module.",
    )
    .requiredOption("--product <id>", "Product id (see: cawplan products list)")
    .requiredOption("--module <id>", "Module id (see: cawplan products modules list)")
    .action(async (opts) => {
      const result = await cawplanRequest({ method: "DELETE", path: modulePath(opts.product, opts.module) });
      printWriteResult(result);
    });
}
