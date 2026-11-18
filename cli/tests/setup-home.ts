import {mkdirSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll} from "vitest";

// Every test file gets a throwaway home directory so tests never read or
// write the developer's real ~/.cawplan, ~/.claude, ~/.codex or ~/.cursor,
// and behave the same locally, in CI and on Windows (os.homedir() reads
// USERPROFILE there). Runs before the test file is imported, so module-level
// homedir() lookups see the temp directory too.
const home = mkdtempSync(join(tmpdir(), "cawplan-test-home-"));
mkdirSync(join(home, ".claude", "projects"), {recursive: true});
process.env.HOME = home;
process.env.USERPROFILE = home;
// Windows Cursor collection reads %APPDATA%/Cursor/User/globalStorage/state.vscdb.
process.env.APPDATA = join(home, "AppData", "Roaming");
process.env.LOCALAPPDATA = join(home, "AppData", "Local");

// Agent session and home overrides leak in when tests run inside Claude Code,
// Codex or Cursor and change which session or directory the code under test sees.
for (const name of [
    "CLAUDE_CODE_SESSION_ID",
    "CODEX_SESSION_ID",
    "CODEX_THREAD_ID",
    "CLAUDE_HOME",
    "CODEX_HOME",
    "CURSOR_HOME",
    "COPILOT_HOME",
    "CAWPLAN_CREDENTIALS_PATH",
    "CAWPLAN_CONFIG_PATH",
    "CAWPLAN_CACHE_PATH",
    "CAWPLAN_SKILLS_DIRS",
    "CAWPLAN_TESTPOINT_REVIEW_PATH",
    "CAWPLAN_QA_HUMAN_INPUT_OUTBOX_DIR",
]) {
    delete process.env[name];
}

afterAll(() => {
    rmSync(home, {recursive: true, force: true});
});
