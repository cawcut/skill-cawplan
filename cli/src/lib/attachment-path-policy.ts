import { constants, existsSync, realpathSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Which local files the attachment commands may upload. Reference resolution
 * follows absolute paths, `../`, `file:` URLs and symlinks, so a document (or
 * an agent steered by one) could otherwise point at any file the user can read.
 *
 * - References in a document stay inside its base directory (real paths, so a
 *   symlink cannot step out) unless the caller explicitly allows it.
 * - Explicit paths (--file, --dir, --md-file, ...) stay inside the current
 *   directory (or its git repository) unless the caller explicitly allows it.
 *   A workspace that is $HOME or above it confines nothing, so it counts as none.
 * - Credential locations are never uploaded, whatever the source.
 */

/** Browser profiles (cookies, saved passwords, session tokens), macOS / Linux / Windows. */
const BROWSER_PROFILE_DIRS = [
  ...["Google/Chrome", "Chromium", "BraveSoftware", "Microsoft Edge", "Firefox", "Arc", "Vivaldi", "com.operasoftware.Opera"]
    .map((d) => path.join("Library", "Application Support", d)),
  path.join("Library", "Safari"), path.join("Library", "Cookies"), path.join("Library", "Containers", "com.apple.Safari"),
  ...["google-chrome", "chromium", "BraveSoftware", "microsoft-edge", "vivaldi", "opera"].map((d) => path.join(".config", d)),
  ".mozilla", path.join("snap", "firefox"), path.join("snap", "chromium"),
  ...["Google/Chrome", "Chromium", "BraveSoftware", "Microsoft/Edge"].map((d) => path.join("AppData", "Local", d)),
  path.join("AppData", "Roaming", "Mozilla"),
];

/** Home-relative directories that hold credentials. */
const SENSITIVE_HOME_DIRS = [
  ".ssh", ".aws", ".cawplan", ".gnupg", ".kube", ".azure", ".op", ".terraform.d", ".zsh_sessions",
  path.join(".config", "gh"), path.join(".config", "gcloud"), path.join(".config", "op"),
  path.join("Library", "Keychains"),
  ...BROWSER_PROFILE_DIRS,
].map((d) => d.split("/").join(path.sep));

/** Home-relative files that hold credentials. */
const SENSITIVE_HOME_FILES = [
  path.join(".docker", "config.json"),
  path.join(".claude", ".credentials.json"),
  path.join(".codex", "auth.json"),
];

/** Credential file names refused wherever they are (lower case). */
const SENSITIVE_NAMES = [
  ".netrc", "_netrc", ".git-credentials", ".npmrc", ".pypirc", ".envrc", ".vault-token", ".pgpass",
  // Browser cookie / password stores, wherever a profile was copied to.
  "cookies", "cookies.sqlite", "cookies.binarycookies", "login data", "web data", "key3.db", "key4.db", "logins.json",
];

/** Credential file extensions refused wherever they are. */
const SENSITIVE_EXTS = [".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".ppk", ".kdbx", ".keychain", ".keychain-db"];

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

/** The credential class a file name belongs to (`.env`, `*.pem`, `id_*` private key, ...), or undefined. */
function sensitiveNameReason(name: string): string | undefined {
  const n = name.toLowerCase();
  if (n === ".env" || n.startsWith(".env.")) return ".env";
  if (SENSITIVE_NAMES.includes(n)) return n;
  const ext = SENSITIVE_EXTS.find((e) => n.endsWith(e));
  if (ext) return `*${ext}`;
  // Shell / REPL histories (.zsh_history, .bash_history, .psql_history, fish_history, .history).
  if (n === ".history" || n.endsWith("_history")) return "shell history";
  // SSH private keys: id_rsa, id_foo, github_rsa, id_ed25519.bak, ... Only the .pub halves are public.
  if (n.endsWith(".pub")) return undefined;
  if (/^id_[a-z0-9_-]+$/.test(n)) return "id_* private key";
  if (/(?:^id|_)(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?(?:[.~-].*)?$/.test(n)) return "SSH private key";
  if (/^ssh_host_[a-z0-9_]*key$/.test(n)) return "SSH host key";
  return undefined;
}

/**
 * The credential location a file belongs to (e.g. `~/.ssh`, `.env`), or
 * undefined. Both the given path and its real path are checked, so neither a
 * symlink to a key nor a symlinked `~/.ssh` gets through.
 */
export function sensitivePathReason(file: string, home = os.homedir()): string | undefined {
  const paths = [path.resolve(file), realOrResolved(file)];
  for (const entry of [...SENSITIVE_HOME_DIRS, ...SENSITIVE_HOME_FILES]) {
    const roots = [path.join(home, entry), realOrResolved(path.join(home, entry))];
    if (paths.some((p) => roots.some((r) => isWithin(r, p)))) return `~/${entry.split(path.sep).join("/")}`;
  }
  for (const p of paths) {
    const reason = sensitiveNameReason(path.basename(p));
    if (reason) return reason;
  }
  return undefined;
}

export function sensitivePathMessage(reason: string): string {
  return `refused: credential file (${reason}) is never uploaded`;
}

/**
 * The git repository containing `cwd` (real path), or `cwd` itself outside a
 * repository. A repository at $HOME or above it (a dotfiles repo) is not a
 * workspace: below it the current directory is used instead.
 */
export function workspaceRoot(cwd = process.cwd(), home = os.homedir()): string {
  const real = realOrResolved(cwd);
  const realHome = realOrResolved(home);
  for (let dir = real; ; dir = path.dirname(dir)) {
    if (isWithin(dir, realHome)) return real;
    if (existsSync(path.join(dir, ".git"))) return dir;
    if (path.dirname(dir) === dir) return real;
  }
}

export function outsideWorkspaceMessage(root: string): string {
  return `refused: outside the current directory or git repository (${root}); pass --allow-outside-cwd to upload it`;
}

export function broadWorkspaceMessage(root: string): string {
  return (
    `refused: the current directory or git repository (${root}) is your home directory or above it, ` +
    "which confines nothing; run from a project directory or pass --allow-outside-cwd to upload it"
  );
}

/**
 * Temp directories the CLI itself hands out (`cawplan session temp-dir` and
 * the QA report dir, see resolveReportTempDir in commands/session.ts), so
 * skills that stage files there keep working from any directory.
 */
function cliTempDirs(): string[] {
  return ["cawplan-ai-daily", "cawplan-qa-daily"].map((d) => realOrResolved(path.join(os.tmpdir(), d)));
}

/** Where explicit local paths may be uploaded from without --allow-outside-cwd. */
export interface UploadScope {
  /** Real path of the current directory's git repository, or of the current directory. */
  workspace: string;
  /** The workspace is $HOME, an ancestor of it or the filesystem root, so only the CLI temp dirs are allowed. */
  tooBroad: boolean;
  /** Real paths uploads may come from. */
  roots: string[];
}

export function uploadScope(cwd = process.cwd(), home = os.homedir()): UploadScope {
  const workspace = workspaceRoot(cwd, home);
  const tooBroad = path.dirname(workspace) === workspace || isWithin(workspace, realOrResolved(home));
  return { workspace, tooBroad, roots: [...(tooBroad ? [] : [workspace]), ...cliTempDirs()] };
}

/** Why a file (any path; its real path is checked) may not be uploaded from `scope`, or undefined. */
export function outsideScopeMessage(file: string, scope: UploadScope): string | undefined {
  const real = realOrResolved(file);
  if (scope.roots.some((r) => isWithin(r, real))) return undefined;
  return scope.tooBroad ? broadWorkspaceMessage(scope.workspace) : outsideWorkspaceMessage(scope.workspace);
}

/**
 * Why an explicit local path may not be uploaded, or undefined: credential
 * locations always; paths outside `scope` unless no scope is given
 * (--allow-outside-cwd).
 */
export function uploadPathRefusal(file: string, scope: UploadScope | undefined): string | undefined {
  const sensitive = sensitivePathReason(file);
  if (sensitive) return sensitivePathMessage(sensitive);
  return scope ? outsideScopeMessage(file, scope) : undefined;
}

export interface OpenedUploadFile {
  /** Open read-only handle; the caller closes it. */
  handle: FileHandle;
  /** The real path that was checked and opened. */
  realPath: string;
  bytes: number;
}

/**
 * Open a local file for upload after checking it against the policy. The
 * real path is resolved once, checked, and opened without following a final
 * symlink; the caller then reads from the handle, so swapping the path for a
 * symlink after the check cannot change which file is sent.
 */
export async function openUploadFile(file: string, scope: UploadScope | undefined): Promise<OpenedUploadFile> {
  const realPath = realpathSync.native(file);
  const refusal = uploadPathRefusal(file, scope) ?? uploadPathRefusal(realPath, scope);
  if (refusal) throw new Error(refusal);
  const handle = await open(realPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("not a regular file");
    return { handle, realPath, bytes: info.size };
  } catch (err) {
    await handle.close();
    throw err;
  }
}

/** Read a whole local file for upload (see openUploadFile). */
export async function readUploadFile(file: string, scope: UploadScope | undefined): Promise<Buffer> {
  const { handle } = await openUploadFile(file, scope);
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
