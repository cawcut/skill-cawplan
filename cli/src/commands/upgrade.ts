import {execFile, spawn} from "node:child_process";
import type {Command} from "commander";

function npmCommand(): string {
    return process.platform === "win32" ? "npm.cmd" : "npm";
}

function cawplanCommand(): string {
    return process.platform === "win32" ? "cawplan.cmd" : "cawplan";
}

function commandOutput(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(command, args, {encoding: "utf8"}, (error, stdout, stderr) => {
            if (error) {
                reject(new Error((stderr || error.message).trim()));
                return;
            }
            const output = stdout.trim();
            if (!output) {
                reject(new Error(`${command} ${args.join(" ")} returned empty output`));
                return;
            }
            resolve(output);
        });
    });
}

function currentCawplanVersion(): Promise<string> {
    return commandOutput(cawplanCommand(), ["--version"]);
}

function latestCawplanVersion(): Promise<string> {
    return commandOutput(npmCommand(), ["view", "cawplan", "version"]);
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
                const currentVersion = await currentCawplanVersion();
                const latestVersion = await latestCawplanVersion();
                if (currentVersion === latestVersion) {
                    console.error(`cawplan ${currentVersion} is already the latest version.`);
                    return;
                }

                console.error(`Upgrading cawplan from ${currentVersion} to ${latestVersion}...`);
                await runUpgrade();
                console.error(`cawplan upgrade completed: ${currentVersion} -> ${latestVersion}.`);
            } catch (err) {
                console.error(`Error: ${(err as Error).message}`);
                process.exit(1);
            }
        });
}
