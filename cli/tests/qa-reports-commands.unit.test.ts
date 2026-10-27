import { describe, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readQAReportBody,
  runQAReportsCreate,
  runQAReportsUpdate,
} from "../src/commands/qa-reports";

const PRODUCT = "019cf9b6-0840-7b04-929e-850f72a9e333";
const VERSION = "ver_2_18_0";
const REPORT = "qa_report_00001";

interface Call {
  method?: string;
  path: string;
  body?: unknown;
}

function harness(response: unknown) {
  const calls: Call[] = [];
  const request = async (options: Call) => {
    calls.push(options);
    return response;
  };
  return { calls, deps: { request: request as never } };
}

const ok = (data: unknown) => ({ code: "SUCCESS", msg: "success", data });

describe("qa-reports create", () => {
  test("POST Portal qa_report", async () => {
    const body = { topic: "[Progress] Test", type: "sqa", ticket_id: "ticket_1" };
    const h = harness(ok({ unique_id: REPORT, display_id: "QA-00001" }));
    await runQAReportsCreate(PRODUCT, VERSION, body, h.deps);
    expect(h.calls[0]).toEqual({
      method: "POST",
      path: `/api/v1/public/openapi/product/${PRODUCT}/versions/${VERSION}/qa_report`,
      body,
    });
  });
});

describe("qa-reports update", () => {
  test("PUT Portal qa_report", async () => {
    const body = { topic: "[Completion] Test", status: "approved" };
    const h = harness(ok({ unique_id: REPORT, display_id: "QA-00001" }));
    await runQAReportsUpdate(PRODUCT, VERSION, REPORT, body, h.deps);
    expect(h.calls[0]).toEqual({
      method: "PUT",
      path: `/api/v1/public/openapi/product/${PRODUCT}/versions/${VERSION}/qa_report/${REPORT}`,
      body,
    });
  });
});

describe("readQAReportBody", () => {
  test("reads JSON from file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qa-reports-body-"));
    const file = join(dir, "body.json");
    await writeFile(file, JSON.stringify({ topic: "x" }), "utf8");
    const body = await readQAReportBody(file, undefined);
    expect(body).toEqual({ topic: "x" });
  });

  test("reads inline JSON", async () => {
    const body = await readQAReportBody(undefined, '{"topic":"y"}');
    expect(body).toEqual({ topic: "y" });
  });

  test("rejects both body and body-file", async () => {
    await expect(readQAReportBody("a.json", "{}")).rejects.toThrow(/not both/);
  });

  test("requires body input", async () => {
    await expect(readQAReportBody(undefined, undefined)).rejects.toThrow(/required/);
  });
});
