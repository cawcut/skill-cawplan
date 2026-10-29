import { afterEach, describe, expect, test, vi } from "vitest";
import { Command } from "commander";
vi.mock("@inquirer/prompts", () => ({select: vi.fn()}));
vi.mock("../src/lib/product-catalog.js", () => ({listCawplanProducts: vi.fn()}));
vi.mock("../src/lib/http.js", () => ({cawplanRequest: vi.fn()}));
vi.mock("../src/lib/tty-prompt.js", () => ({
  assertInteractiveTerminal: vi.fn(),
  TTY_CANCEL_MESSAGE: "cancelled", ttyKeysHelpTip: () => "",
  withTtyShortcuts: async (run: (context: object) => unknown) => run({}),
}));
import { select } from "@inquirer/prompts";
import { listCawplanProducts } from "../src/lib/product-catalog.js";
import { cawplanRequest } from "../src/lib/http.js";
import { registerKnowledgeCommand } from "../src/commands/knowledge.js";

afterEach(() => {vi.restoreAllMocks(); vi.clearAllMocks();});
describe("knowledge interactive label security", () => {
  test("sanitizes actual product and module picker labels, preserves IDs, and only performs reads", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(listCawplanProducts).mockResolvedValue({code: "SUCCESS", data: [
      {unique_id: "product-1", name: "Product\x1b]52;c;canary\x07"},
    ]});
    vi.mocked(select).mockResolvedValueOnce("product-1").mockResolvedValueOnce("module-1");
    vi.mocked(cawplanRequest).mockImplementation(async (request) => {
      expect(request.method).toBe("GET");
      if (request.path.endsWith("/module-tree")) return {data: {nodes: [
        {id: "module-1", name: "Module\x1b[2J", level: 1, knowledge: [{name: "Dataset\x1b[8m"}]},
      ]}};
      expect(request.query).toEqual({product_id: "product-1", module_id: "module-1"});
      return {code: "SUCCESS", data: []};
    });
    const program = new Command();
    registerKnowledgeCommand(program);
    await program.parseAsync(["node", "cawplan", "knowledge", "datasets", "list", "--interactive"]);
    const prompts = vi.mocked(select).mock.calls.map(([options]) => options as unknown as {choices: Array<{name: string; value: unknown}>});
    expect(prompts[0].choices).toEqual([{name: "Product", value: "product-1"}]);
    expect(prompts[1].choices.find((choice) => choice.value === "module-1")).toEqual({name: "Module (Dataset)", value: "module-1"});
    expect(cawplanRequest).toHaveBeenCalledTimes(2);
  });
});
