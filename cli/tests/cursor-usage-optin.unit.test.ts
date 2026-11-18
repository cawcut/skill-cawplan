import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

// Stub every local source and network dependency so the test only exercises the
// Cursor usage opt-in gate inside collect().
const cursorApi = vi.hoisted(() => ({
    buildSessionCookie: vi.fn(() => ({cookie: "WorkosCursorSessionToken=fake", userId: "user_fake"})),
    fetchUsageEvents: vi.fn(async () => [] as Record<string, unknown>[]),
}));

vi.mock("../src/lib/collect/agents/cursor-api.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/lib/collect/agents/cursor-api.js")>()),
    buildSessionCookie: cursorApi.buildSessionCookie,
    fetchUsageEvents: cursorApi.fetchUsageEvents,
}));

vi.mock("../src/lib/collect/agents/cursor-gui.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/lib/collect/agents/cursor-gui.js")>()),
    collectGuiSessions: () => [{
        id: "11111111-2222-3333-4444-555555555555",
        name: "gated session",
        created_at_ms: Date.parse("2026-11-10T09:00:00"),
        last_updated_at_ms: Date.parse("2026-11-10T09:30:00"),
        model: "default",
        header_count: 2,
        activity_start: new Date("2026-11-10T09:00:00"),
        activity_end: new Date("2026-11-10T09:30:00"),
        cwd: "",
        files_changed: [],
        repos_touched: [],
        message_stats: {user: 1, assistant: 1, tool_calls: 0},
        human_inputs: [{category: "direction", content: "fix the bug", start_time: "2026-11-10T09:00:00"}],
    }],
}));

vi.mock("../src/lib/collect/agents/cursor-cli.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/lib/collect/agents/cursor-cli.js")>()),
    collectCursorCliSessions: () => [],
}));

vi.mock("../src/lib/ai-session/ticket-context.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/lib/ai-session/ticket-context.js")>()),
    applyTicketRefsToSessions: async () => 0,
    applyHumanInputTicketRefsToSessions: async () => 0,
    normalizeSessionTicketIdsToUniqueIds: async () => 0,
}));

const {collect} = await import("../src/lib/collect/index.js");
const {resolveCursorUsageOptIn, markCursorUsageNotEnabled} = await import("../src/lib/collect/cursor-usage-optin.js");
const {readUserConfigSync, writeUserConfig} = await import("../src/lib/user-config.js");

let configDir: string;
let configPath: string;
const savedConfigPath = process.env.CAWPLAN_CONFIG_PATH;

beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "cawplan-cursor-optin-"));
    configPath = join(configDir, "config.json");
    process.env.CAWPLAN_CONFIG_PATH = configPath;
    cursorApi.buildSessionCookie.mockClear();
    cursorApi.fetchUsageEvents.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    if (savedConfigPath === undefined) delete process.env.CAWPLAN_CONFIG_PATH;
    else process.env.CAWPLAN_CONFIG_PATH = savedConfigPath;
    rmSync(configDir, {recursive: true, force: true});
});

describe("resolveCursorUsageOptIn", () => {
    test("is off when nothing is configured", () => {
        expect(resolveCursorUsageOptIn(undefined, () => null)).toBe(false);
        expect(resolveCursorUsageOptIn(undefined, () => ({}))).toBe(false);
    });

    test("follows the persisted cursor_usage config", () => {
        expect(resolveCursorUsageOptIn(undefined, () => ({cursor_usage: true}))).toBe(true);
        expect(resolveCursorUsageOptIn(undefined, () => ({cursor_usage: false}))).toBe(false);
    });

    test("an explicit per-run choice wins over config", () => {
        expect(resolveCursorUsageOptIn(true, () => ({cursor_usage: false}))).toBe(true);
        expect(resolveCursorUsageOptIn(false, () => ({cursor_usage: true}))).toBe(false);
    });

    test("an unreadable config means off", () => {
        expect(resolveCursorUsageOptIn(undefined, () => {
            throw new SyntaxError("bad json");
        })).toBe(false);
    });
});

describe("cursor_usage config persistence", () => {
    test("keeps a boolean and drops anything else", async () => {
        await writeUserConfig({cursor_usage: true});
        expect(readUserConfigSync()?.cursor_usage).toBe(true);

        writeFileSync(configPath, JSON.stringify({cursor_usage: "yes"}));
        expect(readUserConfigSync()?.cursor_usage).toBeUndefined();
    });
});

describe("markCursorUsageNotEnabled", () => {
    test("marks only Cursor GUI sessions without usage", () => {
        const sessions = [
            {agent: "cursor-gui", usage_breakdown: [] as unknown[]},
            {agent: "cursor-gui", usage_breakdown: [{}] as unknown[]},
            {agent: "claude-code", usage_breakdown: [] as unknown[]},
        ] as Array<{agent: string; usage_breakdown: unknown[]; token_source?: string}>;
        expect(markCursorUsageNotEnabled(sessions)).toBe(1);
        expect(sessions[0].token_source).toBe("unavailable (Cursor usage lookup is off)");
        expect(sessions[1].token_source).toBeUndefined();
        expect(sessions[2].token_source).toBeUndefined();
    });
});

describe("collect() Cursor usage gate", () => {
    const date = "2026-11-10";

    test("off by default: no Cursor token read and no cursor.com request", async () => {
        const daily = await collect({date, agents: ["cursor"]});

        expect(cursorApi.buildSessionCookie).not.toHaveBeenCalled();
        expect(cursorApi.fetchUsageEvents).not.toHaveBeenCalled();
        // Without usage data the Cursor GUI session has no tokens and is dropped from the report.
        expect(daily.sessions).toHaveLength(0);
        const warned = vi.mocked(console.warn).mock.calls.map((args) => String(args[0])).join("\n");
        expect(warned).toContain("Cursor usage lookup is off");
        expect(warned).toContain("cawplan config cursor-usage on");
    });

    test("config cursor_usage: true enables the lookup", async () => {
        await writeUserConfig({cursor_usage: true});

        await collect({date, agents: ["cursor"]});

        expect(cursorApi.buildSessionCookie).toHaveBeenCalledTimes(1);
        expect(cursorApi.fetchUsageEvents).toHaveBeenCalledTimes(1);
    });

    test("per-run cursorUsage: true enables the lookup without config", async () => {
        await collect({date, agents: ["cursor"], cursorUsage: true});

        expect(cursorApi.buildSessionCookie).toHaveBeenCalledTimes(1);
        expect(cursorApi.fetchUsageEvents).toHaveBeenCalledTimes(1);
    });

    test("per-run cursorUsage: false overrides an enabled config", async () => {
        await writeUserConfig({cursor_usage: true});

        await collect({date, agents: ["cursor"], cursorUsage: false});

        expect(cursorApi.buildSessionCookie).not.toHaveBeenCalled();
        expect(cursorApi.fetchUsageEvents).not.toHaveBeenCalled();
    });

    test("not collecting Cursor never touches the lookup", async () => {
        await collect({date, agents: ["vscode"], cursorUsage: true});

        expect(cursorApi.buildSessionCookie).not.toHaveBeenCalled();
        expect(cursorApi.fetchUsageEvents).not.toHaveBeenCalled();
    });
});
