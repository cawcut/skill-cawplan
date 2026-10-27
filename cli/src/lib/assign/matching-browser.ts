import {existsSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

export function readMatchingBrowserModule(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    const compiledPath = join(here, "matching-core.js");
    const distCompiledPath = join(here, "..", "..", "..", "dist", "lib", "assign", "matching-core.js");

    for (const path of [compiledPath, distCompiledPath]) {
        if (existsSync(path)) return readFileSync(path, "utf8");
    }

    throw new Error("matching-core module not found; run npm run build in cli/");
}
