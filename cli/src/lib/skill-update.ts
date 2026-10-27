import {spawn} from "node:child_process";

export const SKILLS_SOURCE = "cawcut/skill-cawplan";

const SKILLS_ADD_ARGS = [
    "skills",
    "add",
    SKILLS_SOURCE,
    "-a",
    "cursor",
    "claude-code",
    "codex",
];

const GLOBAL_YES_ARGS = ["-g", "-y"];

function npxCommand(): string {
    return process.platform === "win32" ? "npx.cmd" : "npx";
}

// Without skills the skills CLI installs every skill in the repo.
export function buildSkillsAddArgs(skills: string[] = []): string[] {
    const skillArgs = skills.length > 0 ? ["-s", ...skills] : [];
    return [...SKILLS_ADD_ARGS, ...skillArgs, ...GLOBAL_YES_ARGS];
}

export function buildSkillsRemoveArgs(skills: string[]): string[] {
    return ["skills", "remove", ...skills, ...GLOBAL_YES_ARGS];
}

export function buildSkillsListArgs(): string[] {
    return ["skills", "list", "-g", "--json"];
}

// "--yes" here answers npx's own "install the skills package?" prompt. It is
// separate from the trailing "-y" in buildSkillsAddArgs(), which answers the
// skills CLI's own prompts. Without it, npx can block forever reading stdin
// when run non-interactively (e.g. from an agent's shell).
export function buildNpxArgs(skillsArgs: string[] = buildSkillsAddArgs()): string[] {
    return ["--yes", ...skillsArgs];
}

function runNpx(skillsArgs: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(npxCommand(), buildNpxArgs(skillsArgs), {stdio: "inherit"});
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`npx ${skillsArgs.slice(0, 2).join(" ")} exited with code ${code ?? "unknown"}`));
        });
    });
}

export function runSkillsAdd(skills: string[] = []): Promise<void> {
    return runNpx(buildSkillsAddArgs(skills));
}

export function runSkillsRemove(skills: string[]): Promise<void> {
    return runNpx(buildSkillsRemoveArgs(skills));
}

interface InstalledSkill {
    name?: string;
    source?: string | null;
}

export function parseInstalledSkills(stdout: string): string[] {
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as InstalledSkill[])
        // SSH installs record the source as git@github.com:cawcut/skill-cawplan.git.
        .filter((skill) => typeof skill?.source === "string" && skill.source.includes(SKILLS_SOURCE))
        .filter((skill) => typeof skill.name === "string")
        .map((skill) => skill.name as string);
}

// Global skills installed from this repo. Locally authored skills that merely
// share the cawplan- prefix have no source and are left alone.
export function listInstalledSkills(): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const child = spawn(npxCommand(), buildNpxArgs(buildSkillsListArgs()), {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        // The skills CLI warns about every unparsable local SKILL.md; only surface that on failure.
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code !== 0) {
                if (stderr) process.stderr.write(stderr);
                reject(new Error(`npx skills list exited with code ${code ?? "unknown"}`));
                return;
            }
            try {
                resolve(parseInstalledSkills(stdout));
            } catch (err) {
                reject(new Error(`Unable to parse npx skills list output: ${(err as Error).message}`));
            }
        });
    });
}
