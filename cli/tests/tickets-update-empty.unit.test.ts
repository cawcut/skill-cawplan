import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Command } from "commander";
import { registerTicketsCommand } from "../src/commands/tickets.js";
import * as http from "../src/lib/http.js";
import { buildTicketUpdateTextFields, TicketUpdateInputError } from "../src/lib/ticket-update-body.js";

const PRODUCT = "01983225-e595-71c6-9c88-4235d35fc743";
const VERSION = "01a1af89-3b0e-792b-9218-e82eadaa9a8e";
const TICKET = "01a1c357-062e-7e10-8086-861afad6bc83";

describe("buildTicketUpdateTextFields", () => {
  test("passes non-empty text fields through unchanged", () => {
    expect(
      buildTicketUpdateTextFields({
        progress_comment: "<p>done</p>",
        remarks: "<p>body</p>",
        root_cause: "race",
        solution: "lock",
        description: "Title",
        comment: "note",
      }),
    ).toEqual({
      progress_comment: "<p>done</p>",
      remarks: "<p>body</p>",
      root_cause: "race",
      solution: "lock",
      description: "Title",
      comment: "note",
    });
  });

  test.each([
    ["progress_comment", "--progress_comment", "--clear-progress-comment"],
    ["remarks", "--remarks", "--clear-remarks"],
    ["root_cause", "--root_cause", "--clear-root-cause"],
    ["solution", "--solution", "--clear-solution"],
  ])("rejects an empty or blank %s and points to its clear flag", (key, flag, clearFlag) => {
    for (const value of ["", "   ", "\n\t"]) {
      const err = (() => {
        try {
          buildTicketUpdateTextFields({ [key]: value });
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(TicketUpdateInputError);
      expect((err as Error).message).toContain(flag);
      expect((err as Error).message).toContain(clearFlag);
    }
  });

  test.each(["description", "comment"])("rejects an empty %s without offering a clear flag", (key) => {
    expect(() => buildTicketUpdateTextFields({ [key]: " " })).toThrow(/omit the flag to leave it unchanged/);
  });

  test.each([
    ["clearProgressComment", "progress_comment"],
    ["clearRemarks", "remarks"],
    ["clearRootCause", "root_cause"],
    ["clearSolution", "solution"],
  ])("%s sends an empty %s", (clearKey, field) => {
    expect(buildTicketUpdateTextFields({ [clearKey]: true })).toEqual({ [field]: "" });
  });

  test("rejects a value combined with its clear flag", () => {
    expect(() => buildTicketUpdateTextFields({ remarks: "<p>x</p>", clearRemarks: true })).toThrow(
      "--remarks and --clear-remarks cannot be used together",
    );
  });

  test.each([
    ["status", "--status"],
    ["priority", "--priority"],
    ["target_version_id", "--target_version_id"],
    ["targetVer", "--target-ver"],
    ["parent_id", "--parent_id"],
    ["due_date", "--due_date"],
    ["assignees", "--assignees"],
    ["label_ids", "--label_ids"],
    ["module", "--module"],
    ["expected_version", "--expected_version"],
  ])("rejects an empty %s instead of silently dropping it", (key, flag) => {
    expect(() => buildTicketUpdateTextFields({ [key]: "  " })).toThrow(flag);
  });

  test("rejects id lists that contain only separators", () => {
    expect(() => buildTicketUpdateTextFields({ assignees: " , ," })).toThrow("--assignees has no ids");
    expect(() => buildTicketUpdateTextFields({ label_ids: "," })).toThrow("--label_ids has no ids");
  });

  test("requires --expected_version to be a non-negative integer", () => {
    expect(() => buildTicketUpdateTextFields({ expected_version: "abc" })).toThrow(/non-negative integer/);
    expect(() => buildTicketUpdateTextFields({ expected_version: "-1" })).toThrow(/non-negative integer/);
    expect(buildTicketUpdateTextFields({ expected_version: "7" })).toEqual({});
  });
});

async function run(args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerTicketsCommand(program);
  await program.parseAsync(["node", "cawplan", "tickets", ...args], { from: "node" });
}

describe("tickets update empty-value guard", () => {
  let request: ReturnType<typeof vi.spyOn>;
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    request = vi.spyOn(http, "cawplanRequest").mockResolvedValue({ code: "SUCCESS", data: { unique_id: TICKET } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("an empty --remarks exits before any request is made", async () => {
    await expect(run(["update", PRODUCT, VERSION, TICKET, "--remarks", ""])).rejects.toThrow("process.exit(1)");
    expect(request).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("--clear-remarks"));
  });

  test("an empty --progress_comment alongside a valid --status still writes nothing", async () => {
    await expect(
      run(["update", PRODUCT, VERSION, TICKET, "--status", "DONE", "--progress_comment", ""]),
    ).rejects.toThrow("process.exit(1)");
    expect(request).not.toHaveBeenCalled();
  });

  test("--clear-remarks sends remarks as an empty string", async () => {
    await run(["update", PRODUCT, VERSION, TICKET, "--clear-remarks"]);
    const put = request.mock.calls.find(([req]) => req.method === "PUT");
    expect(put?.[0].body).toEqual({ remarks: "" });
  });

  test("non-empty text fields are sent as given", async () => {
    await run(["update", PRODUCT, VERSION, TICKET, "--progress_comment", "<p>ok</p>", "--root_cause", "race"]);
    const put = request.mock.calls.find(([req]) => req.method === "PUT");
    expect(put?.[0].body).toEqual({ progress_comment: "<p>ok</p>", root_cause: "race" });
  });
});
