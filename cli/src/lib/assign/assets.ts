import {existsSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

/** Physical icon files live only here; qa-assign serves the same files via its own route. */
export const assetNames = new Set(["model-gpt.png", "model-claude.png", "model-cursor.png", "model-deepseek.svg"]);

export function readAssignmentAsset(name: string): Buffer | null {
    if (!assetNames.has(name)) return null;
    const here = dirname(fileURLToPath(import.meta.url));
    for (const path of [
        join(here, "assets", name),
        join(here, "..", "..", "..", "src", "lib", "assign", "assets", name),
    ]) {
        if (existsSync(path)) return readFileSync(path);
    }
    return null;
}

export function assignmentAssetContentType(name: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith(".svg")) return "image/svg+xml";
    if (lower.endsWith(".png")) return "image/png";
    return "application/octet-stream";
}
