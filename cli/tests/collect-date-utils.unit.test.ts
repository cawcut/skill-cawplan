import { describe, expect, test } from "vitest";
import {
  activityOverlapsLocalDate,
  dayBoundsMs,
  isTimestampOnLocalDate,
  localDateString,
  parseTimestampTag,
} from "../src/lib/collect/date-utils.js";

describe("date-utils", () => {
  test("localDateString uses local calendar day", () => {
    const d = new Date("2026-06-16T15:30:00");
    expect(localDateString(d)).toBe(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
  });

  test("dayBoundsMs covers the full local day", () => {
    const { startMs, endMs } = dayBoundsMs("2026-06-16");
    expect(new Date(startMs).getHours()).toBe(0);
    expect(new Date(endMs).getHours()).toBe(23);
    expect(endMs).toBeGreaterThan(startMs);
  });

  test("activityOverlapsLocalDate detects cross-day overlap", () => {
    const { startMs, endMs } = dayBoundsMs("2026-06-12");
    // Session created June 11, updated June 12
    const created = new Date("2026-06-11T20:00:00").getTime();
    const updated = new Date("2026-06-12T10:00:00").getTime();
    expect(activityOverlapsLocalDate(created, updated, "2026-06-12")).toBe(true);
    expect(activityOverlapsLocalDate(created, updated, "2026-06-11")).toBe(true);
    expect(activityOverlapsLocalDate(created, updated, "2026-06-10")).toBe(false);
    expect(startMs).toBeLessThan(updated);
    expect(endMs).toBeGreaterThan(created);
  });

  test("parseTimestampTag reads Cursor transcript tags", () => {
    const text =
      '<timestamp>Thursday, Jun 11, 2026, 7:14 PM (UTC+8)</timestamp>\n<user_query>\nhello\n</user_query>';
    const parsed = parseTimestampTag(text);
    expect(parsed).not.toBeNull();
    expect(isTimestampOnLocalDate(parsed!, "2026-06-11")).toBe(true);
  });
});
