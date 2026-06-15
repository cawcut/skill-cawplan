import { execSync } from "node:child_process";

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
