import { Command } from "commander";
import { cawplanRequest } from "../lib/http.js";
import { buildQueryFromFlags } from "../lib/cache.js";

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
}
