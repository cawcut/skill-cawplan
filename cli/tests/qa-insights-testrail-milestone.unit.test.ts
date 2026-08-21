import { describe, expect, test } from "vitest";
import { buildTestrailMilestoneValidateQuery } from "../src/lib/qa-insights/testrail-milestone";

describe("buildTestrailMilestoneValidateQuery", () => {
  test("requires version_id", () => {
    expect(() => buildTestrailMilestoneValidateQuery({})).toThrow(/version_id is required/);
  });

  test("builds validate query", () => {
    expect(buildTestrailMilestoneValidateQuery({ versionId: "ver_2_18_0" })).toEqual({
      version_id: "ver_2_18_0",
    });
  });
});
