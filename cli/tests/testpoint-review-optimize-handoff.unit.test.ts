import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import http from "node:http";
import net from "node:net";
import {once} from "node:events";
import {startTestPointReviewWebServer} from "../src/lib/testpoint-review/testpoint-review-web-server.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";
import {reviewFilePath, saveReviewState} from "../src/lib/testpoint-review/store.js";
import type {ReviewState} from "../src/lib/testpoint-review/types.js";
import type {ArchiveTestPointsFn} from "../src/lib/testpoint-review/testpoint-review-web-server.js";

vi.mock("../src/lib/oauth.js", () => ({openBrowser: vi.fn().mockResolvedValue(undefined)}));

function post(url: string, body: string): Promise<{status: number; json: unknown}> {
    return new Promise((resolve, reject) => {
        const req = http.request(url, {method: "POST", headers: {"content-type": "application/json"}}, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            res.on("end", () => {
                resolve({status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString("utf-8"))});
            });
        });
        req.on("error", reject);
        req.end(body);
    });
}

function extractServerUrl(errorSpy: ReturnType<typeof vi.spyOn>): string {
    const call = errorSpy.mock.calls.find((args) => typeof args[0] === "string" && args[0].includes("http://"));
    if (!call) throw new Error("server URL not printed to stderr");
    const match = (call[0] as string).match(/http:\/\/[^\s]+/);
    if (!match) throw new Error("could not parse server URL");
    return match[0];
}

function resolvesWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`server did not close within ${timeoutMs}ms`)), timeoutMs);
        void promise.then(
            (value) => {
                clearTimeout(timeout);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timeout);
                reject(error);
            },
        );
    });
}

describe("startTestPointReviewWebServer optimize handoff (design §7, plan step 17)", () => {
    let dir: string;
    let originalEnv: string | undefined;
    let state: ReviewState;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "testpoint-review-handoff-test-"));
        originalEnv = process.env.CAWPLAN_TESTPOINT_REVIEW_PATH;
        process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = dir;
        state = createFixtureReviewState({productId: "prod_1", requirementId: "req_1"});
        state.test_points[0].status = "edited";
        saveReviewState(state);
    });

    afterEach(() => {
        if (originalEnv === undefined) delete process.env.CAWPLAN_TESTPOINT_REVIEW_PATH;
        else process.env.CAWPLAN_TESTPOINT_REVIEW_PATH = originalEnv;
        rmSync(dir, {recursive: true, force: true});
        vi.restoreAllMocks();
    });

    test("POST /api/optimize saves state, then the real server closes and the CLI command's promise resolves", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const serverPromise = startTestPointReviewWebServer(state.review_id);
        await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
        const url = extractServerUrl(errorSpy);
        const base = url.split("?")[0];
        const token = new URL(url).searchParams.get("token");

        const result = await post(`${base}api/optimize?token=${token}`, "{}");
        expect(result.status).toBe(200);

        // The CLI command's `await startTestPointReviewWebServer(...)` must actually resolve —
        // this is what lets the waiting Agent's shell command exit and read the saved state.
        await expect(serverPromise).resolves.toBeUndefined();

        const persisted = JSON.parse(readFileSync(reviewFilePath(state.review_id), "utf8")) as ReviewState;
        expect(persisted.review_status).toBe("pending_optimize");
        expect(persisted.optimize_requested_at).toBeDefined();
    });

    test("successful Save to CawPlan closes despite a browser connection that remains open", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const archiveTestPoints = vi.fn<ArchiveTestPointsFn>().mockResolvedValue({
            outcome: "SUCCESS",
            command: "testpoints archive",
            meta: {product_id: "prod_1", requirement_id: "req_1", dry_run: false},
        });
        const serverPromise = startTestPointReviewWebServer(state.review_id, {archiveTestPoints}, {launchBrowser: false});
        await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
        const url = new URL(extractServerUrl(errorSpy));
        const heldSocket = net.createConnection({host: url.hostname, port: Number(url.port)});
        heldSocket.on("error", () => {});
        await once(heldSocket, "connect");

        try {
            const result = await post(`${url.origin}/api/save-to-cawplan?token=${url.searchParams.get("token")}`, "{}");
            expect(result.status).toBe(200);
            expect(archiveTestPoints).toHaveBeenCalledOnce();
            await expect(resolvesWithin(serverPromise, 500)).resolves.toBeUndefined();
        } finally {
            heldSocket.destroy();
        }
    });

    test("does not schedule a fixed 10-minute shutdown for an ordinary review", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

        const serverPromise = startTestPointReviewWebServer(state.review_id, {}, {launchBrowser: false});
        await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
        const url = extractServerUrl(errorSpy);

        expect(timeoutSpy.mock.calls.some((call) => call[1] === 10 * 60 * 1000)).toBe(false);

        const parsedUrl = new URL(url);
        await post(`${parsedUrl.origin}/api/optimize?token=${parsedUrl.searchParams.get("token")}`, "{}");
        await expect(serverPromise).resolves.toBeUndefined();
    });

    test("the page is unreachable once the server has closed after optimize", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const serverPromise = startTestPointReviewWebServer(state.review_id);
        await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
        const url = extractServerUrl(errorSpy);
        const base = url.split("?")[0];
        const token = new URL(url).searchParams.get("token");

        await post(`${base}api/optimize?token=${token}`, "{}");
        await serverPromise;

        await expect(
            new Promise((resolve, reject) => {
                const req = http.get(url, resolve);
                req.on("error", reject);
                req.setTimeout(500, () => req.destroy(new Error("timed out")));
            }),
        ).rejects.toThrow();
    });
});
