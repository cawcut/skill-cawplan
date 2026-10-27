import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Command } from "commander";
import { registerTicketsCommand } from "../src/commands/tickets.js";
import * as http from "../src/lib/http.js";

const PRODUCT = "01983225-e595-71c6-9c88-4235d35fc743";
const VERSION = "01a0d2b3-4103-7db2-aec3-befc9b170a74";
const PARENT_UNIQUE = "019f2760-d4bb-7374-bbee-90ec89cd5276";
const PARENT_DISPLAY = "CWP-14556";

async function run(args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerTicketsCommand(program);
  await program.parseAsync(["node", "cawplan", "tickets", ...args], { from: "node" });
}

describe("tickets create-* --parent_id (sub-tickets)", () => {
  let request: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    request = vi.spyOn(http, "cawplanRequest").mockImplementation(async (req) => {
      if (req.path.endsWith("/tickets/search")) {
        return { data: [{ unique_id: PARENT_UNIQUE, display_id: PARENT_DISPLAY, product_id: PRODUCT, version_id: VERSION }] };
      }
      return { code: "SUCCESS", data: { unique_id: "child", display_id: "CWP-30001" } };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("create-version resolves a display ID parent to its unique ID", async () => {
    await run(["create-version", PRODUCT, VERSION, "--description", "Child", "--parent_id", PARENT_DISPLAY]);

    const search = request.mock.calls.find(([req]) => req.path.endsWith("/tickets/search"));
    expect(search?.[0].body).toEqual({ display_ids: [PARENT_DISPLAY] });
    const create = request.mock.calls.find(([req]) => req.path.endsWith(`/versions/${VERSION}/tickets`));
    expect(create?.[0].body).toMatchObject({ description: "Child", parent_id: PARENT_UNIQUE });
  });

  test("create-backlog passes a unique ID parent through without searching", async () => {
    await run(["create-backlog", PRODUCT, "--description", "Child", "--parent_id", PARENT_UNIQUE]);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0].body).toMatchObject({ parent_id: PARENT_UNIQUE });
  });
});
