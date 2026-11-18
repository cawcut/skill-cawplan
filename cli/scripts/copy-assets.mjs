import {chmodSync, cpSync, existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assignAssets = join(root, "src", "lib", "assign", "assets");
const distAssignAssets = join(root, "dist", "lib", "assign", "assets");

// Replaces `chmod +x` in the postbuild script, which cmd.exe cannot run.
// npm generates its own .cmd shim on Windows, where the mode bit is ignored.
chmodSync(join(root, "dist", "index.js"), 0o755);

if (existsSync(assignAssets)) {
    cpSync(assignAssets, distAssignAssets, {recursive: true});
}
