import {existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, test} from "vitest";
import {collectClaudeCodeSession} from "../src/lib/collect/agents/claude-code.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Built from a real QA session with one genuine short turn padded past 1500
// characters (see the fixture generation note below); kept out of git since
// it embeds real conversation content, gitignored under
// tests/fixtures/long-turn/*.jsonl. Skip when a developer hasn't generated it.
const FIXTURE_PATH = join(__dirname, "fixtures", "long-turn", "fcc914fb-long-turn.jsonl");
const SESSION_ID = "fcc914fb-041a-4ce6-8c2d-f79910c13d0d";
const DATE = "2026-08-20";
const PADDED_TURN_MIN_LENGTH = 1501;

describe.skipIf(!existsSync(FIXTURE_PATH))("collect turn-length cutoff (A5 threshold parameterization)", () => {
    test("coding direction: default cutoff still drops the long turn", () => {
        const session = collectClaudeCodeSession(FIXTURE_PATH, "long-turn-fixture", SESSION_ID, DATE);
        const longTurns = (session.human_inputs ?? []).filter((h) => h.content.length >= PADDED_TURN_MIN_LENGTH);
        expect(longTurns).toHaveLength(0);
    });

    test("QA direction: Infinity cutoff keeps the long turn intact and untruncated", () => {
        const session = collectClaudeCodeSession(FIXTURE_PATH, "long-turn-fixture", SESSION_ID, DATE, {
            maxTurnLength: Infinity,
        });
        const longTurns = (session.human_inputs ?? []).filter((h) => h.content.length >= PADDED_TURN_MIN_LENGTH);
        expect(longTurns).toHaveLength(1);
        expect(longTurns[0].content.length).toBeGreaterThanOrEqual(PADDED_TURN_MIN_LENGTH);
    });

    test("QA direction has strictly more human_inputs than the coding direction", () => {
        const codingSession = collectClaudeCodeSession(FIXTURE_PATH, "long-turn-fixture", SESSION_ID, DATE);
        const qaSession = collectClaudeCodeSession(FIXTURE_PATH, "long-turn-fixture", SESSION_ID, DATE, {
            maxTurnLength: Infinity,
        });
        expect((qaSession.human_inputs ?? []).length).toBeGreaterThan((codingSession.human_inputs ?? []).length);
    });
});
