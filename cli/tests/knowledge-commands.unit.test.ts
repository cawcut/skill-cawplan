import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Command } from "commander";
import { registerKnowledgeCommand } from "../src/commands/knowledge.js";
import * as http from "../src/lib/http.js";

const DATASET = "ds-1";
const DOCUMENT = "doc-1";
const MODULE = "mod-1";
const PRODUCT = "prod-1";

async function run(args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerKnowledgeCommand(program);
  await program.parseAsync(["node", "cawplan", "knowledge", ...args], { from: "node" });
}

describe("knowledge commands (document modules)", () => {
  let tmpDir: string;
  let request: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "knowledge-cmd-test-"));
    request = vi.spyOn(http, "cawplanRequest");
    vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  test("datasets list prints C1-safe JSON without changing returned data", async () => {
    const payload = {code: "SUCCESS", data: [{id: DATASET, name: "name\u009b2J", note: "\u009d52;c;canary\u009c"}]};
    request.mockResolvedValue(payload);
    await run(["datasets", "list"]);
    const output = vi.mocked(console.log).mock.calls.at(-1)![0] as string;
    expect(JSON.parse(output)).toEqual(payload);
    expect(output).not.toContain("\u009b");
    expect(output).not.toContain("\u009d");
  });

  test("datasets create --owner-product sends product_id and does not link when no --product", async () => {
    request.mockResolvedValue({ code: "SUCCESS", msg: "success", data: { id: DATASET } });

    await run(["datasets", "create", "--name", "Docs", "--owner-product", PRODUCT]);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/public/openapi/knowledge/datasets",
      body: { name: "Docs", product_id: PRODUCT },
    });
  });

  test("datasets create --owner-product + --product owns and links, with no module call", async () => {
    request
      .mockResolvedValueOnce({ code: "SUCCESS", msg: "success", data: { id: DATASET } })
      .mockResolvedValueOnce({ code: "SUCCESS", msg: "success", data: { product_ids: [PRODUCT] } });

    await run(["datasets", "create", "--name", "Docs", "--owner-product", PRODUCT, "--product", PRODUCT]);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, {
      method: "POST",
      path: "/api/v1/public/openapi/knowledge/datasets",
      body: { name: "Docs", product_id: PRODUCT },
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      method: "PUT",
      path: `/api/v1/public/openapi/knowledge/datasets/${DATASET}/products`,
      body: { product_ids: [PRODUCT] },
    });
  });

  test("datasets create no longer accepts --module", async () => {
    await expect(run(["datasets", "create", "--name", "Docs", "--module", MODULE])).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  test("datasets products set-module is removed", async () => {
    await expect(
      run(["datasets", "products", "set-module", "--dataset", DATASET, "--product", PRODUCT, "--module", MODULE]),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  test("documents upload --text-file --module sets module_id in the JSON body", async () => {
    const textPath = join(tmpDir, "notes.md");
    writeFileSync(textPath, "# hello", "utf8");
    request.mockResolvedValue({ code: "SUCCESS", msg: "success", data: { document: { id: DOCUMENT } } });

    await run(["documents", "upload", "--dataset", DATASET, "--text-file", textPath, "--module", MODULE, "--force"]);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: `/api/v1/public/openapi/knowledge/datasets/${DATASET}/documents/create-by-text`,
      body: { name: "notes.md", text: "# hello", module_id: MODULE },
    });
  });

  test("documents update --text-file sends text only, never name", async () => {
    const textPath = join(tmpDir, "new.md");
    writeFileSync(textPath, "# updated\n", "utf8");
    request.mockResolvedValue({ code: "SUCCESS", msg: "success", data: {} });

    await run(["documents", "update", "--dataset", DATASET, "--document", DOCUMENT, "--text-file", textPath]);

    expect(request).toHaveBeenCalledTimes(1);
    const call = request.mock.calls[0][0] as { method: string; path: string; body: Record<string, unknown> };
    expect(call.method).toBe("POST");
    expect(call.path).toBe(`/api/v1/public/openapi/knowledge/datasets/${DATASET}/documents/${DOCUMENT}/update-by-text`);
    expect(call.body).toEqual({ text: "# updated\n" });
    expect(call.body).not.toHaveProperty("name");
  });

  test("documents upload --file --module appends a module_id form field", async () => {
    const filePath = join(tmpDir, "spec.md");
    writeFileSync(filePath, "# spec", "utf8");
    request.mockResolvedValue({ code: "SUCCESS", msg: "success", data: { job_id: "job-1", status: "pending" } });

    await run(["documents", "upload", "--dataset", DATASET, "--file", filePath, "--module", MODULE, "--force", "--no-wait"]);

    expect(request).toHaveBeenCalledTimes(1);
    const call = request.mock.calls[0][0] as { path: string; formData: FormData };
    expect(call.path).toBe(`/api/v1/public/openapi/knowledge/datasets/${DATASET}/documents/create-by-file`);
    expect(call.formData.get("module_id")).toBe(MODULE);
    expect(JSON.parse(call.formData.get("data") as string)).toEqual({ indexing_technique: "high_quality" });
  });

  test("documents upload without --module sends no module_id", async () => {
    const textPath = join(tmpDir, "notes.md");
    writeFileSync(textPath, "# hello", "utf8");
    request.mockResolvedValue({ code: "SUCCESS", msg: "success", data: {} });

    await run(["documents", "upload", "--dataset", DATASET, "--text-file", textPath, "--force"]);

    const call = request.mock.calls[0][0] as { body: Record<string, unknown> };
    expect(call.body).not.toHaveProperty("module_id");
  });

  test("documents set-module --module PUTs the module id", async () => {
    request.mockResolvedValue({ code: "SUCCESS", msg: "success", data: null });

    await run(["documents", "set-module", "--dataset", DATASET, "--document", DOCUMENT, "--module", MODULE]);

    expect(request).toHaveBeenCalledWith({
      method: "PUT",
      path: `/api/v1/public/openapi/knowledge/datasets/${DATASET}/documents/${DOCUMENT}/module`,
      body: { module_id: MODULE },
    });
  });

  test("documents set-module --clear PUTs an empty module id", async () => {
    request.mockResolvedValue({ code: "SUCCESS", msg: "success", data: null });

    await run(["documents", "set-module", "--dataset", DATASET, "--document", DOCUMENT, "--clear"]);

    expect(request).toHaveBeenCalledWith({
      method: "PUT",
      path: `/api/v1/public/openapi/knowledge/datasets/${DATASET}/documents/${DOCUMENT}/module`,
      body: { module_id: "" },
    });
  });

  test("documents set-module rejects both --module and --clear", async () => {
    await run(["documents", "set-module", "--dataset", DATASET, "--document", DOCUMENT, "--module", MODULE, "--clear"]);

    expect(request).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(errorSpy.mock.calls[0][0] as string)).toEqual({
      code: "ERROR",
      data: null,
      msg: "Use --module or --clear, not both",
    });
  });

  test("documents set-module rejects neither --module nor --clear", async () => {
    await run(["documents", "set-module", "--dataset", DATASET, "--document", DOCUMENT]);

    expect(request).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(errorSpy.mock.calls[0][0] as string).code).toBe("ERROR");
  });

  test("modules create POSTs the module name to the product's module tree", async () => {
    request.mockResolvedValue({ code: "SUCCESS", msg: "success", data: { id: MODULE } });

    await run(["modules", "create", "--product", PRODUCT, "--name", "Specs"]);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: `/api/v1/public/openapi/product/${PRODUCT}/module-tree`,
      body: { name: "Specs" },
    });
  });

  test("modules create --parent sends parent_id", async () => {
    request.mockResolvedValue({ code: "SUCCESS", msg: "success", data: { id: "mod-2" } });

    await run(["modules", "create", "--product", PRODUCT, "--name", "API", "--parent", MODULE]);

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: `/api/v1/public/openapi/product/${PRODUCT}/module-tree`,
      body: { name: "API", parent_id: MODULE },
    });
  });

  test("modules create requires --name", async () => {
    await expect(run(["modules", "create", "--product", PRODUCT])).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  test("modules list reads the product's module tree", async () => {
    request.mockResolvedValue({ code: "SUCCESS", msg: "success", data: { nodes: [{ id: MODULE, name: "Specs" }] } });

    await run(["modules", "list", "--product", PRODUCT]);

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: `/api/v1/public/openapi/product/${PRODUCT}/module-tree` }),
    );
  });
});
