import { describe, expect, test } from "vitest";
import {
  reconcileTestPoints,
  CountReconcileValidationError,
} from "../src/lib/qa-insights/reconcile-testpoints";

describe("A2-§9.4 / P8 count reconcile — old + batch means the batch landed", () => {
  const result = reconcileTestPoints({ countBefore: 7, countAfter: 10, batchSize: 3 });

  test("A2-§9.4 outcome is RECONCILED", () => {
    expect(result.outcome).toBe("RECONCILED");
  });
  test("A2-§9.4 decision is count_matched", () => {
    expect(result.reconcile.decision).toBe("count_matched");
  });
  test("P8 counts are echoed for the caller", () => {
    expect(result.reconcile).toMatchObject({ count_before: 7, count_after: 10, batch_size: 3 });
  });
  test("P8 message warns against archiving again", () => {
    expect(result.message).toMatch(/do NOT archive it again/i);
  });
  test("A2-§9.4 strategy is testpoint_count (never five-field match)", () => {
    expect(result.reconcile.strategy).toBe("testpoint_count");
  });
  test("A2-§9.4 works from an empty baseline", () => {
    expect(reconcileTestPoints({ countBefore: 0, countAfter: 3, batchSize: 3 }).outcome)
      .toBe("RECONCILED");
  });
});

describe("A2-§9.4 / P8 count reconcile — unchanged count means retry the same batch", () => {
  const result = reconcileTestPoints({ countBefore: 7, countAfter: 7, batchSize: 3 });

  test("A2-§9.4 outcome is FAILURE", () => {
    expect(result.outcome).toBe("FAILURE");
  });
  test("A2-§9.4 decision is retry_same_batch", () => {
    expect(result.reconcile.decision).toBe("retry_same_batch");
  });
  test("A2-§9.4 message says archive the SAME batch", () => {
    expect(result.message).toMatch(/SAME batch/i);
  });
  test("A2-§9.4 unchanged zero baseline also retries", () => {
    expect(reconcileTestPoints({ countBefore: 0, countAfter: 0, batchSize: 5 }).reconcile.decision)
      .toBe("retry_same_batch");
  });
});

/*
 * Phase 1a merges the former count_mismatch_partial / count_mismatch_high into
 * one bucket: the batch is all-or-nothing, so a partial count should be
 * unreachable, and both ends warrant the identical response — stop and have a
 * human look. Both directions are still exercised here.
 */
describe("A2-§9.4 / P8 count_unexpected — merged bucket covers low AND high", () => {
  test("A2-§9.4 count below old + batch is count_unexpected (partial)", () => {
    const result = reconcileTestPoints({ countBefore: 7, countAfter: 9, batchSize: 3 });
    expect(result.reconcile.decision).toBe("count_unexpected");
    expect(result.outcome).toBe("FAILURE");
  });
  test("A2-§9.4 count above old + batch is count_unexpected (high)", () => {
    const result = reconcileTestPoints({ countBefore: 7, countAfter: 12, batchSize: 3 });
    expect(result.reconcile.decision).toBe("count_unexpected");
    expect(result.outcome).toBe("FAILURE");
  });
  test("A2-§9.4 both directions share one decision code", () => {
    const low = reconcileTestPoints({ countBefore: 7, countAfter: 9, batchSize: 3 });
    const high = reconcileTestPoints({ countBefore: 7, countAfter: 12, batchSize: 3 });
    expect(low.reconcile.decision).toBe(high.reconcile.decision);
  });
  test("A2-§9.4 a count that DROPPED is also count_unexpected", () => {
    expect(reconcileTestPoints({ countBefore: 7, countAfter: 4, batchSize: 3 }).reconcile.decision)
      .toBe("count_unexpected");
  });
  test("P8 message directs a human to inspect", () => {
    const result = reconcileTestPoints({ countBefore: 7, countAfter: 12, batchSize: 3 });
    expect(result.message).toMatch(/manually/i);
  });
  test("P9 count_unexpected explicitly refuses to re-POST", () => {
    const result = reconcileTestPoints({ countBefore: 7, countAfter: 9, batchSize: 3 });
    expect(result.message).toMatch(/will not re-POST/i);
  });
});

/*
 * The baseline must be supplied by the caller. Deriving it inside the command
 * would need a second GET, and any concurrent append between the two reads
 * would corrupt the comparison.
 */
describe("A2-§9.4 count reconcile — count_before is mandatory, never guessed", () => {
  test("A2-§9.4 missing countBefore is a validation error", () => {
    expect(() => reconcileTestPoints({ countAfter: 10, batchSize: 3 } as never))
      .toThrow(CountReconcileValidationError);
  });
  test("A2-§9.4 the error names --count-before", () => {
    expect(() => reconcileTestPoints({ countAfter: 10, batchSize: 3 } as never))
      .toThrow(/--count-before/);
  });
  test("A2-§9.4 the error explains the baseline must precede the batch", () => {
    expect(() => reconcileTestPoints({ countAfter: 10, batchSize: 3 } as never))
      .toThrow(/BEFORE the batch/);
  });
  test("A2-§9.4 negative countBefore is rejected", () => {
    expect(() => reconcileTestPoints({ countBefore: -1, countAfter: 3, batchSize: 3 }))
      .toThrow(CountReconcileValidationError);
  });
  test("A2-§9.4 non-integer countBefore is rejected", () => {
    expect(() => reconcileTestPoints({ countBefore: 1.5, countAfter: 3, batchSize: 3 }))
      .toThrow(CountReconcileValidationError);
  });
  test("A2-§9.4 missing batchSize is rejected", () => {
    expect(() => reconcileTestPoints({ countBefore: 1, countAfter: 3 } as never))
      .toThrow(/--batch-size/);
  });
  test("A2-§9.4 zero batchSize is rejected", () => {
    expect(() => reconcileTestPoints({ countBefore: 1, countAfter: 1, batchSize: 0 }))
      .toThrow(/greater than zero/);
  });
  test("A2-§9.4 missing countAfter is rejected", () => {
    expect(() => reconcileTestPoints({ countBefore: 1, batchSize: 3 } as never))
      .toThrow(CountReconcileValidationError);
  });
});

describe("P9 count reconcile never auto-POSTs on any branch", () => {
  const cases = [
    { name: "count_matched", input: { countBefore: 7, countAfter: 10, batchSize: 3 } },
    { name: "retry_same_batch", input: { countBefore: 7, countAfter: 7, batchSize: 3 } },
    { name: "count_unexpected", input: { countBefore: 7, countAfter: 9, batchSize: 3 } },
  ];

  for (const { name, input } of cases) {
    test(`P9 ${name} does not instruct an automatic re-post`, () => {
      const message = reconcileTestPoints(input).message.toLowerCase();
      expect(message).not.toMatch(/automatically (re-?post|retry)/);
    });
  }

  test("P9 all three decisions are reachable", () => {
    const decisions = cases.map(({ input }) => reconcileTestPoints(input).reconcile.decision);
    expect(new Set(decisions).size).toBe(3);
  });
});
