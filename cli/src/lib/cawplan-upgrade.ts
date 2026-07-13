import {execFile, spawn} from "node:child_process";

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

function parseVersion(version: string): number[] {
    return version
        .trim()
        .replace(/^v/, "")
        .split(".")
        .map((part) => Number.parseInt(part, 10) || 0);
}

export function isNewerVersion(candidate: string, base: string): boolean {
    const c = parseVersion(candidate);
    const b = parseVersion(base);
    for (let i = 0; i < 3; i++) {
        if ((c[i] ?? 0) > (b[i] ?? 0)) return true;
        if ((c[i] ?? 0) < (b[i] ?? 0)) return false;
    }
    return false;
}

export function currentCawplanVersion(): Promise<string> {
    return commandOutput(cawplanCommand(), ["--version"]);
}

export function latestCawplanVersion(): Promise<string> {
    return commandOutput(npmCommand(), ["view", "cawplan", "version"]);
}

export function runCawplanUpgrade(): Promise<void> {
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
