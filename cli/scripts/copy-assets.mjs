import {cpSync, existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assignAssets = join(root, "src", "lib", "assign", "assets");
const distAssignAssets = join(root, "dist", "lib", "assign", "assets");

if (existsSync(assignAssets)) {
    cpSync(assignAssets, distAssignAssets, {recursive: true});
}
