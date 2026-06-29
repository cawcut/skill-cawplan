import {spawn} from "node:child_process";
import type {Command} from "commander";

function npmCommand(): string {
    return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runUpgrade(): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(npmCommand(), ["install", "-g", "cawplan@latest"], {
            stdio: "inherit",
        });

        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`npm install exited with code ${code ?? "unknown"}`));
        });
    });
}

export function registerUpgradeCommand(program: Command): void {
    program
        .command("upgrade")
        .description("Upgrade cawplan CLI to the latest version")
        .action(async () => {
            try {
                console.error("Upgrading cawplan to the latest version...");
                await runUpgrade();
                console.error("cawplan upgrade completed.");
            } catch (err) {
                console.error(`Error: ${(err as Error).message}`);
                process.exit(1);
            }
        });
}
