import { execFileSync, execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

export function gitAuthor(): string {
  try {
    const email = execSync("git config user.email", { encoding: "utf-8" }).trim();
    return email.split("@")[0];
  } catch {
    return process.env.USER ?? "unknown";
  }
}

export function gitUserEmail(): string {
  try {
    return execSync("git config user.email", { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

/**
 * Get git remote owner/repo from a working directory.
 * Returns "owner/repo" from the origin URL, or the cwd path as fallback.
 */
export function gitRemoteRepo(cwd: string): string {
  if (!cwd) return "";
  try {
    const url = execSync("git remote get-url origin", {
      encoding: "utf-8",
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    // Parse SSH: git@github.com:owner/repo.git  or  https://github.com/owner/repo.git
    const sshMatch = url.match(/:([^/:]+\/[^/]+?)(?:\.git)?$/);
    if (sshMatch) return sshMatch[1];
    const httpsMatch = url.match(/\/([^/]+\/[^/]+?)(?:\.git)?$/);
    if (httpsMatch) return httpsMatch[1];
    return url;
  } catch {
    return cwd;
  }
}

/** Walk up from an absolute file path to the nearest directory containing `.git`. */
export function inferGitRootFromPath(filePath: string | null | undefined): string {
  if (!filePath || !isAbsolute(filePath)) return "";
  let current = filePath;
  try {
    if (existsSync(current) && !statSync(current).isDirectory()) {
      current = dirname(current);
    }
  } catch {
    // Continue by walking parent paths; the target file may not exist yet.
  }
  while (current && current !== dirname(current)) {
    if (existsSync(join(current, ".git"))) return current;
    current = dirname(current);
  }
  return "";
}

/**
 * Resolve the repo a file belongs to from its own git root, falling back to the
 * session cwd for relative paths or files outside any checkout.
 */
export function gitRemoteRepoForFile(sessionCwd: string, filePath: string): string {
  return gitRemoteRepo(inferGitRootFromPath(filePath) || sessionCwd);
}

function parseNumstatLine(line: string): { added: number; deleted: number } {
  const parts = line.trim().split("\t");
  if (parts.length < 2) return { added: 0, deleted: 0 };
  const added = Number.parseInt(parts[0], 10);
  const deleted = Number.parseInt(parts[1], 10);
  return {
    added: Number.isFinite(added) ? added : 0,
    deleted: Number.isFinite(deleted) ? deleted : 0,
  };
}

function toRepoRelativePath(cwd: string, filePath: string): { repoRoot: string; relPath: string } | null {
  try {
    const repoRoot = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!repoRoot) return null;
    const relPath = filePath.startsWith("/")
      ? relative(repoRoot, filePath)
      : filePath;
    return { repoRoot, relPath };
  } catch {
    return null;
  }
}

export function gitFileNumstat(cwd: string, filePath: string): { added: number; deleted: number } {
  if (!cwd || !filePath) return { added: 0, deleted: 0 };
  const resolved = toRepoRelativePath(cwd, filePath);
  if (!resolved) return { added: 0, deleted: 0 };
  const { repoRoot, relPath } = resolved;
  if (!relPath || relPath.startsWith("..")) return { added: 0, deleted: 0 };

  let added = 0;
  let deleted = 0;
  for (const args of [
    ["diff", "--numstat", "HEAD", "--", relPath],
    ["diff", "--cached", "--numstat", "--", relPath],
  ]) {
    try {
      const out = execFileSync("git", args, {
        encoding: "utf-8",
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (!out) continue;
      const stat = parseNumstatLine(out.split("\n")[0]);
      added += stat.added;
      deleted += stat.deleted;
    } catch {
      // ignore
    }
  }

  return { added, deleted };
}
