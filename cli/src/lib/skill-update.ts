import {spawn} from "node:child_process";

const SKILLS_ADD_ARGS = [
    "skills",
    "add",
    "cawcut/skill-cawplan",
    "-a",
    "cursor",
    "claude-code",
    "codex",
    "-g",
    "-y",
];

function npxCommand(): string {
    return process.platform === "win32" ? "npx.cmd" : "npx";
}

export function buildSkillsAddArgs(): string[] {
    return [...SKILLS_ADD_ARGS];
}

// "--yes" here answers npx's own "install the skills package?" prompt. It is
// separate from the trailing "-y" in buildSkillsAddArgs(), which answers the
// skills CLI's own prompts. Without it, npx can block forever reading stdin
// when run non-interactively (e.g. from an agent's shell).
export function buildNpxArgs(): string[] {
    return ["--yes", ...buildSkillsAddArgs()];
}

export function runSkillsAdd(): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(npxCommand(), buildNpxArgs(), {stdio: "inherit"});
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`npx skills add exited with code ${code ?? "unknown"}`));
        });
    });
}
