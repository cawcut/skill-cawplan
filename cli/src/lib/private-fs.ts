import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

/** Only the CLI's own state dir is force-tightened; a user-supplied custom path's parent is left alone. */
function isCliStateDir(dir: string): boolean {
  return resolve(dir) === resolve(homedir(), ".cawplan");
}

/** Creates `dir` as 0700 and tightens an existing ~/.cawplan left at a looser mode by older versions. */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  if (process.platform !== "win32" && isCliStateDir(dir)) await chmod(dir, PRIVATE_DIR_MODE);
}

export function ensurePrivateDirSync(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  if (process.platform !== "win32" && isCliStateDir(dir)) chmodSync(dir, PRIVATE_DIR_MODE);
}

/** Tightens an existing private file (and ~/.cawplan) left at looser modes by older versions. Best effort. */
export function tightenPrivateFileSync(file: string, dir: string): void {
  if (process.platform === "win32" || !existsSync(file)) return;
  try {
    if (isCliStateDir(dir)) chmodSync(dir, PRIVATE_DIR_MODE);
    chmodSync(file, PRIVATE_FILE_MODE);
  } catch {
    // A file we cannot chmod (not ours) is still readable by us; do not fail the read.
  }
}
