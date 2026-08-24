import {randomBytes} from "node:crypto";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {openBrowser} from "../oauth.js";
import {getPortalBase} from "../products.js";
import {listProductsForSelector} from "../assign/products-api.js";
import {resolveTicketContexts} from "../ai-session/ticket-context.js";
import {qaAssignmentHtml} from "./qa-assignment-html.js";
import {applyQaWebAssignments, QaAssignmentValidationError} from "./qa-apply.js";
import {readQaDailyReport, writeQaDailyReport} from "./qa-report-io.js";
import type {QaAssignmentReport} from "./types.js";
import type {QaDailyApiJson} from "../collect/qa-types.js";
import type {QaWebAssignment} from "./types.js";

const localAssignmentHost = "127.0.0.1";
const ASSIGNMENT_SERVER_TIMEOUT_MS = 10 * 60 * 1000;

export interface QaAssignServerDeps {
    listProducts?: typeof listProductsForSelector;
    resolveTickets?: typeof resolveTicketContexts;
    readReport?: typeof readQaDailyReport;
    writeReport?: typeof writeQaDailyReport;
    renderHtml?: typeof qaAssignmentHtml;
    getPortalBase?: typeof getPortalBase;
}

export interface QaAssignDispatchResult {
    status: number;
    body: unknown;
    closeServer?: boolean;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload),
        "cache-control": "no-store",
    });
    res.end(payload);
}

function sendText(res: ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8"): void {
    res.writeHead(status, {
        "content-type": contentType,
        "content-length": Buffer.byteLength(body),
        "cache-control": "no-store",
    });
    res.end(body);
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        req.on("error", reject);
    });
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
    const raw = await readRequestBody(req);
    return raw ? JSON.parse(raw) as T : {} as T;
}

function requestHasToken(req: IncomingMessage, token: string): boolean {
    const url = new URL(req.url ?? "/", `http://${localAssignmentHost}`);
    return url.searchParams.get("token") === token;
}

function validationStatus(error: unknown): number {
    return error instanceof QaAssignmentValidationError ? 400 : 500;
}

export async function dispatchQaAssignRequest(
    req: Pick<IncomingMessage, "method" | "url">,
    rawBody: string,
    report: QaAssignmentReport,
    token: string,
    deps: QaAssignServerDeps = {},
): Promise<QaAssignDispatchResult> {
    if (!requestHasToken(req as IncomingMessage, token)) {
        return {status: 403, body: {error: "invalid token"}};
    }

    const url = new URL(req.url ?? "/", `http://${localAssignmentHost}`);
    const listProducts = deps.listProducts ?? listProductsForSelector;
    const readReport = deps.readReport ?? readQaDailyReport;
    const writeReport = deps.writeReport ?? writeQaDailyReport;
    const renderHtml = deps.renderHtml ?? qaAssignmentHtml;
    const portalBase = (deps.getPortalBase ?? getPortalBase)();

    if (req.method === "GET" && url.pathname === "/") {
        return {
            status: 200,
            body: renderHtml({portalBase}),
        };
    }

    if (req.method === "GET" && url.pathname === "/qa-assign/bootstrap") {
        const daily = readReport(report.file);
        const products = await listProducts();
        return {
            status: 200,
            body: {
                daily,
                products,
                excludedSessions: report.excludedSessions,
            },
        };
    }

    if (req.method === "POST" && url.pathname === "/qa-assign/save") {
        try {
            const body = rawBody ? JSON.parse(rawBody) as {assignments?: QaWebAssignment[]} : {};
            if (!Array.isArray(body.assignments)) {
                throw new QaAssignmentValidationError("assignments must be an array");
            }

            const daily = readReport(report.file);
            const applied = await applyQaWebAssignments(daily, body.assignments, report.excludedSessions);
            writeReport(report.file, daily);
            report.daily = daily;

            return {
                status: 200,
                body: {
                    file: report.file,
                    applied_sessions: applied,
                },
                closeServer: true,
            };
        } catch (error) {
            return {status: validationStatus(error), body: {error: (error as Error).message}};
        }
    }

    if (req.method === "POST" && url.pathname === "/qa-assign/close") {
        return {status: 200, body: {closed: true}, closeServer: true};
    }

    return {status: 404, body: {error: "not found"}};
}

export async function handleQaAssignHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    report: QaAssignmentReport,
    token: string,
    deps: QaAssignServerDeps = {},
): Promise<boolean> {
    try {
        const rawBody = req.method === "POST" ? await readRequestBody(req) : "";
        const result = await dispatchQaAssignRequest(req, rawBody, report, token, deps);
        if (typeof result.body === "string") {
            sendText(res, result.status, result.body, "text/html; charset=utf-8");
        } else {
            sendJson(res, result.status, result.body);
        }
        return Boolean(result.closeServer);
    } catch (error) {
        sendJson(res, validationStatus(error), {error: (error as Error).message});
        return false;
    }
}

export async function startQaAssignmentWebServer(
    report: QaAssignmentReport,
    deps: QaAssignServerDeps = {},
): Promise<void> {
    const token = randomBytes(16).toString("hex");
    let closed = false;

    await new Promise<void>((resolve, reject) => {
        let timeout: NodeJS.Timeout | undefined;
        let server: ReturnType<typeof createServer>;

        const closeServer = () => {
            if (closed) return;
            closed = true;
            if (timeout) clearTimeout(timeout);
            server.close(() => resolve());
        };
        const closeServerSoon = () => {
            if (closed) return;
            closed = true;
            if (timeout) clearTimeout(timeout);
            setTimeout(() => server.close(() => resolve()), 50);
        };

        server = createServer(async (req, res) => {
            const shouldClose = await handleQaAssignHttpRequest(req, res, report, token, deps);
            if (shouldClose) closeServerSoon();
        });

        server.on("error", reject);
        server.listen(0, localAssignmentHost, () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                reject(new Error("failed to determine local QA assignment server address"));
                return;
            }
            const assignmentUrl = `http://${localAssignmentHost}:${address.port}/?token=${token}`;
            console.error(`Open this URL to review QA sessions: ${assignmentUrl}`);
            void openBrowser(assignmentUrl).catch(() => {
                console.error("Could not open the browser automatically; please open the URL manually.");
            });
            console.error("Waiting for QA assignment confirmation. Click Save assignments or Close to exit.");
            timeout = setTimeout(() => {
                console.error("QA assignment page timed out after 10 minutes; closing local server.");
                closeServer();
            }, ASSIGNMENT_SERVER_TIMEOUT_MS);
        });

        process.once("SIGINT", () => {
            closeServer();
        });
    });
}

export function readQaAssignmentReport(file: string, daily: QaDailyApiJson, excludedSessions: QaAssignmentReport["excludedSessions"] = []): QaAssignmentReport {
    return {file, daily, excludedSessions};
}
