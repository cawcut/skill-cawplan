import { describe, expect, test } from "vitest";
import { formatColumnGrid } from "../src/lib/init/format-columns.js";

describe("formatColumnGrid", () => {
  test("returns an empty array for no items", () => {
    expect(formatColumnGrid([], 80)).toEqual([]);
  });

  test("fits everything on one line when it all fits within the width", () => {
    expect(formatColumnGrid(["a", "bb", "ccc"], 80)).toEqual(["a    bb   ccc"]);
  });

  test("wraps into column-major columns (ls -C order) when width is limited", () => {
    expect(formatColumnGrid(["aa", "bb", "cc", "dd"], 10)).toEqual(["aa  cc", "bb  dd"]);
  });

  test("falls back to one item per line when width is smaller than the longest item", () => {
    expect(formatColumnGrid(["one", "two", "three", "four", "five"], 3)).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
    ]);
  });
});
