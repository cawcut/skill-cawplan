import { writeFileSync, renameSync, fsyncSync, openSync, closeSync } from "node:fs";
import { dirname, basename, join } from "node:path";

/**
 * Writes `contents` to `filePath` without ever leaving a half-written file in place:
 * write to a temp file in the same directory, fsync it, then rename over the real
 * path. Rename on the same filesystem is atomic, so `filePath` is always either the
 * old complete version or the new complete version — never a partial write.
 */
export function atomicWriteFileSync(filePath: string, contents: string): void {
  const dir = dirname(filePath);
  const tempPath = join(dir, `.${basename(filePath)}.tmp-${process.pid}-${Date.now()}`);

  const fd = openSync(tempPath, "w");
  try {
    writeFileSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  renameSync(tempPath, filePath);
}
