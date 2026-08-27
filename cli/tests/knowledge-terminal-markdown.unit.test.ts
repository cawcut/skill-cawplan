import stringWidth from "string-width";
import { afterEach, describe, expect, test } from "vitest";
import { fitTableColumns, getMarkedForTerminal, renderMarkdownPreview } from "../src/lib/knowledge/terminal-markdown.js";

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;]*m/g, "");
}

const originalColumns = process.stdout.columns;
function setTerminalWidth(columns: number): void {
  Object.defineProperty(process.stdout, "columns", { value: columns, configurable: true });
}
afterEach(() => setTerminalWidth(originalColumns));

function borderedLines(rendered: string): string[] {
  return rendered.split("\n").filter((line) => /[┌└├│]/.test(line));
}

describe("fitTableColumns", () => {
  const token = {
    header: [{ text: "HTTP Status Code" }, { text: "Description" }],
    rows: [[{ text: "500, 502, 503, 504 Server Errors" }, { text: "x".repeat(80) }]],
  };

  test("leaves a table that already fits to cli-table3's natural sizing", () => {
    const narrow = { header: [{ text: "a" }, { text: "b" }], rows: [[{ text: "1" }, { text: "2" }]] };
    expect(fitTableColumns(narrow, 80)).toBeUndefined();
  });

  test("shrinks an over-wide table to fill, but not exceed, the available width", () => {
    const widths = fitTableColumns(token, 80)!;
    const rendered = widths.reduce((a, b) => a + b, 0) + widths.length + 1;
    expect(rendered).toBeLessThanOrEqual(80);
    expect(rendered).toBeGreaterThan(80 - widths.length);
  });

  test("measures wide CJK characters at two columns, not one", () => {
    const cjk = { header: [{ text: "描述" }, { text: "b" }], rows: [[{ text: "接口".repeat(30) }, { text: "2" }]] };
    expect(fitTableColumns(cjk, 80)).toBeDefined();
  });

  test("never returns a column narrower than the minimum", () => {
    const many = {
      header: Array.from({ length: 6 }, (_, i) => ({ text: `col${i}` })),
      rows: [Array.from({ length: 6 }, () => ({ text: "y".repeat(40) }))],
    };
    for (const width of fitTableColumns(many, 60)!) expect(width).toBeGreaterThanOrEqual(5);
  });

  test("gives up rather than emitting sub-minimum columns when the terminal is too narrow", () => {
    expect(fitTableColumns(token, 8)).toBeUndefined();
  });
});

describe("getMarkedForTerminal", () => {
  const section = [
    "## 8.2 Fetch Settings",
    "",
    "Body with **bold** text.",
    "",
    "| HTTP Status Code | Description |",
    "| --- | --- |",
    "| 500, 502, 503, 504 Server Errors | Something went wrong on the server during request processing. |",
    "| 200 OK | Everything worked as expected. |",
  ].join("\n");

  test("renders the heading text without its literal markdown '#' markers", async () => {
    const marked = await getMarkedForTerminal();
    const rendered = (await marked.parse(section)) as string;
    // eslint-disable-next-line no-control-regex
    const plain = rendered.replace(/\[[0-9;]*m/g, "");
    expect(plain).toContain("8.2 Fetch Settings");
    expect(plain).not.toContain("## 8.2");
  });

  test("keeps table borders within the terminal width so they do not soft-wrap", async () => {
    setTerminalWidth(80);
    const marked = await getMarkedForTerminal();
    const lines = borderedLines((await marked.parse(section)) as string);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(80);
  });

  test("re-fits tables when the terminal is resized between renders", async () => {
    const marked = await getMarkedForTerminal();
    setTerminalWidth(40);
    for (const line of borderedLines((await marked.parse(section)) as string)) {
      expect(stringWidth(line)).toBeLessThanOrEqual(40);
    }
    setTerminalWidth(120);
    const wide = borderedLines((await marked.parse(section)) as string);
    expect(Math.max(...wide.map(stringWidth))).toBeGreaterThan(40);
  });
});

describe("renderMarkdownPreview", () => {
  const listThenTable = [
    "1. Ensure your version is 1.9.1 or later.",
    "2. Safeguard your API Token.",
    "",
    "The steps above cover the basic process.",
    "",
    "| Code | Message |",
    "| --- | --- |",
    "| SUCCESS | Success |",
  ].join("\n");

  test("renders a table in the excerpt with box-drawing borders", async () => {
    const preview = stripAnsi(await renderMarkdownPreview(listThenTable, 6, 20));
    expect(preview).toContain("┌");
    expect(preview).toContain("│ SUCCESS │");
    expect(preview).not.toContain("| --- |");
  });

  test("keeps a trailing table out of the preceding list instead of absorbing it as continuation", async () => {
    const preview = stripAnsi(await renderMarkdownPreview(listThenTable, 6, 20));
    const border = preview.split("\n").find((line) => line.includes("┌"))!;
    expect(border.startsWith("┌")).toBe(true);
  });

  test("counts only non-blank lines toward the excerpt budget", async () => {
    const preview = stripAnsi(await renderMarkdownPreview(listThenTable, 3, 20));
    expect(preview).toContain("The steps above cover the basic process.");
    expect(preview).not.toContain("SUCCESS");
  });

  test("closes an excerpt that truncates inside a fenced code block", async () => {
    const body = ["intro", "", "```bash", "curl one", "curl two", "curl three"].join("\n");
    const preview = stripAnsi(await renderMarkdownPreview(body, 4, 20));
    expect(preview).toContain("curl one");
    expect(preview).not.toContain("```");
  });

  test("caps the rendered height and marks the truncation", async () => {
    const body = Array.from({ length: 30 }, (_, i) => `- item ${i}`).join("\n");
    const preview = await renderMarkdownPreview(body, 25, 6);
    expect(preview.split("\n")).toHaveLength(7);
    expect(preview.endsWith("…")).toBe(true);
  });

  test("returns an empty string for a section with no body", async () => {
    expect(await renderMarkdownPreview("", 6, 12)).toBe("");
    expect(await renderMarkdownPreview("\n\n   \n", 6, 12)).toBe("");
  });
});
