import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Command } from "commander";
import { registerTicketsCommand } from "../src/commands/tickets.js";
import * as http from "../src/lib/http.js";
import { resolveModuleId } from "../src/lib/resolve.js";

const PRODUCT = "01983225-e595-71c6-9c88-4235d35fc743";
const VERSION = "01a1af89-3b0e-792b-9218-e82eadaa9a8e";
const TICKET = "01a1c357-062e-7e10-8086-861afad6bc83";
const MODULE_CHART = "01a1b000-0000-7000-8000-000000000001";
const MODULE_SKILL = "01a13ef6-3292-71cb-b2ac-8b5c60ed2369";
const MODULE_SETTINGS_TEAM = "01a18642-fd01-77bf-b232-43009bf76432";
const MODULE_PLAN_TEAM = "01a18642-fd01-77bf-b232-43009bf76433";

const TREE = {
  code: "SUCCESS",
  data: {
    product_id: PRODUCT,
    nodes: [
      {
        id: "01a1b000-0000-7000-8000-0000000000aa",
        name: "Key Metrics",
        children: [{ id: MODULE_CHART, name: "Key Metric Chart", children: [] }],
      },
      { id: MODULE_SKILL, name: "Skill" },
      {
        id: "01a18642-8601-71c3-a96a-7542f130da70",
        name: "Settings",
        children: [{ id: MODULE_SETTINGS_TEAM, name: "Team" }],
      },
      {
        id: "01a0f1e4-1e17-78d6-90fc-920fb1cb634a",
        name: "Plan & Billing",
        children: [{ id: MODULE_PLAN_TEAM, name: "Team" }],
      },
    ],
  },
};

function mockTree() {
  return vi.spyOn(http, "cawplanRequest").mockImplementation(async (req) => {
    if (req.path.endsWith("/module-tree")) return TREE;
    return { code: "SUCCESS", data: { unique_id: TICKET } };
  });
}

describe("resolveModuleId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("passes a module id through without fetching the tree", async () => {
    const request = vi.spyOn(http, "cawplanRequest");
    await expect(resolveModuleId(PRODUCT, MODULE_SKILL)).resolves.toBe(MODULE_SKILL);
    expect(request).not.toHaveBeenCalled();
  });

  test("resolves a nested module by name, ignoring case and surrounding spaces", async () => {
    const request = mockTree();
    await expect(resolveModuleId(PRODUCT, "  key metric chart ")).resolves.toBe(MODULE_CHART);
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: `/api/v1/public/openapi/product/${PRODUCT}/module-tree`,
    });
  });

  test("resolves a module by full path", async () => {
    mockTree();
    await expect(resolveModuleId(PRODUCT, "Key Metrics / Key Metric Chart")).resolves.toBe(MODULE_CHART);
    await expect(resolveModuleId(PRODUCT, "settings/team")).resolves.toBe(MODULE_SETTINGS_TEAM);
  });

  test("rejects an ambiguous name and lists the full paths", async () => {
    mockTree();
    const err = await resolveModuleId(PRODUCT, "Team").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("Multiple modules match");
    expect((err as Error).message).toContain(`"Settings / Team" (${MODULE_SETTINGS_TEAM})`);
    expect((err as Error).message).toContain(`"Plan & Billing / Team" (${MODULE_PLAN_TEAM})`);
  });

  test("rejects an unknown module and suggests similar paths", async () => {
    mockTree();
    await expect(resolveModuleId(PRODUCT, "Metric")).rejects.toThrow(/Similar: "Key Metrics", "Key Metrics \/ Key Metric Chart"/);
    await expect(resolveModuleId(PRODUCT, "Nope")).rejects.toThrow(/Available top-level modules: "Key Metrics", "Skill"/);
  });

  test("rejects a product without modules", async () => {
    vi.spyOn(http, "cawplanRequest").mockResolvedValue({ code: "SUCCESS", data: { nodes: [] } });
    await expect(resolveModuleId(PRODUCT, "Skill")).rejects.toThrow(/has no modules/);
  });
});

async function run(args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerTicketsCommand(program);
  await program.parseAsync(["node", "cawplan", "tickets", ...args], { from: "node" });
}

describe("tickets --module", () => {
  let request: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    request = mockTree();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("create-version sends the resolved module_id", async () => {
    await run(["create-version", PRODUCT, VERSION, "--description", "[Key Metrics] t", "--module", "Key Metric Chart"]);

    const create = request.mock.calls.find(([req]) => req.path.endsWith(`/versions/${VERSION}/tickets`));
    expect(create?.[0].body).toMatchObject({ description: "[Key Metrics] t", module_id: MODULE_CHART });
  });

  test("create-backlog sends the resolved module_id", async () => {
    await run(["create-backlog", PRODUCT, "--description", "t", "--module", "Skill"]);

    const create = request.mock.calls.find(([req]) => req.method === "POST");
    expect(create?.[0].path).toBe(`/api/v1/public/openapi/product/${PRODUCT}/tickets`);
    expect(create?.[0].body).toMatchObject({ module_id: MODULE_SKILL });
  });

  test("update sends the resolved module_id", async () => {
    await run(["update", PRODUCT, VERSION, TICKET, "--module", "Key Metrics / Key Metric Chart"]);

    const put = request.mock.calls.find(([req]) => req.method === "PUT");
    expect(put?.[0].path).toBe(`/api/v1/public/openapi/product/${PRODUCT}/versions/${VERSION}/tickets/${TICKET}`);
    expect(put?.[0].body).toEqual({ module_id: MODULE_CHART });
  });

  test("omits module_id when --module is not given", async () => {
    await run(["create-version", PRODUCT, VERSION, "--description", "t"]);

    const create = request.mock.calls.find(([req]) => req.method === "POST");
    expect(create?.[0].body).not.toHaveProperty("module_id");
    expect(request.mock.calls.some(([req]) => req.path.endsWith("/module-tree"))).toBe(false);
  });

  test("does not create the ticket when the module cannot be resolved", async () => {
    await expect(
      run(["create-version", PRODUCT, VERSION, "--description", "t", "--module", "Nope"]),
    ).rejects.toThrow(/No module found/);
    expect(request.mock.calls.some(([req]) => req.method === "POST")).toBe(false);
  });
});
