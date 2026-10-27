import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { decodeCursorProjectDirToCwd } from "./agents/cursor-gui.js";
import * as paths from "./paths.js";

const CHAT_PROJECT_HASH_RE = /^[a-f0-9]{32}$/i;

let chatProjectHashCache: Map<string, string> | null = null;

function buildChatProjectHashIndex(): Map<string, string> {
  const index = new Map<string, string>();
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(paths.cursorProjectsDir());
  } catch {
    return index;
  }

  for (const projectDir of projectDirs) {
    const cwd = decodeCursorProjectDirToCwd(projectDir);
    if (!cwd) continue;
    index.set(createHash("md5").update(cwd).digest("hex"), cwd);
  }
  return index;
}

/** Reset cached ~/.cursor/projects hash index (for tests). */
export function resetChatProjectHashCache(): void {
  chatProjectHashCache = null;
}

/**
 * Resolve ~/.cursor/chats/<md5> folder names to workspace paths.
 * Cursor names chat project directories with md5(workspacePath).
 */
export function resolveChatProjectHashToCwd(projectHash: string): string {
  const hash = projectHash.trim().toLowerCase();
  if (!CHAT_PROJECT_HASH_RE.test(hash)) return "";
  if (!chatProjectHashCache) chatProjectHashCache = buildChatProjectHashIndex();
  return chatProjectHashCache.get(hash) ?? "";
}

/**
 * Locate agent transcript JSONL under ~/.cursor/projects when the chats copy is absent.
 */
export function findProjectAgentTranscriptPath(convId: string): string | undefined {
  const projectsRoot = paths.cursorProjectsDir();
  const candidates = [join(projectsRoot, "agent-transcripts", convId, `${convId}.jsonl`)];

  try {
    for (const entry of readdirSync(projectsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      candidates.push(join(projectsRoot, entry.name, "agent-transcripts", convId, `${convId}.jsonl`));
    }
  } catch {
    // ignore unreadable projects root
  }

  return candidates.find((candidate) => existsSync(candidate));
}

/** Infer workspace cwd from a project agent-transcript file path. */
export function cwdFromProjectTranscriptPath(transcriptPath: string): string {
  const projectsRoot = paths.cursorProjectsDir();
  const rel = relative(projectsRoot, transcriptPath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return "";
  const projectDir = rel.split(sep)[0] ?? "";
  return decodeCursorProjectDirToCwd(projectDir);
}
