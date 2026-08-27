import { describe, expect, test } from "vitest";
import { markdownToPlainText } from "../src/lib/knowledge/plaintext.js";

describe("markdownToPlainText", () => {
  test("strips heading markers, keeping the title text", () => {
    expect(markdownToPlainText("### 8.2 Fetch Settings\n\nbody text")).toBe("8.2 Fetch Settings\n\nbody text");
  });

  test("strips bold, italic, strikethrough and inline code markers", () => {
    const md = "**bold** and _italic_ and ~~gone~~ and `code`";
    expect(markdownToPlainText(md)).toBe("bold and italic and gone and code");
  });

  test("renders a GFM table as space-aligned columns without pipes", () => {
    const md = ["| Parameter | Type | Description |", "| --- | --- | --- |", "| nfc | Object | NFC setting. |"].join(
      "\n",
    );
    expect(markdownToPlainText(md)).toBe(
      ["Parameter  Type    Description", "nfc        Object  NFC setting."].map((l) => `  ${l}`).join("\n"),
    );
  });

  test("pads every column but the last, so no trailing whitespace is emitted", () => {
    const md = ["| a | b |", "| --- | --- |", "| longer | x |"].join("\n");
    for (const line of markdownToPlainText(md).split("\n")) {
      expect(line).toBe(line.trimEnd());
    }
  });

  test("keeps fenced code indented by default and drops it when asked", () => {
    const md = ["text", "```bash", "curl example", "```"].join("\n");
    expect(markdownToPlainText(md)).toBe("text\n  curl example");
    expect(markdownToPlainText(md, { stripCodeBlocks: true })).toBe("text");
  });

  test("does not treat a #-prefixed line inside a fence as a heading", () => {
    const md = ["# Real", "```bash", "# just a shell comment", "```"].join("\n");
    expect(markdownToPlainText(md)).toBe("Real\n  # just a shell comment");
  });

  test("normalizes list bullets and unwraps blockquotes", () => {
    const md = ["* one", "+ two", "> quoted line"].join("\n");
    expect(markdownToPlainText(md)).toBe("- one\n- two\nquoted line");
  });

  test("converts links to text plus url, and images to their alt text", () => {
    expect(markdownToPlainText("see [docs](https://x.test)")).toBe("see docs (https://x.test)");
    expect(markdownToPlainText("![diagram](a.png)")).toBe("diagram");
  });

  test("collapses blank-line runs and trims leading/trailing whitespace", () => {
    expect(markdownToPlainText("\n\n# Title\n\n\n\nbody\n\n\n")).toBe("Title\n\nbody");
  });

  test("compact drops blank lines so maxLines buys that many content lines", () => {
    const md = "# Title\n\npara one\n\npara two";
    expect(markdownToPlainText(md)).toBe("Title\n\npara one\n\npara two");
    expect(markdownToPlainText(md, { compact: true })).toBe("Title\npara one\npara two");
    expect(markdownToPlainText(md, { compact: true, maxLines: 2 })).toBe("Title\npara one");
  });

  test("honors maxLines by truncating the output", () => {
    const md = ["one", "two", "three", "four"].join("\n");
    expect(markdownToPlainText(md, { maxLines: 2 })).toBe("one\ntwo");
  });

  test("returns an empty string for empty or whitespace-only input", () => {
    expect(markdownToPlainText("")).toBe("");
    expect(markdownToPlainText("\n\n   \n")).toBe("");
  });
});
