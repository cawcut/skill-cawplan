import { Command } from "commander";
import { cawplanRequest } from "../lib/http.js";
import { buildQueryFromFlags } from "../lib/cache.js";

export function registerVersionsCommand(program: Command): void {
  const versions = program.command("versions").description("Manage versions");

  versions
    .command("list <product_id>")
    .description("List versions for a product")
    .option("--page_size <n>", "Page size")
    .option("--page_num <n>", "Page number")
    .action(async (productId: string, opts) => {
      const flags: Record<string, string> = {};
      if (opts.page_size) flags.page_size = opts.page_size;
      if (opts.page_num) flags.page_num = opts.page_num;

      const query = buildQueryFromFlags(flags, ["page_size", "page_num"]);
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/versions`,
        query,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  versions
    .command("get <product_id> <version_id>")
    .description("Get version details")
    .action(async (productId: string, versionId: string) => {
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}`,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  versions
    .command("create <product_id>")
    .description("Create a new version")
    .requiredOption("--name <version>", "Version name (e.g. X.Y.Z)")
    .option("--major_id <id>", "Major version unique_id")
    .option("--description <text>", "Description")
    .action(async (productId: string, opts) => {
      const body: Record<string, unknown> = { name: opts.name };
      if (opts.major_id) body.major_id = opts.major_id;
      if (opts.description !== undefined) body.description = opts.description;

      const result = await cawplanRequest({
        method: "POST",
        path: `/api/v1/public/openapi/product/${productId}/versions`,
        body,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  // Releases subcommand lives naturally alongside versions
  const releases = program.command("releases").description("Manage releases");

  releases
    .command("list <product_id> <version_id>")
    .description("List releases for a version")
    .action(async (productId: string, versionId: string) => {
      const result = await cawplanRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/release`,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
