import { describe, expect, it } from "vitest";
import { buildUpgradeArgs, compareVersions, isNewerVersion } from "../src/lib/cawplan-upgrade.js";

describe("buildUpgradeArgs", () => {
    it("pins the exact resolved version", () => {
        expect(buildUpgradeArgs("0.0.67\n")).toEqual(["install", "-g", "cawplan@0.0.67"]);
    });

    it.each(["latest", "", "1.2", "1.2.3 --foo", "^1.2.3"])("rejects %j", (v) => {
        expect(() => buildUpgradeArgs(v)).toThrow();
    });
});

describe("isNewerVersion", () => {
    it.each([
        ["0.0.68", "0.0.67", true],
        ["0.0.10", "0.0.9", true],
        ["0.0.67", "0.0.67", false],
        // A prerelease CLI must be able to upgrade to its release (skill check
        // reports it as too old for min_cli_version 0.1.0).
        ["0.1.0", "0.1.0-rc.1", true],
        ["0.1.0-rc.1", "0.1.0", false],
        ["0.1.0-rc.2", "0.1.0-rc.1", true],
        ["0.1.0-rc.10", "0.1.0-rc.9", true],
        ["0.1.0-beta", "0.1.0-alpha.1", true],
        ["v0.0.68", "0.0.67", true],
        ["garbage", "0.0.67", false],
    ])("%s newer than %s -> %s", (candidate, base, expected) => {
        expect(isNewerVersion(candidate, base)).toBe(expected);
    });

    it("treats prerelease identifiers per SemVer", () => {
        expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
        expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBeLessThan(0);
    });
});
