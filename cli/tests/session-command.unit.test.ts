import {describe, expect, test} from "vitest";
import {formatElapsedMs} from "../src/commands/session.js";

describe("session command helpers", () => {
    test("formats elapsed collect duration", () => {
        expect(formatElapsedMs(499)).toBe("0s");
        expect(formatElapsedMs(1_400)).toBe("1s");
        expect(formatElapsedMs(65_100)).toBe("1m 5s");
    });
});
