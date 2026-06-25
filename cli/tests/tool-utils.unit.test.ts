import {describe, expect, test} from "vitest";
import {
    countLines,
    countDiffLines,
    parsePatchDeltas,
    extractPathFromInput,
    estimateToolDeltas,
} from "../src/lib/collect/aggregators/tool-utils";

describe("countLines", () => {
    test("counts lines in a normal string", () => {
        expect(countLines("a\nb\nc")).toBe(3);
    });
    test("returns 0 for empty string", () => {
        expect(countLines("")).toBe(0);
    });
    test("returns 0 for null", () => {
        expect(countLines(null)).toBe(0);
    });
    test("returns 0 for undefined", () => {
        expect(countLines(undefined)).toBe(0);
    });
    test("returns 0 for non-string", () => {
        expect(countLines(42)).toBe(0);
    });
    test("single line with no newlines", () => {
        expect(countLines("hello")).toBe(1);
    });
});

describe("countDiffLines", () => {
    test("counts added and deleted lines", () => {
        expect(countDiffLines("+added\n-deleted\n context")).toEqual({added: 1, deleted: 1});
    });
    test("skips +++ and --- header lines", () => {
        expect(countDiffLines("+++ file.ts\n--- file.ts\n+real")).toEqual({added: 1, deleted: 0});
    });
    test("empty diff", () => {
        expect(countDiffLines("")).toEqual({added: 0, deleted: 0});
    });
});

describe("parsePatchDeltas", () => {
    test("parses a single file", () => {
        const patch = "*** Update File: src/foo.ts\n+added\n-deleted\n context";
        expect(parsePatchDeltas(patch)).toEqual([{path: "src/foo.ts", added: 1, deleted: 1}]);
    });
    test("parses multiple files", () => {
        const patch = "*** Add File: a.ts\n+line\n*** Update File: b.ts\n-old\n+new";
        const result = parsePatchDeltas(patch);
        expect(result).toHaveLength(2);
        expect(result[0].path).toBe("a.ts");
        expect(result[1].path).toBe("b.ts");
    });
    test("includes Delete File operations", () => {
        const patch = "*** Delete File: old.ts\n-line1\n-line2";
        expect(parsePatchDeltas(patch)).toEqual([{path: "old.ts", added: 0, deleted: 2}]);
    });
    test("filters out zero-delta entries", () => {
        const patch = "*** Update File: unchanged.ts\n context only\n*** Add File: new.ts\n+added";
        const result = parsePatchDeltas(patch);
        expect(result).toHaveLength(1);
        expect(result[0].path).toBe("new.ts");
    });
});

describe("extractPathFromInput", () => {
    test("extracts path key", () => {
        expect(extractPathFromInput({path: "foo.ts"})).toBe("foo.ts");
    });
    test("extracts file_path key", () => {
        expect(extractPathFromInput({file_path: "bar.ts"})).toBe("bar.ts");
    });
    test("extracts target_file key", () => {
        expect(extractPathFromInput({target_file: "baz.ts"})).toBe("baz.ts");
    });
    test("extracts target_notebook key", () => {
        expect(extractPathFromInput({target_notebook: "nb.ipynb"})).toBe("nb.ipynb");
    });
    test("returns null when no path key present", () => {
        expect(extractPathFromInput({})).toBeNull();
    });
    test("returns null for blank string values", () => {
        expect(extractPathFromInput({path: "  "})).toBeNull();
    });
    test("path key takes priority over file_path", () => {
        expect(extractPathFromInput({path: "first.ts", file_path: "second.ts"})).toBe("first.ts");
    });
});

describe("estimateToolDeltas", () => {
    test("Edit tool", () => {
        const result = estimateToolDeltas("Edit", {
            file_path: "src/a.ts",
            old_string: "old\nold",
            new_string: "new\nnew\nnew",
        });
        expect(result).toEqual([{path: "src/a.ts", added: 3, deleted: 2}]);
    });
    test("StrReplace tool (PascalCase)", () => {
        const result = estimateToolDeltas("StrReplace", {
            path: "b.ts",
            old_string: "x",
            new_string: "y\nz",
        });
        expect(result).toEqual([{path: "b.ts", added: 2, deleted: 1}]);
    });
    test("Write tool with content key", () => {
        const result = estimateToolDeltas("Write", {path: "c.ts", content: "a\nb\nc"});
        expect(result).toEqual([{path: "c.ts", added: 3, deleted: 0}]);
    });
    test("Write tool with contents key", () => {
        const result = estimateToolDeltas("write", {path: "c.ts", contents: "a\nb"});
        expect(result).toEqual([{path: "c.ts", added: 2, deleted: 0}]);
    });
    test("Delete tool", () => {
        const result = estimateToolDeltas("Delete", {path: "old.ts"});
        expect(result).toEqual([{path: "old.ts", added: 0, deleted: 1}]);
    });
    test("MultiEdit tool aggregates edits", () => {
        const result = estimateToolDeltas("MultiEdit", {
            edits: [
                {path: "d.ts", old_string: "a\nb", new_string: "c"},
                {path: "d.ts", old_string: "x", new_string: "y\nz\nw"},
            ],
        });
        expect(result).toEqual([{path: "d.ts", added: 4, deleted: 3}]);
    });
    test("ApplyPatch tool", () => {
        const result = estimateToolDeltas("ApplyPatch", {
            patch: "*** Update File: e.ts\n+added",
        });
        expect(result).toEqual([{path: "e.ts", added: 1, deleted: 0}]);
    });
    test("unknown tool returns empty array", () => {
        expect(estimateToolDeltas("Bash", {path: "f.ts"})).toEqual([]);
    });
    test("no path returns empty array for Edit", () => {
        expect(estimateToolDeltas("Edit", {old_string: "a", new_string: "b"})).toEqual([]);
    });
    test("case-insensitive tool name matching", () => {
        const upper = estimateToolDeltas("WRITE", {path: "g.ts", content: "x"});
        const lower = estimateToolDeltas("write", {path: "g.ts", content: "x"});
        expect(upper).toEqual(lower);
    });
});
