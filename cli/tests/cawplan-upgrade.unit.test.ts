import { describe, expect, it } from "vitest";
import { buildUpgradeArgs } from "../src/lib/cawplan-upgrade.js";

describe("buildUpgradeArgs", () => {
    it("pins the exact resolved version", () => {
        expect(buildUpgradeArgs("0.0.67\n")).toEqual(["install", "-g", "cawplan@0.0.67"]);
    });

    it.each(["latest", "", "1.2", "1.2.3 --foo", "^1.2.3"])("rejects %j", (v) => {
        expect(() => buildUpgradeArgs(v)).toThrow();
    });
});
