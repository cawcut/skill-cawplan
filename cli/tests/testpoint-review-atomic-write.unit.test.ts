import {afterEach, beforeEach, describe, expect, test} from "vitest";
import {mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {atomicWriteFileSync} from "../src/lib/testpoint-review/atomic-write.js";

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "atomic-write-test-"));
});

afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
});

describe("atomicWriteFileSync", () => {
    test("writes new content that can be read back", () => {
        const filePath = join(dir, "data.json");
        atomicWriteFileSync(filePath, JSON.stringify({hello: "world"}));
        expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({hello: "world"});
    });

    test("replaces existing content instead of appending", () => {
        const filePath = join(dir, "data.json");
        writeFileSync(filePath, JSON.stringify({version: "old"}));
        atomicWriteFileSync(filePath, JSON.stringify({version: "new"}));
        expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({version: "new"});
    });

    test("leaves no temp file behind in the target directory", () => {
        const filePath = join(dir, "data.json");
        atomicWriteFileSync(filePath, "content");
        const entries = readdirSync(dir);
        expect(entries).toEqual(["data.json"]);
    });
});
