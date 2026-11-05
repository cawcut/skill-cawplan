import {describe, expect, test} from "vitest";
import {buildTestPointBatchBody} from "../src/lib/qa-insights/body-builders.js";
import {resolveTestPointGroupOrders} from "../src/lib/qa-insights/testpoint-group-order.js";
import {runTestPointsArchive} from "../src/commands/qa-insights.js";
import type {QAInsightsWriteEnvelope} from "../src/lib/qa-insights/types.js";

const drafts = (groups: string[]) => buildTestPointBatchBody({test_points: groups.map((group) => ({
  title: `${group} point`, group, tags: [], priority: "HIGH", is_edited: false,
}))}).test_points;

describe("requirement-wide group_order resolution", () => {
  test("new groups continue after the max; existing groups reuse their order", () => {
    const points = drafts(["D", "B", "E", "D", "A"]);
    const result = resolveTestPointGroupOrders(points, {test_points: [
      {group: "A", group_order: 1}, {group: "B", group_order: 2}, {group: "C", group_order: 3},
    ]});
    expect(result.map((p) => p.group_order)).toEqual([4, 2, 5, 4, 1]);
    expect(result.map((p) => p.title)).toEqual(points.map((p) => p.title));
    expect(result.every((p) => !("sort_order" in p))).toBe(true);
  });

  test("preserves zero, gaps, and historical duplicate numbers; new groups start after the actual max", () => {
    const result = resolveTestPointGroupOrders(drafts(["A", "D", "", "E"]), {test_points: [
      {group: "A", group_order: 0}, {group: "B", group_order: 7},
      {group: "C", group_order: 7}, {group: null, group_order: 2},
    ]});
    expect(result.map((p) => p.group_order)).toEqual([0, 8, 2, 9]);
  });

  test("new groups follow Review ordering even when deletion changes batch first appearance", () => {
    const points = drafts(["B", "A", "B"]);
    points.forEach((p) => {p.group_order = p.group === "A" ? 1 : 2;});
    expect(resolveTestPointGroupOrders(points, {test_points: [{group: "old", group_order: 3}]})
      .map((p) => p.group_order)).toEqual([5, 4, 5]);
  });

  test.each([
    {}, {test_points: null}, {test_points: [{group: "A"}]},
    {test_points: [{group: "A", group_order: "1"}]},
    {test_points: [{group: "A", group_order: -1}]},
    {test_points: [{group: "A", group_order: 1}, {group: "A", group_order: 2}]},
  ])("rejects unusable BE data instead of falling back to one: %j", (data) => {
    expect(() => resolveTestPointGroupOrders(drafts(["A", "D"]), data)).toThrow(/group_order/);
  });
});

describe("archive preflight", () => {
  test("failed query never POSTs and is a definite pre-write failure", async () => {
    const methods: string[] = [];
    let result: QAInsightsWriteEnvelope | undefined;
    await runTestPointsArchive("p", "r", {body: JSON.stringify({test_points: [{
      title: "D", group: "D", priority: "HIGH",
    }]})}, {
      request: (async (options: {method?: string}) => {
        methods.push(options.method ?? "GET");
        throw new Error("offline");
      }) as never,
      emit: (envelope) => {result = envelope;},
    });
    expect(methods).toEqual(["GET"]);
    expect(result?.outcome).toBe("FAILURE");
  });

  test("dry-run reads BE and shows resolved global numbers without POST", async () => {
    const methods: string[] = [];
    let result: QAInsightsWriteEnvelope | undefined;
    await runTestPointsArchive("p", "r", {body: JSON.stringify({test_points: [{
      title: "D", group: "D", priority: "HIGH",
    }]}), dryRun: true}, {
      request: (async (options: {method?: string}) => {
        methods.push(options.method ?? "GET");
        return {code: "SUCCESS", data: {test_points: [{group: "C", group_order: 3}]}};
      }) as never,
      emit: (envelope) => {result = envelope;},
    });
    expect(methods).toEqual(["GET"]);
    expect(result?.post_body).toMatchObject({test_points: [{group: "D", group_order: 4}]});
  });
});
