import {describe, expect, it} from "vitest";
import {buildCommandSpec, commandOutput, spawnCommand} from "../src/lib/portable-spawn.js";
import {buildUpgradeArgs} from "../src/lib/cawplan-upgrade.js";
import {buildNpxArgs, buildSkillsAddArgs} from "../src/lib/skill-update.js";

describe("buildCommandSpec", () => {
    it("spawns directly without a shell off Windows", () => {
        expect(buildCommandSpec("npx", ["--yes", "a b"], "darwin")).toEqual({
            command: "npx",
            args: ["--yes", "a b"],
            shell: false,
        });
    });

    it("routes npm/npx through the shell on Windows so .cmd shims do not throw EINVAL", () => {
        expect(buildCommandSpec("npm", buildUpgradeArgs("0.0.68"), "win32")).toEqual({
            command: "npm",
            args: ["install", "-g", "cawplan@0.0.68"],
            shell: true,
        });
    });

    it("accepts the real skills add invocation on Windows", () => {
        const args = buildNpxArgs(buildSkillsAddArgs(["cawplan-my-work"]));
        expect(buildCommandSpec("npx", args, "win32").shell).toBe(true);
    });

    it.each(["a b", "x&calc", "x|y", "\"q\"", "%PATH%", "x^y", "a>b", "!v!", ""])(
        "rejects shell-significant argument %j on Windows",
        (arg) => {
            expect(() => buildCommandSpec("npx", ["skills", arg], "win32")).toThrow(/Windows shell/);
        }
    );
});

// Real processes: on the Windows CI runner npm is npm.cmd, which is exactly the
// shim Node 22 refuses to spawn without a shell (EINVAL).
describe("spawning the real npm", () => {
    it("reads npm's version through commandOutput", async () => {
        expect(await commandOutput("npm", ["--version"], {timeoutMs: 30_000})).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("runs npm through spawnCommand", async () => {
        const code = await new Promise<number | null>((resolve, reject) => {
            const child = spawnCommand("npm", ["--version"], {stdio: "ignore"});
            child.on("error", reject);
            child.on("close", resolve);
        });
        expect(code).toBe(0);
    });
});
