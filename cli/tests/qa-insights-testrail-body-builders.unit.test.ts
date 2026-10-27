import { describe, expect, test } from "vitest";
import {
  buildTestrailImportExecuteBody,
  buildTestrailImportPreviewBody,
  buildTestrailDefectCreateTicketBody,
  buildTestrailDefectDraftBody,
  buildTestrailDefectLinkTicketBody,
  buildTestrailPlanExecuteBody,
  buildTestrailPlanPreviewBody,
  buildTestrailPlanRulesBody,
  mergeTestrailImportPreviewBody,
  mergeTestrailDefectDraftBody,
  mergeTestrailPlanPreviewBody,
  requiredPositiveInteger,
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

  test("parentSectionId nests the AUTO_BY_GROUP top section under an existing Section", () => {
    const body = buildTestrailImportPreviewBody({
      sourceType: "REQUIREMENT",
      requirementId: "req-1",
      suiteId: 335210,
      parentSectionId: 4377824,
    });
    expect(body).toEqual({
      source: { type: "REQUIREMENT", requirement_id: "req-1" },
      suite_id: 335210,
      parent_section_id: 4377824,
    });
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

  test("merges parent_section_id from body file and lets flags override", () => {
    const fromFile = mergeTestrailImportPreviewBody(
      { source: { type: "REQUIREMENT", requirement_id: "req-1" }, parent_section_id: 4377824 },
      {},
    );
    expect(fromFile.parent_section_id).toBe(4377824);

    const overridden = mergeTestrailImportPreviewBody(
      { source: { type: "REQUIREMENT", requirement_id: "req-1" }, parent_section_id: 4377824 },
      { parentSectionId: 5001 },
    );
    expect(overridden.parent_section_id).toBe(5001);
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

describe("buildTestrailPlanPreviewBody", () => {
  test("requires version id", () => {
    expect(() => buildTestrailPlanPreviewBody({})).toThrow(/--version-id/);
  });

  test("builds version-scoped preview body", () => {
    expect(
      buildTestrailPlanPreviewBody({
        versionId: "ver-1",
        milestoneName: "UniFi Network 2.18.0",
        startDate: "2026-08-10",
        endDate: "2026-08-20",
      }),
    ).toEqual({
      version_id: "ver-1",
      milestone_name: "UniFi Network 2.18.0",
      start_date: "2026-08-10",
      end_date: "2026-08-20",
    });
  });

  test("builds ticket-scoped preview body", () => {
    expect(buildTestrailPlanPreviewBody({ versionId: "ver-1", ticketId: "ticket-1" })).toEqual({
      version_id: "ver-1",
      ticket_id: "ticket-1",
    });
  });

  test("parses comma-separated ticket ids", () => {
    expect(
      buildTestrailPlanPreviewBody({ versionId: "ver-1", ticketIds: "ticket-1, ticket-2" }),
    ).toEqual({
      version_id: "ver-1",
      ticket_ids: ["ticket-1", "ticket-2"],
    });
  });

  test("rejects ticket_id and ticket_ids together", () => {
    expect(() =>
      buildTestrailPlanPreviewBody({
        versionId: "ver-1",
        ticketId: "ticket-1",
        ticketIds: ["ticket-2"],
      }),
    ).toThrow(/either --ticket-id or --ticket-ids/);
  });

  test("rejects invalid date format", () => {
    expect(() => buildTestrailPlanPreviewBody({ versionId: "ver-1", startDate: "08/10/2026" }))
      .toThrow(/YYYY-MM-DD/);
  });

  test("supports explicit milestone create strategy", () => {
    expect(
      buildTestrailPlanPreviewBody({
        versionId: "ver-1",
        milestoneName: "UniFi Network 2.18.0",
        milestoneStrategy: "CREATE",
      }),
    ).toEqual({
      version_id: "ver-1",
      milestone_name: "UniFi Network 2.18.0",
      milestone_strategy: "CREATE",
    });
  });

  test("supports milestone reuse by id", () => {
    expect(
      buildTestrailPlanPreviewBody({
        versionId: "ver-1",
        milestoneStrategy: "REUSE_BY_ID",
        milestoneId: "88",
      }),
    ).toEqual({
      version_id: "ver-1",
      milestone_strategy: "REUSE_BY_ID",
      milestone_id: 88,
    });
  });

  test("REUSE_BY_ID requires milestone id", () => {
    expect(() =>
      buildTestrailPlanPreviewBody({
        versionId: "ver-1",
        milestoneStrategy: "REUSE_BY_ID",
      }),
    ).toThrow(/requires --milestone-id/);
  });

  test("rejects milestone id unless strategy is REUSE_BY_ID", () => {
    expect(() =>
      buildTestrailPlanPreviewBody({
        versionId: "ver-1",
        milestoneStrategy: "CREATE",
        milestoneId: 88,
      }),
    ).toThrow(/only accepted/);
  });

  test("rejects unsupported milestone strategy", () => {
    expect(() =>
      buildTestrailPlanPreviewBody({
        versionId: "ver-1",
        milestoneStrategy: "REUSE" as never,
      }),
    ).toThrow(/milestone_strategy/);
  });

  test("supports ticket reuse strategy AUTO", () => {
    expect(
      buildTestrailPlanPreviewBody({ versionId: "ver-1", ticketReuseStrategy: "AUTO" }),
    ).toEqual({
      version_id: "ver-1",
      ticket_reuse_strategy: "AUTO",
    });
  });

  test("supports ticket reuse strategy CREATE_ALL", () => {
    expect(
      buildTestrailPlanPreviewBody({ versionId: "ver-1", ticketReuseStrategy: "CREATE_ALL" }),
    ).toEqual({
      version_id: "ver-1",
      ticket_reuse_strategy: "CREATE_ALL",
    });
  });

  test("rejects unsupported ticket reuse strategy", () => {
    expect(() =>
      buildTestrailPlanPreviewBody({
        versionId: "ver-1",
        ticketReuseStrategy: "REUSE" as never,
      }),
    ).toThrow(/ticket_reuse_strategy/);
  });
});

describe("mergeTestrailPlanPreviewBody", () => {
  test("flags override JSON body", () => {
    const body = mergeTestrailPlanPreviewBody(
      { version_id: "ver-from-body", ticket_id: "ticket-from-body" },
      { versionId: "ver-from-flag", ticketId: "ticket-from-flag" },
    );
    expect(body).toEqual({
      version_id: "ver-from-flag",
      ticket_id: "ticket-from-flag",
    });
  });

  test("normalizes camelCase body fields", () => {
    const body = mergeTestrailPlanPreviewBody(
      {
        versionId: "ver-1",
        ticketIds: ["ticket-1", "ticket-2"],
        milestoneName: "Milestone",
        milestoneStrategy: "reuse_by_id",
        milestoneId: "88",
        startDate: "2026-08-10",
        endDate: "2026-08-20",
      },
      {},
    );
    expect(body).toEqual({
      version_id: "ver-1",
      ticket_ids: ["ticket-1", "ticket-2"],
      milestone_name: "Milestone",
      milestone_strategy: "REUSE_BY_ID",
      milestone_id: 88,
      start_date: "2026-08-10",
      end_date: "2026-08-20",
    });
  });
});

describe("buildTestrailPlanExecuteBody", () => {
  test("requires preview id", () => {
    expect(() => buildTestrailPlanExecuteBody("  ", true)).toThrow(/--preview-id/);
  });

  test("sets confirm flag", () => {
    expect(buildTestrailPlanExecuteBody("prev-1", true)).toEqual({
      preview_id: "prev-1",
      confirm: true,
    });
  });
});

describe("buildTestrailPlanRulesBody", () => {
  test("accepts R1-R7 rule config", () => {
    expect(
      buildTestrailPlanRulesBody({
        rules: {
          R1: { enabled: true, description: "Version Ticket cases" },
          R7: { enabled: false },
        },
        automation_detection: {
          fields: ["custom_automation__type", "custom_automation_results"],
          rule: "ANY_NON_EMPTY",
        },
      }),
    ).toEqual({
      rules: {
        R1: { enabled: true, description: "Version Ticket cases" },
        R7: { enabled: false },
      },
      automation_detection: {
        fields: ["custom_automation__type", "custom_automation_results"],
        rule: "ANY_NON_EMPTY",
      },
    });
  });

  test("rejects unsupported rule keys", () => {
    expect(() => buildTestrailPlanRulesBody({ rules: { R8: { enabled: true } } }))
      .toThrow(/unsupported rule R8/);
  });
});

describe("A4 defect body builders", () => {
  test("builds defect draft body from optional context", () => {
    expect(
      buildTestrailDefectDraftBody({
        versionId: "ver-1",
        runId: "901",
        caseId: 12345,
        testId: "80001",
      }),
    ).toEqual({
      version_id: "ver-1",
      run_id: 901,
      case_id: 12345,
      test_id: 80001,
    });
  });

  test("defect draft accepts empty context", () => {
    expect(buildTestrailDefectDraftBody({})).toEqual({});
  });

  test("defect draft merges body and flag overrides", () => {
    expect(
      mergeTestrailDefectDraftBody(
        { versionId: "ver-body", run_id: 901, caseId: 12345 },
        { versionId: "ver-flag", runId: 902 },
      ),
    ).toEqual({
      version_id: "ver-flag",
      run_id: 902,
      case_id: 12345,
    });
  });

  test("rejects invalid numeric ids", () => {
    expect(() => buildTestrailDefectDraftBody({ runId: "abc" })).toThrow(/run_id/);
    expect(() => requiredPositiveInteger("0", "result_id")).toThrow(/result_id/);
  });

  test("create-ticket requires a non-empty draft and preserves remarks", () => {
    expect(
      buildTestrailDefectCreateTicketBody({
        draft: {
          type: "BUGFIX",
          version_id: "ver-1",
          description: "登录失败 — 进入错误 workspace",
          remarks: "## 失败现象\n进入错误 workspace",
          parent_id: null,
        },
        linkExistingTicketId: null,
      }),
    ).toEqual({
      draft: {
        type: "BUGFIX",
        version_id: "ver-1",
        description: "登录失败 — 进入错误 workspace",
        remarks: "## 失败现象\n进入错误 workspace",
        parent_id: null,
      },
      link_existing_ticket_id: null,
    });
  });

  test("create-ticket rejects extra top-level keys", () => {
    expect(() =>
      buildTestrailDefectCreateTicketBody({ draft: { description: "title" }, product_id: "p1" }),
    ).toThrow(/remove product_id/);
  });

  test("link-ticket requires ticket id", () => {
    expect(buildTestrailDefectLinkTicketBody("ticket-1")).toEqual({ ticket_id: "ticket-1" });
    expect(() => buildTestrailDefectLinkTicketBody("  ")).toThrow(/--ticket-id/);
  });
});
