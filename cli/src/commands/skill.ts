import type {Command} from "commander";
import {getAuthState} from "../lib/auth-state.js";
import {
    currentCawplanVersion,
    isNewerVersion,
    latestCawplanVersion,
    runCawplanUpgrade,
} from "../lib/cawplan-upgrade.js";

async function ensureLatestCawplan(): Promise<void> {
    let currentVersion: string;
    let latestVersion: string;
    try {
        currentVersion = await currentCawplanVersion();
        latestVersion = await latestCawplanVersion();
    } catch {
        console.error("Unable to check latest cawplan version. Upgrading...");
        await runCawplanUpgrade();
        return;
    }

    if (!isNewerVersion(latestVersion, currentVersion)) return;
    console.error(`cawplan ${latestVersion} is available (current: ${currentVersion}). Upgrading...`);
    await runCawplanUpgrade();
}

async function ensureAuthenticated(): Promise<void> {
    const state = await getAuthState();
    if (state.active !== "none") return;
    throw new Error("Not authenticated. Run: cawplan auth login");
}

export function registerSkillCommand(program: Command): void {
    const skill = program.command("skill").description("Utilities for CawPlan agent skills");

    skill
        .command("check")
        .description("Check cawplan CLI version and authentication for skills")
        .action(async () => {
            try {
                await ensureLatestCawplan();
                await ensureAuthenticated();
            } catch (err) {
                console.error((err as Error).message);
                process.exit(1);
            }
        });
}
