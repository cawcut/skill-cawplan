import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { cawplanRequest, apiErrorDetails } from "../lib/http.js";
import { buildQueryFromFlags } from "../lib/cache.js";

function printCliError(err: unknown): void {
  console.error(`Error: ${(err as Error).message}`);
  const details = apiErrorDetails(err);
  if (details) console.error(`Details: ${details}`);
}

type RequestFn = typeof cawplanRequest;

export interface QAReportsCommandDeps {
  request?: RequestFn;
}

function portalVersionQaReportPath(
  productId: string,
  versionId: string,
  qaReportId?: string,
): string {
  const base = `/api/v1/product/${productId}/versions/${versionId}/qa_report`;
  return qaReportId ? `${base}/${qaReportId}` : base;
}

export async function readQAReportBody(
  bodyFile: string | undefined,
  inlineBody: string | undefined,
): Promise<unknown> {
  if (bodyFile && inlineBody) {
    throw new Error("pass either --body-file or --body, not both");
  }
  const raw = bodyFile ? await readFile(bodyFile, "utf8") : inlineBody;
  if (!raw) {
    throw new Error("--body-file or --body is required");
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`body is not valid JSON — ${(err as Error).message}`);
  }
}

export async function runQAReportsCreate(
  productId: string,
  versionId: string,
  body: unknown,
  deps?: QAReportsCommandDeps,
): Promise<unknown> {
  const request = deps?.request ?? cawplanRequest;
  return request({
    method: "POST",
    path: portalVersionQaReportPath(productId, versionId),
    body,
  });
}

export async function runQAReportsUpdate(
  productId: string,
  versionId: string,
  qaReportId: string,
  body: unknown,
  deps?: QAReportsCommandDeps,
): Promise<unknown> {
  const request = deps?.request ?? cawplanRequest;
  return request({
    method: "PUT",
    path: portalVersionQaReportPath(productId, versionId, qaReportId),
    body,
  });
}

export function registerQAReportsCommand(program: Command): void {
  const qa = program.command("qa-reports").description("QA reports");

  qa
    .command("list <product_id>")
    .description("List QA reports for a product, grouped by version")
    .option("--type <type>", "Report type: sqa|aqa|stress|performance|smoke")
    .option("--result <r>", "Result: pass|pass_with_issues|failed")
    .option("--status <s>", "Status filter")
    .option("--page_size <n>", "Page size (max 100)")
    .option("--page_num <n>", "Page number")
    .action(async (productId: string, opts) => {
      const flags: Record<string, string> = {};
      if (opts.type) flags.type = opts.type;
      if (opts.result) flags.result = opts.result;
      if (opts.status) flags.status = opts.status;
      if (opts.page_size) flags.page_size = opts.page_size;
      if (opts.page_num) flags.page_num = opts.page_num;

      const query = buildQueryFromFlags(flags, ["type", "result", "status", "page_size", "page_num"]);
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/qa_report`,
        query,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  qa
    .command("list-version <product_id> <version_id>")
    .description("List QA reports for a specific version")
    .option("--type <type>", "Report type: sqa|aqa|stress|performance|smoke")
    .option("--result <r>", "Result: pass|pass_with_issues|failed")
    .option("--status <s>", "Status filter")
    .option("--page_size <n>", "Page size (max 100)")
    .option("--page_num <n>", "Page number")
    .action(async (productId: string, versionId: string, opts) => {
      const flags: Record<string, string> = {};
      if (opts.type) flags.type = opts.type;
      if (opts.result) flags.result = opts.result;
      if (opts.status) flags.status = opts.status;
      if (opts.page_size) flags.page_size = opts.page_size;
      if (opts.page_num) flags.page_num = opts.page_num;

      const query = buildQueryFromFlags(flags, ["type", "result", "status", "page_size", "page_num"]);
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/qa_report`,
        query,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  qa
    .command("get <product_id> <version_id> <qa_report_id>")
    .description("Get a specific QA report by ID")
    .action(async (productId: string, versionId: string, qaReportId: string) => {
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/qa_report/${qaReportId}`,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  qa
    .command("create <product_id> <version_id>")
    .description("Create a QA report for a version (Portal API)")
    .option("--body-file <path>", "JSON request body file")
    .option("--body <json>", "JSON request body string")
    .action(async (productId: string, versionId: string, opts) => {
      try {
        const body = await readQAReportBody(opts.bodyFile, opts.body);
        const result = await runQAReportsCreate(productId, versionId, body);
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        printCliError(err);
        process.exit(1);
      }
    });

  qa
    .command("update <product_id> <version_id> <qa_report_id>")
    .description("Update a QA report (Portal API)")
    .option("--body-file <path>", "JSON request body file")
    .option("--body <json>", "JSON request body string")
    .action(async (productId: string, versionId: string, qaReportId: string, opts) => {
      try {
        const body = await readQAReportBody(opts.bodyFile, opts.body);
        const result = await runQAReportsUpdate(productId, versionId, qaReportId, body);
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        printCliError(err);
        process.exit(1);
      }
    });
}
