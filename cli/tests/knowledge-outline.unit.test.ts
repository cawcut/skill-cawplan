import { describe, expect, test } from "vitest";
import {
  buildOutlineWithPreview,
  extractSection,
  findHeadings,
  firstNonBlankLines,
  flattenOutline,
  parseMarkdownOutline,
} from "../src/lib/knowledge/outline.js";

describe("parseMarkdownOutline", () => {
  test("returns an empty tree for content with no headings", () => {
    expect(parseMarkdownOutline("just some text\nmore text")).toEqual([]);
  });

  test("nests headings by level", () => {
    const content = ["# Title", "intro", "## Section A", "body a", "### Sub A.1", "## Section B", "body b"].join("\n");
    const tree = parseMarkdownOutline(content);

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ level: 1, title: "Title", line: 1 });
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0]).toMatchObject({ level: 2, title: "Section A", line: 3 });
    expect(tree[0].children[0].children).toEqual([{ level: 3, title: "Sub A.1", line: 5, children: [] }]);
    expect(tree[0].children[1]).toMatchObject({ level: 2, title: "Section B", line: 6 });
  });

  test("treats a heading that skips levels as nested under the nearest shallower heading", () => {
    const content = ["# Title", "### Deep", "text"].join("\n");
    const tree = parseMarkdownOutline(content);

    expect(tree).toHaveLength(1);
    expect(tree[0].children).toEqual([{ level: 3, title: "Deep", line: 2, children: [] }]);
  });

  test("starts a new root when a heading is followed by a shallower or equal-level heading", () => {
    const content = ["## Orphan A", "## Orphan B"].join("\n");
    const tree = parseMarkdownOutline(content);

    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.title)).toEqual(["Orphan A", "Orphan B"]);
  });

  test("ignores non-heading lines including lines with a leading # inside a word", () => {
    const content = ["#nothashheading", "text with # in it", "# Real Heading"].join("\n");
    expect(parseMarkdownOutline(content)).toEqual([{ level: 1, title: "Real Heading", line: 3, children: [] }]);
  });

  test("ignores #-prefixed lines inside a fenced code block, e.g. shell comments in a curl example", () => {
    const content = [
      "# Real Heading",
      "```bash",
      "# fetch users through keyword",
      "curl -XGET '{{host}}/api/v1/developer/users?keyword=H'",
      "```",
      "## Next Heading",
    ].join("\n");

    const tree = parseMarkdownOutline(content);
    expect(tree).toHaveLength(1);
    expect(tree[0].title).toBe("Real Heading");
    expect(tree[0].children).toEqual([{ level: 2, title: "Next Heading", line: 6, children: [] }]);
  });

  test("handles an unclosed fence by treating everything after it as still fenced", () => {
    const content = ["# Real Heading", "```bash", "# not a heading"].join("\n");
    expect(parseMarkdownOutline(content)).toEqual([{ level: 1, title: "Real Heading", line: 1, children: [] }]);
  });
});

describe("flattenOutline", () => {
  test("flattens in document order with depth annotations", () => {
    const content = ["# Title", "## Section A", "### Sub A.1", "## Section B"].join("\n");
    const flat = flattenOutline(parseMarkdownOutline(content));

    expect(flat.map((n) => [n.title, n.depth])).toEqual([
      ["Title", 0],
      ["Section A", 1],
      ["Sub A.1", 2],
      ["Section B", 1],
    ]);
  });
});

describe("extractSection", () => {
  test("extracts up to the next heading at the same or shallower level", () => {
    const content = ["# Title", "## Section A", "line a1", "line a2", "## Section B", "line b1"].join("\n");
    const flat = flattenOutline(parseMarkdownOutline(content));
    const sectionA = flat.find((n) => n.title === "Section A")!;

    expect(extractSection(content, flat, sectionA)).toBe(["## Section A", "line a1", "line a2"].join("\n"));
  });

  test("includes deeper nested subsections within a section's own extract", () => {
    const content = ["# Title", "## Section A", "### Sub A.1", "sub text", "## Section B"].join("\n");
    const flat = flattenOutline(parseMarkdownOutline(content));
    const sectionA = flat.find((n) => n.title === "Section A")!;

    expect(extractSection(content, flat, sectionA)).toBe(["## Section A", "### Sub A.1", "sub text"].join("\n"));
  });

  test("extracts to end of document when it's the last heading", () => {
    const content = ["# Title", "## Section A", "## Section B", "tail line 1", "tail line 2"].join("\n");
    const flat = flattenOutline(parseMarkdownOutline(content));
    const sectionB = flat.find((n) => n.title === "Section B")!;

    expect(extractSection(content, flat, sectionB)).toBe(["## Section B", "tail line 1", "tail line 2"].join("\n"));
  });
});

describe("findHeadings", () => {
  test("matches by case-insensitive substring, in document order", () => {
    const content = ["# Title", "## Fetch NFC Card", "## Update NFC Card", "## Fetch User"].join("\n");
    const flat = flattenOutline(parseMarkdownOutline(content));

    expect(findHeadings(flat, "nfc card").map((n) => n.title)).toEqual(["Fetch NFC Card", "Update NFC Card"]);
    expect(findHeadings(flat, "FETCH").map((n) => n.title)).toEqual(["Fetch NFC Card", "Fetch User"]);
  });

  test("returns an empty array when nothing matches or the query is blank", () => {
    const content = ["# Title", "## Section A"].join("\n");
    const flat = flattenOutline(parseMarkdownOutline(content));

    expect(findHeadings(flat, "no such heading")).toEqual([]);
    expect(findHeadings(flat, "  ")).toEqual([]);
  });
});

describe("buildOutlineWithPreview", () => {
  test("preserves the nested tree shape and adds a preview per node", () => {
    const content = [
      "# Title",
      "## Section A",
      "line a1",
      "",
      "line a2",
      "line a3",
      "line a4",
      "line a5",
      "## Section B",
      "line b1",
    ].join("\n");

    const tree = buildOutlineWithPreview(content, 3);

    expect(tree).toHaveLength(1);
    expect(tree[0].title).toBe("Title");
    expect(tree[0].children.map((n) => n.title)).toEqual(["Section A", "Section B"]);

    const sectionA = tree[0].children[0];
    expect(sectionA.preview).toBe(["line a1", "line a2", "line a3"].join("\n"));

    const sectionB = tree[0].children[1];
    expect(sectionB.preview).toBe("line b1");
  });

  test("skips blank lines when collecting preview lines", () => {
    const content = ["## Section A", "", "", "first real line", "", "second real line"].join("\n");
    const tree = buildOutlineWithPreview(content, 2);

    expect(tree[0].preview).toBe(["first real line", "second real line"].join("\n"));
  });

  test("returns an empty preview for a heading with no body", () => {
    const content = ["## Empty Section", "## Next Section", "text"].join("\n");
    const tree = buildOutlineWithPreview(content);

    expect(tree[0].preview).toBe("");
  });
});

describe("firstNonBlankLines", () => {
  test("returns the first N non-blank lines, joined and trimmed", () => {
    const content = ["line 1", "line 2", "line 3", "line 4"].join("\n");
    expect(firstNonBlankLines(content, 2)).toBe(["line 1", "line 2"].join("\n"));
  });

  test("skips blank lines when collecting", () => {
    const content = ["", "  ", "first real line", "", "second real line", "third real line"].join("\n");
    expect(firstNonBlankLines(content, 2)).toBe(["first real line", "second real line"].join("\n"));
  });

  test("returns an empty string when there are no non-blank lines", () => {
    expect(firstNonBlankLines(["", "  ", ""].join("\n"), 4)).toBe("");
  });
});
