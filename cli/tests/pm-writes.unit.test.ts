import { Command } from "commander";
import { afterEach, expect, test, vi } from "vitest";
import { registerProductsCommand } from "../src/commands/products.js";
import { parseDelayTarget, registerVersionsCommand } from "../src/commands/versions.js";
import { registerTicketsCommand } from "../src/commands/tickets.js";
import { registerQAReportsCommand } from "../src/commands/qa-reports.js";
import { registerCriticalCommand } from "../src/commands/critical.js";
import * as http from "../src/lib/http.js";

const ticket = "10000000-0000-4000-8000-000000000001";
const version = "/product/p/versions/v";
const channels = [{ unique_id: "ea" }];
const members = { owners: ["u"], product_managers: [], designers: [], rds: [], qas: [], supports: [], viewers: [] };
const plan = { name: "1.1", target_release: [{ channel_id: "ea", release_at: 1800000000 }] };
const hold = { target_product_id: "p2", target_version_id: "v2", reason: "Waiting for QA" };

async function run(args: string[]): Promise<void> {
  const program = new Command();
  for (const register of [registerProductsCommand, registerVersionsCommand, registerTicketsCommand, registerQAReportsCommand, registerCriticalCommand]) {
    register(program);
  }
  await program.parseAsync(args, { from: "user" });
}

afterEach(() => vi.restoreAllMocks());

interface WriteCase {
  args: string[];
  method: string;
  path: string;
  body?: Record<string, unknown>;
  flags?: string[];
}

const cases: WriteCase[] = [
  { args: ["products", "create"], method: "POST", path: "/products", body: { name: "Demo", product_line_id: "pl" } },
  { args: ["products", "update-members", "p"], method: "PUT", path: "/product/p/members", body: { members } },
  { args: ["versions", "update", "p", "v"], method: "PUT", path: version, body: plan },
  { args: ["versions", "start", "p", "v"], method: "POST", path: version + "/start" },
  { args: ["versions", "release", "p", "v"], method: "POST", path: version + "/release", body: { channels } },
  { args: ["versions", "revoke", "p", "v"], method: "POST", path: version + "/revoke", body: { channels, reason: "Rollback" } },
  { args: ["versions", "hold", "p", "v"], method: "POST", path: version + "/hold", body: hold },
  { args: ["versions", "risk", "p", "v"], method: "POST", path: version + "/risk",
    flags: ["--risk", "high", "--reason", "QA blocked"], body: { risk: "HIGH", risk_reason: "QA blocked" } },
  { args: ["versions", "delay", "p", "v"], method: "POST", path: version + "/delay",
    flags: ["--to", "2030-01-02", "--reason", "QA blocked"], body: { delayed_to_ts: 1893542400, reason: "QA blocked" } },
  { args: ["versions", "reset", "p", "v"], method: "POST", path: version + "/reset" },
  { args: ["backlog", "update", "p", ticket], method: "PUT", path: "/product/p/tickets/" + ticket,
    flags: ["--description", "Updated", "--expected_version", "3"], body: { description: "Updated", version: 3 } },
  { args: ["qa-reports", "delete", "p", "v", "q"], method: "DELETE", path: version + "/qa_report/q" },
  { args: ["critical", "create", "p"], method: "POST", path: "/product/p/critical_issues", body: { description: "Regression" } },
  { args: ["critical", "update", "p", "i"], method: "PUT", path: "/product/p/critical_issues/i", body: { status: "MONITORING" } },
];

test.each(cases)("$args sends the requested write", async ({ args, method, path, flags, body }) => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const request = vi.spyOn(http, "cawplanRequest").mockResolvedValue({ code: "SUCCESS" });
  await run([...args, ...(flags ?? (body ? ["--body", JSON.stringify(body)] : []))]);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith({ method, path: "/api/v1/public/openapi" + path, ...(body && { body }) });
});

test("invalid risk or delay input never submits a write", async () => {
  const request = vi.spyOn(http, "cawplanRequest");
  await expect(run(["versions", "risk", "p", "v", "--risk", "CRITICAL"])).rejects.toThrow("--risk must be one of");
  await expect(run(["versions", "delay", "p", "v", "--to", "2030-02-30", "--reason", "x"])).rejects.toThrow("--to must be");
  expect(request).not.toHaveBeenCalled();
});

test("delay target accepts Unix seconds", () => {
  expect(parseDelayTarget("1893542400")).toBe(1893542400);
  expect(parseDelayTarget("2030-01-02")).toBe(1893542400);
});

test("malformed release details never submit a write", async () => {
  const request = vi.spyOn(http, "cawplanRequest");
  await expect(run(["versions", "release", "p", "v", "--body", "{"])).rejects.toThrow("not valid JSON");
  expect(request).not.toHaveBeenCalled();
});

test.each(cases)("$args rejects a business error in an HTTP success response", async ({ args, flags, body }) => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(http, "cawplanRequest").mockResolvedValue({ code: "INVALID_INPUT", msg: "Version cannot be updated" });
  await expect(run([...args, ...(flags ?? (body ? ["--body", JSON.stringify(body)] : []))]))
    .rejects.toThrow(/INVALID_INPUT.*Version cannot be updated/);
  expect(output).not.toHaveBeenCalled();
});
