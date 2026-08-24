import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {Command} from "commander";
import {registerSessionCommand} from "../src/commands/session.js";
import * as reportsApi from "../src/lib/qa-session/reports-api.js";
import {qaBackfillMissingReports} from "../src/lib/qa-session/backfill.js";
import {writeCredentials} from "../src/lib/credentials.js";

let originalCredentialsPath: string | undefined;
let tmpDir: string;

function unsignedJwt(payload: Record<string, unknown>): string {
    return [
        Buffer.from(JSON.stringify({alg: "none", typ: "JWT"})).toString("base64url"),
        Buffer.from(JSON.stringify(payload)).toString("base64url"),
        "",
    ].join(".");
}

beforeEach(async () => {
    originalCredentialsPath = process.env.CAWPLAN_CREDENTIALS_PATH;
    tmpDir = await mkdtemp(join(tmpdir(), "cawplan-qa-backfill-test-"));
    process.env.CAWPLAN_CREDENTIALS_PATH = join(tmpDir, "credentials.json");
    await writeCredentials({
        accessToken: unsignedJwt({user_id: "user-1", email: "qa.tester@example.test"}),
        expire: 4102444800,
    });
});

afterEach(async () => {
    vi.restoreAllMocks();
    if (originalCredentialsPath === undefined) delete process.env.CAWPLAN_CREDENTIALS_PATH;
    else process.env.CAWPLAN_CREDENTIALS_PATH = originalCredentialsPath;
    await rm(tmpDir, {recursive: true, force: true});
});

describe("qaBackfillMissingReports", () => {
    test("dry-run lists missing QA report dates for the current user", async () => {
        vi.spyOn(reportsApi, "listMonthlyReportItems").mockResolvedValue([
            {date: "2026-08-02", user_id: "user-1"},
            {date: "2026-08-04", user_id: "user-1"},
        ]);

        const result = await qaBackfillMissingReports("2026-08-01", "2026-08-04", {dryRun: true});

        expect(result).toEqual({
            checked_dates: ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"],
            missing_dates: ["2026-08-01", "2026-08-03"],
            uploaded_dates: [],
            skipped_dates: [],
            dry_run: true,
        });
        expect(reportsApi.listMonthlyReportItems).toHaveBeenCalledWith(
            "2026-08-01",
            "2026-08-04",
            "user-1",
        );
    });

    test("ignores report rows for other users when computing missing dates", async () => {
        vi.spyOn(reportsApi, "listMonthlyReportItems").mockResolvedValue([
            {date: "2026-08-01", user_id: "other-user"},
            {date: "2026-08-02", user_id: "user-1"},
        ]);

        const result = await qaBackfillMissingReports("2026-08-01", "2026-08-02", {dryRun: true});

        expect(result.missing_dates).toEqual(["2026-08-01"]);
    });

    test("throws when --from is later than --to", async () => {
        const list = vi.spyOn(reportsApi, "listMonthlyReportItems");

        await expect(qaBackfillMissingReports("2026-08-10", "2026-08-01", {dryRun: true}))
            .rejects
            .toThrow("--from must be earlier than or equal to --to");
        expect(list).not.toHaveBeenCalled();
    });

    test("rejects non-dry-run until batch upload is implemented", async () => {
        vi.spyOn(reportsApi, "listMonthlyReportItems").mockResolvedValue([]);

        await expect(qaBackfillMissingReports("2026-08-01", "2026-08-02"))
            .rejects
            .toThrow("QA backfill upload is not implemented yet; re-run with --dry-run");
    });
});

async function runSessionQaBackfill(dateFrom: string, dateTo: string, args: string[] = []): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerSessionCommand(program);
    await program.parseAsync(
        ["node", "cawplan", "session", "qa-backfill", "--from", dateFrom, "--to", dateTo, ...args],
        {from: "node"},
    );
}

describe("session qa-backfill command", () => {
    test("requires --dry-run before querying cloud", async () => {
        const list = vi.spyOn(reportsApi, "listMonthlyReportItems");

        await expect(runSessionQaBackfill("2026-08-01", "2026-08-02")).rejects.toThrow();
        expect(list).not.toHaveBeenCalled();
    });

    test("prints missing_dates JSON on dry-run", async () => {
        vi.spyOn(reportsApi, "listMonthlyReportItems").mockResolvedValue([
            {date: "2026-08-02", user_id: "user-1"},
        ]);
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        await runSessionQaBackfill("2026-08-01", "2026-08-02", ["--dry-run"]);

        expect(logSpy).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
        expect(payload).toEqual({
            checked_dates: ["2026-08-01", "2026-08-02"],
            missing_dates: ["2026-08-01"],
            uploaded_dates: [],
            skipped_dates: [],
            dry_run: true,
        });
    });
});
