import {existsSync, readFileSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {openBrowser} from "../oauth.js";
import {readMatchingBrowserModule} from "./matching-browser.js";
import {assignmentHtml} from "./assignment-html.js";
import {
    createProductRepoMapping,
    listProductRepoMappings,
    listProductsForSelector,
} from "./products-api.js";
import {assignProjectsFromCloudMappings} from "./auto-assign.js";
import {applyProductRepoMappingToProject} from "./apply.js";
import {assignmentReportPayload, readDailyReports, writeDailyReport} from "./report-io.js";
import {assertAllSessionsHaveProduct, findSessionById} from "./session-checks.js";
import type {AssignmentReport, ProductRepoMapping, WebAssignment} from "./types.js";
import type {DailyApiJson} from "../collect/types.js";

const localAssignmentHost = "127.0.0.1";
const assetNames = new Set(["model-gpt.png", "model-claude.png", "model-cursor.png"]);

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

function sendBinary(res: ServerResponse, status: number, body: Buffer, contentType: string): void {
    res.writeHead(status, {
        "content-type": contentType,
        "content-length": body.length,
        "cache-control": "no-store",
    });
    res.end(body);
}

function readAssignmentAsset(name: string): Buffer | null {
    if (!assetNames.has(name)) return null;
    const here = dirname(fileURLToPath(import.meta.url));
    for (const path of [
        join(here, "assets", name),
        join(here, "..", "..", "..", "src", "lib", "assign", "assets", name),
    ]) {
        if (existsSync(path)) return readFileSync(path);
    }
    return null;
}

function readRequestBody(req: IncomingMessage): Promise<string> {
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

async function applyWebAssignments(daily: DailyApiJson, assignments: WebAssignment[]): Promise<number> {
    let assigned = 0;
    for (const assignment of assignments) {
        if (!assignment.session_id) throw new Error("session_id is required for every assignment");
        if (!assignment.product_id) throw new Error(`product_id is required for session ${assignment.session_id}`);
        const session = findSessionById(daily, assignment.session_id);
        let mapping: ProductRepoMapping = {
            product_id: assignment.product_id,
            product_name: assignment.product_name,
            repo_name: assignment.repo_name,
            repo_url: assignment.repo_url,
        };

        if (assignment.create_mapping) {
            if (!assignment.repo_url) {
                throw new Error(`repo_url is required to create a mapping for session ${assignment.session_id}`);
            }
            mapping = {
                ...(await createProductRepoMapping({
                    productId: assignment.product_id,
                    repoUrl: assignment.repo_url,
                })),
                product_name: assignment.product_name,
            };
        }

        assigned += applyProductRepoMappingToProject(daily, session, mapping);
    }
    return assigned;
}

async function applyBatchWebAssignments(
    reports: AssignmentReport[],
    assignments: WebAssignment[]
): Promise<{assignedSessions: number; files: string[]}> {
    let assignedSessions = 0;
    const savedFiles: string[] = [];
    for (const report of reports) {
        const fileAssignments = assignments.filter((assignment) => assignment.file === report.file);
        if (fileAssignments.length > 0) {
            assignedSessions += await applyWebAssignments(report.daily, fileAssignments);
        }
        assertAllSessionsHaveProduct(report.daily);
        writeDailyReport(report.file, report.daily);
        savedFiles.push(report.file);
    }
    return {assignedSessions, files: savedFiles};
}

export async function assignReportsFromTty(
    reports: AssignmentReport[]
): Promise<{assignedSessions: number; files: string[]}> {
    let assignedSessions = 0;
    const files: string[] = [];
    for (const report of reports) {
        console.error(`Assigning products for ${report.file}...`);
        assignedSessions += await assignProjectsFromCloudMappings(report.daily, report.file);
        assertAllSessionsHaveProduct(report.daily);
        files.push(report.file);
    }
    return {assignedSessions, files};
}

export async function startAssignmentWebServer(reports: AssignmentReport[], batchMode = false): Promise<void> {
    const token = randomBytes(16).toString("hex");
    let closed = false;

    await new Promise<void>((resolve, reject) => {
        const server = createServer(async (req, res) => {
            try {
                const url = new URL(req.url ?? "/", `http://${localAssignmentHost}`);
                if (!requestHasToken(req, token)) {
                    sendJson(res, 403, {error: "invalid token"});
                    return;
                }

                if (req.method === "GET" && url.pathname === "/") {
                    sendText(res, 200, assignmentHtml(), "text/html; charset=utf-8");
                    return;
                }

                if (req.method === "GET" && url.pathname === "/assign/matching.js") {
                    sendText(res, 200, readMatchingBrowserModule(), "text/javascript; charset=utf-8");
                    return;
                }

                if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
                    const asset = readAssignmentAsset(url.pathname.slice("/assets/".length));
                    if (!asset) {
                        sendJson(res, 404, {error: "asset not found"});
                        return;
                    }
                    sendBinary(res, 200, asset, "image/png");
                    return;
                }

                if (req.method === "GET" && url.pathname === "/api/report") {
                    if (batchMode) {
                        sendJson(res, 200, {
                            batch: true,
                            reports: reports.map(assignmentReportPayload),
                        });
                    } else {
                        sendJson(res, 200, {
                            batch: false,
                            ...assignmentReportPayload(reports[0]),
                        });
                    }
                    return;
                }

                if (req.method === "GET" && url.pathname === "/api/products") {
                    const search = url.searchParams.get("search") ?? url.searchParams.get("q") ?? undefined;
                    sendJson(res, 200, {products: await listProductsForSelector(search)});
                    return;
                }

                if (req.method === "GET" && url.pathname === "/api/product-repos") {
                    sendJson(res, 200, {mappings: await listProductRepoMappings()});
                    return;
                }

                if (req.method === "POST" && url.pathname === "/api/product-repos") {
                    const body = await readJsonBody<{
                        product_id?: string;
                        repo_url?: string;
                        repo_name?: string;
                    }>(req);
                    if (!body.product_id) throw new Error("product_id is required");
                    if (!body.repo_url) throw new Error("repo_url is required");
                    const mapping = await createProductRepoMapping({
                        productId: body.product_id,
                        repoUrl: body.repo_url,
                        repoName: body.repo_name,
                    });
                    sendJson(res, 200, {mapping});
                    return;
                }

                if (req.method === "POST" && url.pathname === "/api/assignments") {
                    const body = await readJsonBody<{assignments?: WebAssignment[]}>(req);
                    if (!Array.isArray(body.assignments)) throw new Error("assignments must be an array");
                    const result = batchMode
                        ? await applyBatchWebAssignments(reports, body.assignments)
                        : await applyBatchWebAssignments(
                              reports,
                              body.assignments.map((assignment) => ({
                                  ...assignment,
                                  file: reports[0].file,
                              }))
                          );
                    sendJson(res, 200, {
                        file: result.files[0],
                        files: result.files,
                        assigned_sessions: result.assignedSessions,
                    });
                    return;
                }

                if (req.method === "POST" && url.pathname === "/api/close") {
                    sendJson(res, 200, {closed: true});
                    closed = true;
                    setTimeout(() => server.close(() => resolve()), 50);
                    return;
                }

                sendJson(res, 404, {error: "not found"});
            } catch (e) {
                sendJson(res, 500, {error: (e as Error).message});
            }
        });

        server.on("error", reject);
        server.listen(0, localAssignmentHost, () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                reject(new Error("failed to determine local assignment server address"));
                return;
            }
            const assignmentUrl = `http://${localAssignmentHost}:${address.port}/?token=${token}`;
            console.error(`Open this URL to assign AI sessions: ${assignmentUrl}`);
            void openBrowser(assignmentUrl).catch(() => {
                console.error("Could not open the browser automatically; please open the URL manually.");
            });
            console.error("Press Ctrl+C or click Close in the page when done.");
        });

        process.once("SIGINT", () => {
            if (closed) return;
            closed = true;
            server.close(() => resolve());
        });
    });
}

export {readDailyReports};
