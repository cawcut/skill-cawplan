import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Command } from "commander";
import { registerProductsCommand } from "../src/commands/products.js";
import { registerKnowledgeCommand } from "../src/commands/knowledge.js";
import { registerProductModulesCommand } from "../src/commands/product-modules.js";
import * as http from "../src/lib/http.js";

const PRODUCT = "prod-1";
const MODULE = "mod-1";
const TREE = `/api/v1/public/openapi/product/${PRODUCT}/module-tree`;

async function run(args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerProductsCommand(program);
  registerProductModulesCommand(program);
  registerKnowledgeCommand(program);
  await program.parseAsync(["node", "cawplan", ...args], { from: "node" });
}

describe("products modules", () => {
  let request: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    request = vi.spyOn(http, "cawplanRequest");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  test("list flattens the module tree", async () => {
    request.mockResolvedValue({
      code: "SUCCESS",
      data: { nodes: [{ id: "a", name: "A", level: 1, children: [{ id: "b", parent_id: "a", name: "B", level: 2 }] }] },
    });

    await run(["products", "modules", "list", "--product", PRODUCT]);

    expect(request).toHaveBeenCalledWith({ method: "GET", path: TREE });
    expect(JSON.parse(logSpy.mock.calls[0][0] as string).data).toEqual([
      { id: "a", parent_id: null, name: "A", level: 1 },
      { id: "b", parent_id: "a", name: "B", level: 2 },
    ]);
  });

  test.each([
    [["products", "modules", "create", "--product", PRODUCT, "--name", "API", "--parent", MODULE]],
    [["knowledge", "modules", "create", "--product", PRODUCT, "--name", "API", "--parent", MODULE]],
  ])("%j creates the module", async (args) => {
    request.mockResolvedValue({ code: "SUCCESS", data: { id: "mod-2" } });

    await run(args);

    expect(request).toHaveBeenCalledWith({ method: "POST", path: TREE, body: { name: "API", parent_id: MODULE } });
    expect(process.exitCode).toBeUndefined();
  });

  test.each([
    [["--name", "Renamed"], { name: "Renamed" }],
    [["--parent", "mod-2"], { parent_id: "mod-2" }],
    [["--name", "Top", "--root"], { name: "Top", parent_id: null }],
  ])("update %j PATCHes the module", async (flags, body) => {
    request.mockResolvedValue({ code: "SUCCESS", data: { id: MODULE } });

    await run(["products", "modules", "update", "--product", PRODUCT, "--module", MODULE, ...flags]);

    expect(request).toHaveBeenCalledWith({ method: "PATCH", path: `${TREE}/${MODULE}`, body });
    expect(process.exitCode).toBeUndefined();
  });

  test.each([[[]], [["--parent", "mod-2", "--root"]]])("update %j never submits a write", async (flags) => {
    await run(["products", "modules", "update", "--product", PRODUCT, "--module", MODULE, ...flags]);

    expect(request).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(errorSpy.mock.calls[0][0] as string).code).toBe("ERROR");
  });

  test("delete DELETEs the module", async () => {
    request.mockResolvedValue({ code: "SUCCESS", msg: "success" });

    await run(["products", "modules", "delete", "--product", PRODUCT, "--module", MODULE]);

    expect(request).toHaveBeenCalledWith({ method: "DELETE", path: `${TREE}/${MODULE}` });
    expect(process.exitCode).toBeUndefined();
  });

  test("a refused delete is reported on stderr and exits non-zero", async () => {
    request.mockResolvedValue({ code: "FAILURE_INVALID_INPUT", msg: "module tree node has children" });

    await run(["products", "modules", "delete", "--product", PRODUCT, "--module", MODULE]);

    expect(process.exitCode).toBe(1);
    expect(logSpy).not.toHaveBeenCalled();
    expect(JSON.parse(errorSpy.mock.calls[0][0] as string).msg).toBe("module tree node has children");
  });

  test("knowledge modules no longer has update or delete", async () => {
    await expect(run(["knowledge", "modules", "delete", "--product", PRODUCT, "--module", MODULE])).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
