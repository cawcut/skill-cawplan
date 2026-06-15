import { homedir } from "node:os";
import { join } from "node:path";

export function cursorHome(): string {
  return process.env.CURSOR_HOME ?? join(homedir(), ".cursor");
}

export function cursorChatsDir(): string {
  return join(cursorHome(), "chats");
}

export function cursorProjectsDir(): string {
  return join(cursorHome(), "projects");
}

export function claudeHome(): string {
  return process.env.CLAUDE_HOME ?? join(homedir(), ".claude");
}

export function claudeProjectsDir(): string {
  return join(claudeHome(), "projects");
}

export function claudeFileHistoryDir(): string {
  return join(claudeHome(), "file-history");
}

export function codexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

export function codexStateDb(): string {
  return join(codexHome(), "state_5.sqlite");
}

export function codexSessionsDir(): string {
  return join(codexHome(), "sessions");
}

export function cursorStateDbCandidates(): string[] {
  return [
    join(homedir(), "Library/Application Support/Cursor/User/globalStorage/state.vscdb"),
    join(homedir(), ".config/Cursor/User/globalStorage/state.vscdb"),
    join(process.env.APPDATA ?? "", "Cursor/User/globalStorage/state.vscdb"),
  ];
}
