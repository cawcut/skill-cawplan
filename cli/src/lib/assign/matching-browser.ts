import {existsSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

export function readMatchingBrowserModule(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
        join(here, "matching-core.js"),
        join(here, "..", "..", "..", "dist", "lib", "assign", "matching-core.js"),
    ];
    for (const path of candidates) {
        if (existsSync(path)) return readFileSync(path, "utf8");
    }
    throw new Error("matching-core.js not found; run npm run build in cli/");
}
