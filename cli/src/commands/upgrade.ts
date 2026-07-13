import type {Command} from "commander";
import {
    currentCawplanVersion,
    isNewerVersion,
    latestCawplanVersion,
    runCawplanUpgrade,
} from "../lib/cawplan-upgrade.js";

export function registerUpgradeCommand(program: Command): void {
    program
        .command("upgrade")
        .description("Upgrade cawplan CLI to the latest version")
        .action(async () => {
            try {
                const currentVersion = await currentCawplanVersion();
                const latestVersion = await latestCawplanVersion();
                if (!isNewerVersion(latestVersion, currentVersion)) {
                    console.error(`cawplan ${currentVersion} is already up to date (latest published: ${latestVersion}).`);
                    return;
                }

                console.error(`Upgrading cawplan from ${currentVersion} to ${latestVersion}...`);
                await runCawplanUpgrade();
                console.error(`cawplan upgrade completed: ${currentVersion} -> ${latestVersion}.`);
            } catch (err) {
                console.error(`Error: ${(err as Error).message}`);
                process.exit(1);
            }
        });
}
