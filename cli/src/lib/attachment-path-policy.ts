import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Which local files the attachment commands may upload. Reference resolution
 * follows absolute paths, `../`, `file:` URLs and symlinks, so a document (or
 * an agent steered by one) could otherwise point at any file the user can read.
 *
 * - References in a document stay inside its base directory (real paths, so a
 *   symlink cannot step out) unless the caller explicitly allows it.
 * - Credential locations are never uploaded, whatever the source.
 */

/** Home-relative directories that hold credentials. */
const SENSITIVE_HOME_DIRS = [".ssh", ".aws", ".cawplan"];

/** Real path with symlinks and (on case-insensitive disks) case resolved; the plain path if it does not exist. */
function realOrResolved(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/** True when `p` is `root` or below it (both absolute). */
export function isWithin(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** True when the file's real path is inside the real path of `root`. */
export function isInsideBase(file: string, root: string): boolean {
  return isWithin(realOrResolved(root), realOrResolved(file));
}

function isEnvFile(name: string): boolean {
  const n = name.toLowerCase();
  return n === ".env" || n.startsWith(".env.");
}

/**
 * The credential location a file belongs to (e.g. `~/.ssh`, `.env`), or
 * undefined. Both the given path and its real path are checked, so neither a
 * symlink to a key nor a symlinked `~/.ssh` gets through.
 */
export function sensitivePathReason(file: string, home = os.homedir()): string | undefined {
  const paths = [path.resolve(file), realOrResolved(file)];
  for (const dir of SENSITIVE_HOME_DIRS) {
    const roots = [path.join(home, dir), realOrResolved(path.join(home, dir))];
    if (paths.some((p) => roots.some((r) => isWithin(r, p)))) return `~/${dir}`;
  }
  if (paths.some((p) => isEnvFile(path.basename(p)))) return ".env";
  return undefined;
}

export function sensitivePathMessage(reason: string): string {
  return `refused: credential file (${reason}) is never uploaded`;
}
