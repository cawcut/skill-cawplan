import {execFile, spawn, type ChildProcess, type SpawnOptions} from "node:child_process";

// Windows ships npm, npx and globally installed bins as .cmd shims. Since the
// CVE-2024-27980 fix, Node refuses to spawn .cmd/.bat files without a shell
// (EINVAL), so on win32 these commands go through cmd.exe. With a shell the
// arguments are concatenated into one command line unescaped, so every
// argument must be a plain token: anything that cmd.exe could interpret
// (spaces, quotes, &, |, <, >, ^, %, !) is rejected instead of quoted.
const SAFE_SHELL_ARG = /^[A-Za-z0-9@._:/=+-]+$/;

export interface CommandSpec {
    command: string;
    args: string[];
    shell: boolean;
}

export function buildCommandSpec(
    command: string,
    args: string[],
    platform: NodeJS.Platform = process.platform
): CommandSpec {
    if (platform !== "win32") return {command, args, shell: false};
    for (const arg of [command, ...args]) {
        if (!SAFE_SHELL_ARG.test(arg)) {
            throw new Error(`Refusing to pass ${JSON.stringify(arg)} through the Windows shell`);
        }
    }
    return {command, args, shell: true};
}

/** spawn() for npm/npx/cawplan that also works with the .cmd shims on Windows. */
export function spawnCommand(command: string, args: string[], options: SpawnOptions = {}): ChildProcess {
    const spec = buildCommandSpec(command, args);
    return spawn(spec.command, spec.args, {...options, shell: spec.shell});
}

export interface CommandOutputOptions {
    timeoutMs?: number;
}

/** Runs a command and resolves with its trimmed, non-empty stdout. */
export function commandOutput(command: string, args: string[], options: CommandOutputOptions = {}): Promise<string> {
    return new Promise((resolve, reject) => {
        let spec: CommandSpec;
        try {
            spec = buildCommandSpec(command, args);
        } catch (err) {
            reject(err);
            return;
        }
        execFile(
            spec.command,
            spec.args,
            {encoding: "utf8", shell: spec.shell, timeout: options.timeoutMs ?? 0, windowsHide: true},
            (error, stdout, stderr) => {
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
            }
        );
    });
}
