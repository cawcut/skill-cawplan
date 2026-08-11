import { describe, expect, test } from "vitest";
import {
  buildTestrailImportExecuteBody,
  buildTestrailImportPreviewBody,
  mergeTestrailImportPreviewBody,
} from "../src/lib/qa-insights/body-builders";

describe("buildTestrailImportPreviewBody", () => {
  test("REQUIREMENT source requires requirementId", () => {
    expect(() => buildTestrailImportPreviewBody({ sourceType: "REQUIREMENT" })).toThrow(
      /--requirement-id/,
    );
  });

  test("REQUIREMENT builds source + optional suite", () => {
    const body = buildTestrailImportPreviewBody({
      sourceType: "REQUIREMENT",
      requirementId: "req-1",
      suiteId: 101,
      versionName: "2.18.0",
    });
    expect(body).toEqual({
      source: { type: "REQUIREMENT", requirement_id: "req-1" },
      suite_id: 101,
      version_name: "2.18.0",
    });
  });

  test("INLINE requires cases", () => {
    expect(() => buildTestrailImportPreviewBody({ sourceType: "INLINE" })).toThrow(/cases/);
  });
});

describe("buildTestrailImportExecuteBody", () => {
  test("requires previewId", () => {
    expect(() => buildTestrailImportExecuteBody("  ", true)).toThrow();
  });

  test("sets confirm flag", () => {
    expect(buildTestrailImportExecuteBody("prev-1", true)).toEqual({
      preview_id: "prev-1",
      confirm: true,
    });
  });
});

describe("mergeTestrailImportPreviewBody", () => {
  test("body file wins for cases, flags override suite", () => {
    const body = mergeTestrailImportPreviewBody(
      {
        source: { type: "INLINE" },
        cases: [{ title: "case 1", steps: [] }],
        suite_id: 100,
      },
      { suiteId: 101 },
    );
    expect(body.suite_id).toBe(101);
    expect(body.cases).toHaveLength(1);
  });

  test("normalizes legacy camelCase INLINE fields to snake_case", () => {
    const body = mergeTestrailImportPreviewBody(
      {
        source: { type: "INLINE" },
        cases: [
          {
            testPointId: "tp-1",
            requirementId: "req-1",
            title: "case 1",
            moduleTreeNodeId: "mtn-1",
            priority: "high",
            importance: 1,
            versionName: "2.18.0",
            automationType: "API",
            automationResult: "passed",
            sourceCaseKey: "tp-1-login-main-workspace",
            contentHash: "sha256:abc",
          },
        ],
      },
      {},
    );
    expect(body.cases).toEqual([
      expect.objectContaining({
        test_point_id: "tp-1",
        requirement_id: "req-1",
        module_tree_node_id: "mtn-1",
        priority: "HIGH",
        importance: "1",
        version_name: "2.18.0",
        automation_type: "API",
        automation_result: "passed",
        source_case_key: "tp-1-login-main-workspace",
        content_hash: "sha256:abc",
      }),
    ]);
  });

  test("normalizes T1 generated case data before preview", () => {
    const body = mergeTestrailImportPreviewBody(
      {
        source: { type: "INLINE" },
        version_name: "4.3.1",
        cases: [
          {
            testPointId: "tp-1",
            requirementId: "req-1",
            title: "case from T1",
            group: "登录",
            tag: "正向",
            priority: "P1",
            versionName: "4.3.1",
            steps: ["打开登录页", "输入账号密码"],
            expected: ["展示登录页", "登录成功"],
          },
          {
            testPointId: "tp-2",
            requirementId: "req-1",
            title: "low priority fallback",
            priority: "P5",
            steps: ["点击取消"],
            expected: ["关闭弹窗"],
          },
        ],
      },
      {},
    );

    expect(body.cases).toEqual([
      expect.objectContaining({
        test_point_id: "tp-1",
        requirement_id: "req-1",
        tags: ["正向"],
        priority: "HIGH",
        version_name: "4.3.1",
        steps: [
          { content: "打开登录页", expected: "展示登录页" },
          { content: "输入账号密码", expected: "登录成功" },
        ],
      }),
      expect.objectContaining({
        test_point_id: "tp-2",
        priority: "LOW",
        steps: [{ content: "点击取消", expected: "关闭弹窗" }],
      }),
    ]);
  });

  test("rejects unknown priority instead of passing it to preview", () => {
    expect(() =>
      mergeTestrailImportPreviewBody(
        {
          source: { type: "INLINE" },
          cases: [{ title: "case 1", priority: "urgent" }],
        },
        {},
      ),
    ).toThrow(/Unsupported priority/);
  });
});
