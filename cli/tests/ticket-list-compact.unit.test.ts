import { describe, expect, test } from "vitest";
import { compactTicketRow, compactTicketSearchResult, isTicketSearchView } from "../src/lib/ticket-list-compact.js";

const FULL_ROW = {
  unique_id: "01a17c29-b890-7431-b136-29846f2cb41e",
  display_id: "CAWP-25684",
  description: "Default ticket page size",
  status: "NOT_STARTED",
  status_display: { category: "UNSTARTED", color: "#999", display_name: "Not Started" },
  priority: "HIGH",
  ux: "PENDING",
  product_id: "01983f50-20f6-72b4-8486-fdc44f2a4146",
  version_id: "01a166bb-879d-7b83-9f73-0351938a9dc2",
  version_name: "1.9.45",
  parent_id: null,
  is_backlog: false,
  created_at: 1793084471,
  updated_at: 1793584023,
  labels: [{ unique_id: "l1", name: "Bugfix", color: "#F03A3E", behavior: "BUGFIX" }],
  assignees: [
    { user_id: "u1", first_name: "Ada", last_name: "Lovelace", avatar: "https://cdn/a.jpg" },
    { user_id: "u2", first_name: "", last_name: "" },
  ],
  assignee_ids: ["u1", "u2"],
  remarks: "<p>long remarks</p>",
  root_cause: { data: "<p>cause</p>" },
  solution: { data: "<p>fix</p>" },
  reporter: { user_id: "r1", first_name: "Grace", last_name: "Hopper", avatar: "https://cdn/r.jpg" },
  created_by_user: { user_id: "r1", avatar: "https://cdn/r.jpg" },
  progress_comment: "<p>progress</p>",
};

describe("compactTicketRow", () => {
  test("keeps the server compact field set", () => {
    expect(compactTicketRow({ ...FULL_ROW, qa_assignee_ids: ["q1"], module_id: "m1", module_name: "Login" })).toEqual({
      unique_id: FULL_ROW.unique_id,
      display_id: "CAWP-25684",
      description: "Default ticket page size",
      status: "NOT_STARTED",
      status_display: { category: "UNSTARTED", display_name: "Not Started" },
      priority: "HIGH",
      ux: "PENDING",
      product_id: FULL_ROW.product_id,
      version_id: FULL_ROW.version_id,
      version_name: "1.9.45",
      parent_id: null,
      is_backlog: false,
      created_at: 1793084471,
      updated_at: 1793584023,
      qa_assignee_ids: ["q1"],
      module_id: "m1",
      module_name: "Login",
      labels: [{ name: "Bugfix", behavior: "BUGFIX" }],
      assignees: [
        { user_id: "u1", first_name: "Ada", last_name: "Lovelace" },
        { user_id: "u2", first_name: "", last_name: "" },
      ],
    });
  });

  test("leaves non-object rows untouched", () => {
    expect(compactTicketRow("x")).toBe("x");
  });
});

describe("compactTicketSearchResult", () => {
  test("projects rows and preserves envelope paging fields", () => {
    const result = compactTicketSearchResult({
      code: "SUCCESS",
      msg: "success",
      page_num: 1,
      page_size: 50,
      total: 1391,
      data: [FULL_ROW],
    }) as Record<string, unknown>;
    expect(result).toMatchObject({ code: "SUCCESS", msg: "success", page_num: 1, page_size: 50, total: 1391 });
    const [row] = result.data as Record<string, unknown>[];
    expect(row).not.toHaveProperty("remarks");
    expect(row).not.toHaveProperty("reporter");
    expect(row.display_id).toBe("CAWP-25684");
  });

  test("returns error envelopes without data unchanged", () => {
    const failure = { code: "INVALID_ACCESS_TOKEN", msg: "expired" };
    expect(compactTicketSearchResult(failure)).toBe(failure);
  });
});

describe("isTicketSearchView", () => {
  test("accepts full and compact only", () => {
    expect(isTicketSearchView("full")).toBe(true);
    expect(isTicketSearchView("compact")).toBe(true);
    expect(isTicketSearchView("brief")).toBe(false);
  });
});
