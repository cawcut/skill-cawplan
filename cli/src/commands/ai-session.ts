import {randomBytes} from "node:crypto";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {Command} from "commander";
import {input, search, select} from "@inquirer/prompts";
import {cawplanRequest} from "../lib/http.js";
import {buildQueryFromFlags} from "../lib/cache.js";
import {readCredentials} from "../lib/credentials.js";
import {listProducts} from "./products.js";
import {collect} from "../lib/collect/index.js";
import {renderDailyApiJson} from "../lib/collect/render.js";
import type {DailyApiJson} from "../lib/collect/types.js";
import {openBrowser} from "../lib/oauth.js";

type AiSessionAgent = "claude-code" | "cursor" | "codex";

function dateParams(opts: { date?: string; from?: string; to?: string }): Record<string, string> {
    const q: Record<string, string> = {};
    if (opts.date) q.date = opts.date;
    if (opts.from) q.date_from = opts.from;
    if (opts.to) q.date_to = opts.to;
    return q;
}

function pageParams(opts: { pageNum?: number; pageSize?: number }): Record<string, string> {
    const q: Record<string, string> = {};
    if (opts.pageNum != null) q.page_num = String(opts.pageNum);
    if (opts.pageSize != null) q.page_size = String(opts.pageSize);
    return q;
}

function limitOffsetParams(opts: { limit?: number; offset?: number }): Record<string, string> {
    const q: Record<string, string> = {};
    if (opts.limit != null) q.limit = String(opts.limit);
    if (opts.offset != null) q.offset = String(opts.offset);
    return q;
}

function addDatePageOptions(cmd: Command): Command {
    return cmd
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date")
        .option("--page-num <n>", "Page number", parseInt)
        .option("--page-size <n>", "Page size", parseInt);
}

function addDateOptions(cmd: Command): Command {
    return cmd
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date");
}

function addReportQueryOptions(cmd: Command): Command {
    return cmd
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date")
        .option("--user-id <id>", "Filter by user unique_id")
        .option("--limit <n>", "Result limit", parseInt)
        .option("--offset <n>", "Pagination offset", parseInt);
}

const DATE_PAGE_KEYS = ["date", "date_from", "date_to", "page_num", "page_size"] as const;
const DATE_KEYS = ["date", "date_from", "date_to"] as const;

interface ProductChoice {
    product_id: string;
    product_name: string;
}

interface ProductRepoMapping {
    product_id?: string;
    product_name?: string;
    repo_name?: string;
    repo_url?: string;
    unique_id?: string;
}

interface ProductListItem {
    unique_id?: string;
    name?: string;
}

interface ProductRepoSelection extends ProductRepoMapping {
    create_from_url?: boolean;
}

interface AiSessionReportItem {
    date?: string;
    reporter_key?: string;
    user_id?: string;
}

interface UserListItem {
    unique_id?: string;
    user_id?: string;
    email?: string;
}

type DailySession = DailyApiJson["sessions"][number];

const localAssignmentHost = "127.0.0.1";
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function extractList<T>(payload: unknown): T[] {
    if (Array.isArray(payload)) return payload as T[];
    const p = payload as Record<string, unknown> | undefined;
    if (Array.isArray(p?.data)) return p.data as T[];
    const inner = p?.data as Record<string, unknown> | undefined;
    if (Array.isArray(inner?.list)) return inner.list as T[];
    if (Array.isArray(inner?.items)) return inner.items as T[];
    if (Array.isArray(inner?.data)) return inner.data as T[];
    return [];
}

function extractDataObject(payload: unknown): Record<string, unknown> {
    const p = payload as Record<string, unknown> | undefined;
    const data = p?.data as Record<string, unknown> | undefined;
    return data ?? p ?? {};
}

function userIdFromUsersQuery(payload: unknown, email: string): string | undefined {
    const needle = email.trim().toLowerCase();
    const users = extractList<UserListItem>(payload);
    const user = users.find((item) => String(item.email ?? "").trim().toLowerCase() === needle) ?? users[0];
    const userId = user?.unique_id ?? user?.user_id;
    return typeof userId === "string" && userId.trim() ? userId.trim() : undefined;
}

async function resolveCurrentUserId(): Promise<string | undefined> {
    const credentials = await readCredentials();
    if (credentials?.user_id?.trim()) return credentials.user_id.trim();

    const email = credentials?.email?.trim();
    if (!email) return undefined;

    try {
        const result = await cawplanRequest({
            method: "POST",
            path: "/api/v1/public/openapi/users/query",
            body: {email},
        });
        return userIdFromUsersQuery(result, email);
    } catch (e) {
        console.error(`Warning: cannot resolve current user_id from ${email}: ${(e as Error).message}`);
        return undefined;
    }
}

async function requireCurrentUserId(): Promise<string> {
    const userId = await resolveCurrentUserId();
    if (userId) return userId;
    throw new Error("current user_id is not available in credentials.json; run: cawplan auth login");
}

function parseISODate(date: string): Date {
    if (!isoDatePattern.test(date)) throw new Error(`invalid date: ${date}`);
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || formatISODate(parsed) !== date) {
        throw new Error(`invalid date: ${date}`);
    }
    return parsed;
}

function formatISODate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function addUTCDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

function monthRangeForBackfill(anchorDate: string, today = new Date()): { dateFrom: string; dateTo: string } {
    const anchor = parseISODate(anchorDate);
    const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
    const todayUTC = parseISODate(formatISODate(today));
    const end = monthEnd.getTime() < todayUTC.getTime() ? monthEnd : todayUTC;
    return {
        dateFrom: formatISODate(first),
        dateTo: formatISODate(end),
    };
}

function dateRangeInclusive(dateFrom: string, dateTo: string): string[] {
    const start = parseISODate(dateFrom);
    const end = parseISODate(dateTo);
    if (start.getTime() > end.getTime()) return [];

    const dates: string[] = [];
    for (let current = start; current.getTime() <= end.getTime(); current = addUTCDays(current, 1)) {
        dates.push(formatISODate(current));
    }
    return dates;
}

function shortRepoName(value?: string): string {
    const raw = (value ?? "").trim();
    if (!raw) return "";
    const parts = raw.replace(/\.git$/, "").split(/[/:]/).filter(Boolean);
    return parts[parts.length - 1] ?? raw;
}

function repoKeys(value?: string): string[] {
    const raw = (value ?? "").trim();
    const short = shortRepoName(raw);
    return [...new Set([raw, short].filter(Boolean).map((v) => v.toLowerCase()))];
}

function repoNameFromGitHubUrl(repoURL: string): string {
    const raw = repoURL.trim();
    if (!raw) throw new Error("GitHub repository URL is required");

    try {
        const url = new URL(raw);
        const isGitHubHost = url.hostname.toLowerCase() === "github.com";
        const parts = url.pathname.replace(/^\//, "").split("/");
        const owner = parts[0] ?? "";
        const repo = parts[1] ?? "";
        const hasRepoPath = parts.length === 2 && owner && repo;
        const validOwner = /^[A-Za-z0-9-]+$/.test(owner);
        const validRepo = /^[A-Za-z0-9._-]+$/.test(repo);

        if (url.protocol === "https:" && isGitHubHost && hasRepoPath && validOwner && validRepo) {
            return repo;
        }
    } catch {
        // Fall through to the consistent error below.
    }

    throw new Error(`Invalid GitHub repository URL: ${repoURL}`);
}

async function listProductRepoMappings(): Promise<ProductRepoMapping[]> {
    const result = await cawplanRequest({
        method: "GET",
        path: "/api/v1/public/openapi/ai-session-usage/product-repo",
    });
    return extractList<ProductRepoMapping>(result).filter((m) => m.product_id && m.repo_name);
}

async function createProductRepoMapping(opts: {
    productId: string;
    repoUrl: string;
    repoName?: string;
}): Promise<ProductRepoMapping> {
    const repoName = opts.repoName?.trim() || repoNameFromGitHubUrl(opts.repoUrl);
    const repoUrl = opts.repoUrl.trim();
    const result = await cawplanRequest({
        method: "POST",
        path: "/api/v1/public/openapi/ai-session-usage/product-repo",
        body: {
            product_id: opts.productId,
            repo_name: repoName,
            repo_url: repoUrl,
        },
    });
    const created = ((result as { data?: unknown }).data ?? result) as ProductRepoMapping;
    return {
        ...created,
        product_id: created.product_id ?? opts.productId,
        repo_name: created.repo_name ?? repoName,
        repo_url: created.repo_url ?? repoUrl,
    };
}

function toProductChoices(result: unknown): ProductChoice[] {
    return extractList<ProductListItem>(result)
        .filter((p) => p.unique_id && p.name)
        .map((p) => ({
            product_id: String(p.unique_id),
            product_name: String(p.name),
        }))
        .sort((a, b) => a.product_name.localeCompare(b.product_name));
}

async function listProductsForSelector(): Promise<ProductChoice[]> {
    return toProductChoices(await listProducts({pageSize: "100"}));
}

async function searchProduct(products: ProductChoice[], message: string): Promise<ProductChoice> {
    return search<ProductChoice>({
        message,
        source: (term) => {
            const needle = (term ?? "").trim().toLowerCase();
            const filtered = needle
                ? products.filter((p) =>
                    p.product_name.toLowerCase().includes(needle)
                )
                : products;
            return [
                ...filtered.slice(0, 10).map((p) => ({
                    name: p.product_name,
                    value: p,
                    description: p.product_id,
                })),
            ];
        },
        pageSize: 10,
    });
}

function findMappingForProject(project: string, mappings: ProductRepoMapping[]): ProductRepoMapping | undefined {
    const keys = new Set(repoKeys(project));
    return mappings.find((mapping) => repoKeys(mapping.repo_name).some((key) => keys.has(key)));
}

function findMappingForProductRepo(
    productId: string,
    repoName: string,
    mappings: ProductRepoMapping[]
): ProductRepoMapping | undefined {
    const keys = new Set(repoKeys(repoName));
    return mappings.find((mapping) =>
        mapping.product_id === productId &&
        repoKeys(mapping.repo_name).some((key) => keys.has(key))
    );
}

function readDailyReport(path: string): DailyApiJson {
    try {
        const daily = JSON.parse(readFileSync(path, "utf-8")) as DailyApiJson;
        if (!daily?.author || !daily.date || !Array.isArray(daily.sessions)) {
            throw new Error("daily report must contain author, date, and sessions");
        }
        return daily;
    } catch (e) {
        throw new Error(`cannot read ${path}: ${(e as Error).message}`);
    }
}

function findSessionById(daily: DailyApiJson, sessionId: string): DailySession {
    const session = daily.sessions.find((s) => s.session_id === sessionId);
    if (!session) throw new Error(`session not found: ${sessionId}`);
    return session;
}

function findProductById(products: ProductChoice[], productId: string): ProductChoice {
    const product = products.find((p) => p.product_id === productId);
    if (!product) throw new Error(`product not found: ${productId}`);
    return product;
}

function missingProductSessionLabels(daily: DailyApiJson): string[] {
    return daily.sessions
        .filter((session) => !session.product_id)
        .map((session) => session.session_title ?? session.session_name ?? session.session_id);
}

function assertAllSessionsHaveProduct(daily: DailyApiJson): void {
    const missing = missingProductSessionLabels(daily);
    if (missing.length === 0) return;
    throw new Error(`product is required for every session; missing: ${missing.join(", ")}`);
}

function warnMissingProductAssignment(file: string, daily: DailyApiJson): boolean {
    const missing = missingProductSessionLabels(daily);
    if (missing.length === 0) return false;
    console.error(
        `Product assignment is incomplete for ${missing.length} session(s) in ${file}: ${missing.join(", ")}`
    );
    console.error(`Please complete product assignment before uploading: cawplan ai-session assign --file ${file} --web`);
    console.error(`TTY alternative: cawplan ai-session assign --file ${file} --tty`);
    return true;
}

function updateReposForSelectedMapping(
    repos: DailyApiJson["repos"] | undefined,
    originalProject: string,
    mapping: ProductRepoMapping
): number {
    if (!Array.isArray(repos)) return 0;
    const originalKeys = new Set(repoKeys(originalProject));
    const selectedKeys = new Set(repoKeys(mapping.repo_name));
    let updated = 0;
    for (const repo of repos) {
        const keys = repoKeys(repo.repo_name ?? repo.repo);
        const matched = keys.some((key) => originalKeys.has(key) || selectedKeys.has(key));
        if (!matched) continue;
        repo.repo_name = mapping.repo_name;
        repo.repo_url = mapping.repo_url;
        repo.product_id = mapping.product_id;
        repo.product_name = mapping.product_name;
        updated++;
    }
    return updated;
}

function applyProductRepoMapping(
    daily: DailyApiJson,
    session: DailySession,
    mapping: ProductRepoMapping
): void {
    if (!mapping.product_id) throw new Error("product_id is required");

    const originalProject = (session.project ?? "").trim();
    if (mapping.repo_name) {
        session.project = mapping.repo_name;
        updateReposForSelectedMapping(daily.repos, originalProject, mapping);
        const updatedSessionRepos = updateReposForSelectedMapping(session.repos_touched, originalProject, mapping);
        if (updatedSessionRepos === 0 && session.repos_touched.length === 1) {
            session.repos_touched[0].repo_name = mapping.repo_name;
            session.repos_touched[0].repo_url = mapping.repo_url;
            session.repos_touched[0].product_id = mapping.product_id;
            session.repos_touched[0].product_name = mapping.product_name;
        }
    }
    session.product_id = mapping.product_id;
    session.product_name = mapping.product_name;
}

function applyProductRepoMappingToProject(
    daily: DailyApiJson,
    session: DailySession,
    mapping: ProductRepoMapping
): number {
    const originalProject = (session.project ?? "").trim();
    const originalKeys = new Set(repoKeys(originalProject));
    let updated = 1;

    applyProductRepoMapping(daily, session, mapping);

    if (!originalKeys.size) return updated;

    for (const candidate of daily.sessions) {
        if (candidate === session || candidate.product_id) continue;

        const candidateKeys = repoKeys(candidate.project);
        const sameProject = candidateKeys.some((key) => originalKeys.has(key));
        if (!sameProject) continue;

        applyProductRepoMapping(daily, candidate, mapping);
        updated++;
    }

    return updated;
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

function localAssignmentHtml(): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CawPlan AI Session Assignment</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 24px; }
    h1 { margin-bottom: 8px; }
    .muted { color: #777; margin-top: 0; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; table-layout: fixed; }
    col.session-col { width: 20%; }
    col.human-inputs-col { width: 30%; }
    col.product-col { width: 20%; }
    col.repo-col { width: 30%; }
    th, td { border-bottom: 1px solid #ddd; padding: 10px; text-align: left; vertical-align: top; }
    th { position: sticky; top: 0; background: Canvas; }
    input, select, button { font: inherit; padding: 6px 8px; }
    input, select { width: 100%; box-sizing: border-box; }
    .session-title { font-weight: 600; }
    .session-meta { color: #777; font-size: 12px; margin-top: 4px; }
    .human-inputs { margin: 0; padding-left: 18px; color: #555; font-size: 12px; }
    .human-inputs li { margin-bottom: 4px; overflow-wrap: anywhere; }
    .repo-url { margin-top: 8px; }
    .required { color: #b42318; }
    .field-error { color: #b42318; font-size: 12px; margin-top: 4px; }
    tr.invalid-product input.product { border-color: #b42318; outline-color: #b42318; }
    .hidden { display: none; }
    .actions { margin-top: 16px; display: flex; justify-content: flex-end; gap: 8px; align-items: center; }
    .status { color: #777; }
  </style>
</head>
<body>
  <h1>CawPlan AI Session Assignment</h1>
  <p class="muted">Assign each session to a product and optional repository, then save the updated daily report.</p>
  <datalist id="product-list"></datalist>
  <table>
    <colgroup>
      <col class="session-col" />
      <col class="human-inputs-col" />
      <col class="product-col" />
      <col class="repo-col" />
    </colgroup>
    <thead>
      <tr><th>Session</th><th>Human Inputs</th><th>Product <span class="required">*</span></th><th>Repo</th></tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="actions">
    <span id="status" class="status">Loading...</span>
    <button id="save">Save assignments</button>
    <button id="close">Close</button>
  </div>
  <script>
    const token = new URLSearchParams(location.search).get('token') || '';
    const api = (path, options = {}) => fetch(path + '?token=' + encodeURIComponent(token), {
      ...options,
      headers: {'content-type': 'application/json', ...(options.headers || {})},
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    });

    let report;
    let products = [];
    let mappings = [];

    function productLabel(product) {
      return product.product_name || product.name || product.product_id || product.unique_id || '';
    }

    function normalizeProducts(items) {
      return items.map((p) => ({
        product_id: p.product_id || p.unique_id,
        product_name: p.product_name || p.name || p.product_id || p.unique_id,
      })).filter((p) => p.product_id && p.product_name);
    }

    function findProduct(value) {
      const needle = String(value || '').trim().toLowerCase();
      if (!needle) return null;
      return products.find((p) =>
        String(p.product_id).toLowerCase() === needle ||
        String(p.product_name).toLowerCase() === needle
      ) || null;
    }

    function repoNameFromGitHubUrl(value) {
      const match = String(value || '').trim().match(/^https:\\/\\/github\\.com\\/([^/]+)\\/([^/]+)$/);
      return match ? match[1] + '/' + match[2] : '';
    }

    function pendingMappingKey(productId, repoName) {
      return productId + '::' + repoName;
    }

    function upsertPendingMapping(product, repoUrl) {
      const repoName = repoNameFromGitHubUrl(repoUrl);
      if (!repoName) return null;
      let mapping = mappings.find((m) => m.product_id === product.product_id && m.repo_name === repoName);
      if (mapping) {
        mapping.repo_url = repoUrl;
        mapping.pending = true;
        return mapping;
      }
      mapping = {
        product_id: product.product_id,
        product_name: product.product_name,
        repo_name: repoName,
        repo_url: repoUrl,
        pending: true,
      };
      mappings.push(mapping);
      return mapping;
    }

    function repoOptions(productId, selectedRepo) {
      const opts = mappings
        .filter((m) => m.product_id === productId && m.repo_name)
        .sort((a, b) => String(a.repo_name).localeCompare(String(b.repo_name)))
        .map((m) => '<option value="' + escapeHtml(m.repo_name) + '"' +
          (m.repo_name === selectedRepo ? ' selected' : '') + '>' +
          escapeHtml(m.repo_url || m.repo_name) + '</option>');
      opts.unshift('<option value="">No repository; assign product only</option>');
      opts.push('<option value="__link__">No repository; link one</option>');
      return opts.join('');
    }

    function repoCandidates(session) {
      const values = [session.project];
      for (const repo of session.repos_touched || []) {
        values.push(repo.repo_name, repo.repo);
      }
      return values.filter(Boolean).map((value) => String(value).toLowerCase());
    }

    function selectedRepoForSession(session) {
      if (!session.product_id) return '';
      const candidates = repoCandidates(session);
      const mapping = mappings.find((m) =>
        m.product_id === session.product_id &&
        m.repo_name &&
        candidates.includes(String(m.repo_name).toLowerCase())
      );
      return mapping ? mapping.repo_name : '';
    }

    function updateRepoUrlInput(row) {
      const repo = row.querySelector('.repo');
      const repoUrl = row.querySelector('.repo-url');
      repoUrl.classList.toggle('hidden', repo.value !== '__link__');
      repoUrl.required = repo.value === '__link__';
    }

    function refreshRepoOptionsForProduct(productId) {
      document.querySelectorAll('tbody tr').forEach((row) => {
        const product = findProduct(row.querySelector('.product').value);
        if (!product || product.product_id !== productId) return;
        const repo = row.querySelector('.repo');
        const selected = repo.value;
        repo.innerHTML = repoOptions(productId, selected);
        repo.value = selected;
        updateRepoUrlInput(row);
      });
    }

    function addLinkedRepoFromRow(row) {
      const product = findProduct(row.querySelector('.product').value);
      if (!product) return;
      const repoUrl = row.querySelector('.repo-url').value.trim();
      const mapping = upsertPendingMapping(product, repoUrl);
      if (!mapping) return;
      refreshRepoOptionsForProduct(product.product_id);
    }

    function validateProductRow(row) {
      const productInput = row.querySelector('.product');
      const product = findProduct(productInput.value);
      const error = row.querySelector('.product-error');
      const valid = Boolean(product);
      row.classList.toggle('invalid-product', !valid);
      productInput.setCustomValidity(valid ? '' : 'Product is required. Choose a product from the list.');
      error.textContent = valid ? '' : 'Required: choose a product from the list.';
      return valid;
    }

    function validateProducts() {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      const invalid = rows.filter((row) => !validateProductRow(row));
      if (invalid.length > 0) {
        invalid[0].querySelector('.product').reportValidity();
        invalid[0].scrollIntoView({block: 'center', behavior: 'smooth'});
        throw new Error('Product is required for every session.');
      }
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function humanInputContent(input) {
      if (typeof input === 'string') return input;
      return input && (input.content || input.raw_block || input.topic || '');
    }

    function humanInputsForSession(session) {
      const direct = Array.isArray(session.human_inputs) ? session.human_inputs : [];
      const all = Array.isArray(report.human_inputs) ? report.human_inputs : [];
      const sessionTitles = new Set([session.session_title, session.session_name, session.title, session.session_id].filter(Boolean));
      const matched = all.filter((input) => {
        if (!input || typeof input !== 'object') return false;
        if (input.session_title && sessionTitles.has(input.session_title)) return true;
        return Boolean(
          input.project &&
          session.project &&
          input.project === session.project &&
          (!input.session_agent || input.session_agent === session.agent)
        );
      });
      return direct.length > 0 ? direct : matched;
    }

    function humanInputsHtml(session) {
      const inputs = humanInputsForSession(session).map(humanInputContent).filter(Boolean).slice(0, 3);
      if (inputs.length === 0) return '<span class="muted">No human inputs</span>';
      return '<ol class="human-inputs">' + inputs.map((input) => '<li>' + escapeHtml(input) + '</li>').join('') + '</ol>';
    }

    function sessionStartMs(session) {
      const value = session.time_range && session.time_range.start;
      const ms = value ? Date.parse(value) : NaN;
      return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
    }

    function sessionCost(session) {
      if (typeof session.session_cost === 'number') return session.session_cost;
      const buckets = Array.isArray(session.usage_breakdown) ? session.usage_breakdown : [];
      return buckets.reduce((sum, bucket) => sum + (typeof bucket.cost === 'number' ? bucket.cost : 0), 0);
    }

    function sessionCostText(session) {
      const cost = sessionCost(session);
      return cost > 0 ? '$' + cost.toFixed(2) : 'Cost unknown';
    }

    function render() {
      const productList = document.getElementById('product-list');
      productList.innerHTML = products.map((p) => '<option value="' + escapeHtml(p.product_name) + '"></option>').join('');
      const tbody = document.getElementById('rows');
      const sessions = [...report.sessions].sort((a, b) => sessionStartMs(a) - sessionStartMs(b));
      tbody.innerHTML = sessions.map((s) => {
        const title = s.session_title || s.session_name || s.session_id;
        const currentProduct = products.find((p) => p.product_id === s.product_id);
        const productValue = currentProduct ? currentProduct.product_name : (s.product_name || '');
        const selectedRepo = selectedRepoForSession(s);
        return '<tr data-session-id="' + escapeHtml(s.session_id) + '">' +
          '<td><div class="session-title">' + escapeHtml(title) + '</div>' +
          '<div class="session-meta">' + escapeHtml([s.agent, s.time_range && s.time_range.display, sessionCostText(s), s.project].filter(Boolean).join(' | ')) + '</div></td>' +
          '<td>' + humanInputsHtml(s) + '</td>' +
          '<td><input class="product" list="product-list" value="' + escapeHtml(productValue) + '" placeholder="Search product" required />' +
          '<div class="product-error field-error"></div></td>' +
          '<td><select class="repo">' + repoOptions(s.product_id, selectedRepo) + '</select>' +
          '<input class="repo-url hidden" type="url" placeholder="https://github.com/owner/repo" pattern="https://github\\.com/[^/]+/[^/]+" /></td>' +
          '</tr>';
      }).join('');
      document.querySelectorAll('.product').forEach((el) => {
        el.addEventListener('change', () => {
          const tr = el.closest('tr');
          const session = report.sessions.find((s) => s.session_id === tr.dataset.sessionId);
          const product = findProduct(el.value);
          const repo = tr.querySelector('.repo');
          session.product_id = product ? product.product_id : undefined;
          session.product_name = product ? product.product_name : undefined;
          repo.innerHTML = repoOptions(session.product_id, session.project);
          updateRepoUrlInput(tr);
          validateProductRow(tr);
        });
      });
      document.querySelectorAll('.repo').forEach((el) => {
        const tr = el.closest('tr');
        updateRepoUrlInput(tr);
        el.addEventListener('change', () => updateRepoUrlInput(tr));
      });
      document.querySelectorAll('.repo-url').forEach((el) => {
        const tr = el.closest('tr');
        el.addEventListener('change', () => addLinkedRepoFromRow(tr));
        el.addEventListener('blur', () => addLinkedRepoFromRow(tr));
      });
    }

    async function load() {
      const [reportData, productData, mappingData] = await Promise.all([
        api('/api/report'),
        api('/api/products'),
        api('/api/product-repos'),
      ]);
      report = reportData.report;
      products = normalizeProducts(productData.products || []);
      mappings = mappingData.mappings || [];
      render();
      document.getElementById('status').textContent = 'Ready';
    }

    async function save() {
      validateProducts();
      const assignments = [];
      const pendingMappingsToCreate = new Set();
      for (const tr of document.querySelectorAll('tbody tr')) {
        const sessionId = tr.dataset.sessionId;
        const product = findProduct(tr.querySelector('.product').value);
        if (!product) {
          const title = tr.querySelector('.session-title').textContent || sessionId;
          throw new Error('Product is required for session: ' + title);
        }
        const repoValue = tr.querySelector('.repo').value;
        let repoUrl;
        let linkedRepoName;
        if (repoValue === '__link__') {
          repoUrl = tr.querySelector('.repo-url').value.trim();
          if (!repoUrl) {
            throw new Error('GitHub repository URL is required when linking a repository.');
          }
          linkedRepoName = repoNameFromGitHubUrl(repoUrl);
          if (!linkedRepoName) {
            throw new Error('GitHub repository URL must be in the format https://github.com/owner/repo.');
          }
        }
        const mapping = mappings.find((m) => m.product_id === product.product_id && m.repo_name === repoValue);
        const createKey = repoValue === '__link__' && linkedRepoName
          ? pendingMappingKey(product.product_id, linkedRepoName)
          : mapping && mapping.pending
            ? pendingMappingKey(mapping.product_id, mapping.repo_name)
            : '';
        const createMapping = Boolean(createKey && !pendingMappingsToCreate.has(createKey));
        if (createMapping) pendingMappingsToCreate.add(createKey);
        assignments.push({
          session_id: sessionId,
          product_id: product.product_id,
          product_name: product.product_name,
          repo_name: mapping ? mapping.repo_name : linkedRepoName,
          repo_url: repoUrl || (mapping ? mapping.repo_url : undefined),
          create_mapping: createMapping,
        });
      }
      document.getElementById('status').textContent = 'Saving...';
      const result = await api('/api/assignments', {method: 'POST', body: JSON.stringify({assignments})});
      document.getElementById('status').textContent = 'Saved ' + result.assigned_sessions + ' session(s). Closing server...';
      alert('Saved assignments to ' + result.file);
      await api('/api/close', {method: 'POST'});
      window.close();
    }

    document.getElementById('save').addEventListener('click', () => save().catch((e) => alert(e.message)));
    document.getElementById('close').addEventListener('click', () => api('/api/close', {method: 'POST'}).then(() => window.close()).catch((e) => alert(e.message)));
    load().catch((e) => document.getElementById('status').textContent = e.message);
  </script>
</body>
</html>`;
}

interface WebAssignment {
    session_id?: string;
    product_id?: string;
    product_name?: string;
    repo_name?: string;
    repo_url?: string;
    create_mapping?: boolean;
}

async function applyWebAssignments(
    daily: DailyApiJson,
    assignments: WebAssignment[]
): Promise<number> {
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
            if (!assignment.repo_url) throw new Error(`repo_url is required to create a mapping for session ${assignment.session_id}`);
            mapping = {
                ...(await createProductRepoMapping({
                    productId: assignment.product_id,
                    repoUrl: assignment.repo_url,
                })),
                product_name: assignment.product_name,
            };
        }

        applyProductRepoMapping(daily, session, mapping);
        assigned++;
    }
    return assigned;
}

async function uploadDailyReport(payload: DailyApiJson): Promise<unknown> {
    return cawplanRequest({
        method: "POST",
        path: "/api/v1/public/openapi/ai-session-usage/reports",
        body: payload,
    });
}

function reportItemsFromResponse(payload: unknown): AiSessionReportItem[] {
    const data = extractDataObject(payload);
    if (Array.isArray(data.items)) return data.items as AiSessionReportItem[];
    return extractList<AiSessionReportItem>(payload);
}

function totalFromReportsResponse(payload: unknown): number | undefined {
    const total = extractDataObject(payload).total;
    return typeof total === "number" ? total : undefined;
}

async function listMonthlyReportItems(dateFrom: string, dateTo: string, userId?: string): Promise<AiSessionReportItem[]> {
    const items: AiSessionReportItem[] = [];
    const limit = 100;
    for (let offset = 0; ; offset += limit) {
        const query: Record<string, string> = {
            date_from: dateFrom,
            date_to: dateTo,
            limit: String(limit),
            offset: String(offset),
        };
        if (userId) query.user_id = userId;
        const result = await cawplanRequest({
            method: "GET",
            path: "/api/v1/public/openapi/ai-session-usage/reports",
            query,
        });
        const pageItems = reportItemsFromResponse(result);
        items.push(...pageItems);
        const total = totalFromReportsResponse(result);
        if (pageItems.length < limit || (total != null && items.length >= total)) break;
    }
    return items;
}

async function autoAssignProjectsFromCloudMappings(daily: DailyApiJson): Promise<number> {
    const mappings = await listProductRepoMappings();
    let matched = 0;
    for (const session of daily.sessions) {
        if (session.product_id) continue;
        const mapping = findMappingForProject(session.project, mappings);
        if (!mapping?.repo_name || !mapping.product_id) continue;
        applyProductRepoMapping(daily, session, mapping);
        matched++;
    }
    return matched;
}

async function collectOrReadDailyReport(date: string): Promise<{
    daily: DailyApiJson;
    file: string;
    created: boolean
}> {
    const file = `ai-daily-${date}.json`;
    if (existsSync(file)) {
        return {
            daily: readDailyReport(file),
            file,
            created: false,
        };
    }

    const daily = await collect({
        date,
        outputPath: file,
    });
    return {
        daily,
        file,
        created: true,
    };
}

async function backfillMissingMonthlyReports(anchorPayload: DailyApiJson): Promise<{
    checked_dates: string[];
    missing_dates: string[];
    uploaded_dates: string[];
    skipped_dates: string[];
}> {
    const reporterKey = anchorPayload.author;
    const {dateFrom, dateTo} = monthRangeForBackfill(anchorPayload.date);
    const expectedDates = dateRangeInclusive(dateFrom, dateTo);
    const userId = await requireCurrentUserId();
    console.error(`Checking missing AI daily reports for user_id ${userId} from ${dateFrom} to ${dateTo}...`);
    const reports = await listMonthlyReportItems(dateFrom, dateTo, userId);
    const existingDates = new Set(
        reports
            .filter((item) => item.user_id === userId)
            .map((item) => item.date)
            .filter((date): date is string => Boolean(date))
    );
    existingDates.add(anchorPayload.date);

    const missingDates = expectedDates.filter((date) => !existingDates.has(date));
    const uploadedDates: string[] = [];
    const skippedDates: string[] = [];

    for (const date of missingDates) {
        try {
            console.error(`Backfilling missing AI daily report for ${date}...`);
            const {daily, file, created} = await collectOrReadDailyReport(date);
            if (!daily.author || !daily.date) {
                throw new Error(`${file} must contain author and date`);
            }
            if (daily.author !== reporterKey) {
                console.error(`Skipping ${date}: report author ${daily.author} does not match uploaded reporter ${reporterKey}.`);
                skippedDates.push(date);
                continue;
            }
            const assigned = await autoAssignProjectsFromCloudMappings(daily);
            if (assigned > 0 || created) {
                writeFileSync(file, JSON.stringify(daily, null, 2), "utf-8");
            }
            if (warnMissingProductAssignment(file, daily)) {
                console.error(`Skipping upload for ${date} until product assignment is complete.`);
                skippedDates.push(date);
                continue;
            }
            await uploadDailyReport(daily);
            uploadedDates.push(date);
            console.error(`Backfilled ${date} from ${file}.`);
        } catch (e) {
            skippedDates.push(date);
            console.error(`Failed to backfill ${date}: ${(e as Error).message}`);
        }
    }

    return {
        checked_dates: expectedDates,
        missing_dates: missingDates,
        uploaded_dates: uploadedDates,
        skipped_dates: skippedDates,
    };
}

async function startAssignmentWebServer(filePath: string, daily: DailyApiJson): Promise<void> {
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
                    sendText(res, 200, localAssignmentHtml(), "text/html; charset=utf-8");
                    return;
                }

                if (req.method === "GET" && url.pathname === "/api/report") {
                    sendJson(res, 200, {report: daily});
                    return;
                }

                if (req.method === "GET" && url.pathname === "/api/products") {
                    sendJson(res, 200, {products: await listProductsForSelector()});
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
                        repo_name?: string
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
                    const body = await readJsonBody<{ assignments?: WebAssignment[] }>(req);
                    if (!Array.isArray(body.assignments)) throw new Error("assignments must be an array");
                    const assignedSessions = await applyWebAssignments(daily, body.assignments);
                    assertAllSessionsHaveProduct(daily);
                    writeFileSync(filePath, JSON.stringify(daily, null, 2), "utf-8");
                    sendJson(res, 200, {
                        file: filePath,
                        assigned_sessions: assignedSessions,
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

async function assignProjectsFromCloudMappings(daily: DailyApiJson): Promise<number> {

    const sessions = daily.sessions;
    if (!Array.isArray(sessions) || sessions.length === 0) {
        console.error("No sessions found in the collected report; skipping product assignment.");
        return 0;
    }

    let matched = 0;
    let skippedInteractiveSelection = 0;
    const mappings = await listProductRepoMappings();

    const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const products = canPrompt ? await listProductsForSelector() : [];
    if (canPrompt && products.length === 0) throw new Error("No products returned from cawplan products list");

    for (const [index, session] of sessions.entries()) {
        if (session.product_id) continue;

        const originalProject = (session.project ?? "").trim();
        const sessionLabel = session.session_name ?? session.session_title ?? session.session_id ?? `session ${index + 1}`;
        const inferredMapping = findMappingForProject(originalProject, mappings);
        if (inferredMapping?.repo_name && inferredMapping.product_id) {
            matched += applyProductRepoMappingToProject(daily, session, inferredMapping);
            console.error(`Auto-assigned session "${sessionLabel}" to ${inferredMapping.product_name ?? inferredMapping.product_id} / ${inferredMapping.repo_name}`);
            continue;
        }

        if (!canPrompt) {
            skippedInteractiveSelection++;
            continue;
        }

        const product = await searchProduct(
            products,
            `Select product for session "${sessionLabel}"${originalProject ? ` (project: ${originalProject})` : ""}`
        );
        if (!product.product_id) continue;

        const productMappings = mappings
            .filter((m) => m.product_id === product.product_id && m.repo_name)
            .sort((a, b) => String(a.repo_name).localeCompare(String(b.repo_name)));
        let mapping = await select<ProductRepoSelection>({
            message: `Select repository for session "${sessionLabel}"`,
            choices: [
                ...productMappings.map((m) => ({
                    name: String(m.repo_name),
                    value: m,
                    description: m.repo_url ?? m.product_name ?? m.product_id,
                })),
                {
                    name: "No repository; link one",
                    value: {
                        product_id: product.product_id,
                        product_name: product.product_name,
                        create_from_url: true,
                    },
                },
                {
                    name: "No repository; assign product only",
                    value: {
                        product_id: product.product_id,
                        product_name: product.product_name,
                    },
                },
            ],
            pageSize: 15,
        });
        if (mapping.create_from_url) {
            const repoURL = await input({
                message: `GitHub repository URL for session "${sessionLabel}"`,
                validate: (value) => {
                    try {
                        repoNameFromGitHubUrl(value);
                        return true;
                    } catch (e) {
                        return (e as Error).message;
                    }
                },
            });
            mapping = {
                ...(await createProductRepoMapping({
                    productId: product.product_id,
                    repoUrl: repoURL,
                })),
                product_name: product.product_name,
            };
            mappings.push(mapping);
        }
        if (!mapping.product_id) continue;

        matched += applyProductRepoMappingToProject(daily, session, mapping);
    }

    if (skippedInteractiveSelection > 0) {
        console.error(
            `Skipped product/repository selection for ${skippedInteractiveSelection} session(s) because collect is running without an interactive TTY.`
        );
        console.error(
            `To complete selector-based assignment, run: cawplan ai-session collect --date ${daily.date}`
        );
    }

    return matched;
}

export function registerAiSessionCommand(program: Command): void {
    const ai = program.command("ai-session").description("AI coding session usage");

    // ── Collect ──────────────────────────────────────────────────────────────────

    ai.command("collect")
        .description("Collect AI coding session data from local agents and write ai-daily-<date>.json")
        .option("--date <YYYY-MM-DD>", "Date to collect (default: today)")
        .option(
            "--agent <name>",
            "Agent(s) to collect from: claude-code, cursor, codex (repeatable)",
            (val: string, prev: string[]) => [...prev, val],
            [] as string[]
        )
        .option("--output <path>", "Output file path (default: ./ai-daily-<date>.json)")
        .action(async (opts) => {
            const date = opts.date ?? new Date().toISOString().slice(0, 10);
            const outputPath: string = opts.output ?? `ai-daily-${date}.json`;
            const agents =
                opts.agent && opts.agent.length > 0
                    ? (opts.agent as AiSessionAgent[])
                    : undefined;

            console.error(`Collecting AI session data for ${date}...`);
            try {
                const daily = await collect({
                    date,
                    agents,
                    outputPath,
                });
                console.error(
                    `Collected ${
                        (daily.totals as { sessions?: number })?.sessions ?? 0
                    } sessions from agents: ${
                        ((daily.totals as { agents?: string[] })?.agents ?? []).join(", ") || "none"
                    }`
                );

                // manually specify the product and repo
                const matched = await assignProjectsFromCloudMappings(daily);
                writeFileSync(outputPath, JSON.stringify(daily, null, 2), "utf-8");
                console.error(`Product/project assignment written for ${matched} sessions.`);
                warnMissingProductAssignment(outputPath, daily);

                console.error(`Output written to ${outputPath}`);
                console.log(JSON.stringify(daily, null, 2));
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });

    // ── Product assignment ───────────────────────────────────────────────────────

    ai.command("products")
        .description("List CawPlan products for report assignment")
        .option("--q <text>", "Filter products by name")
        .action(async (opts) => {
            try {
                const needle = String(opts.q ?? "").trim().toLowerCase();
                const products = toProductChoices(await listProducts({search: String(opts.q ?? ""), pageSize: "100"}))
                    .filter((product) => !needle || product.product_name.toLowerCase().includes(needle));
                console.log(JSON.stringify({products}, null, 2));
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });

    const productRepos = ai.command("product-repos")
        .description("List product-repository mappings for report assignment")
        .option("--product-id <id>", "Filter mappings by product unique_id")
        .option("--q <text>", "Filter mappings by repo name or URL")
        .action(async (opts) => {
            try {
                const needle = String(opts.q ?? "").trim().toLowerCase();
                const mappings = (await listProductRepoMappings())
                    .filter((mapping) => !opts.productId || mapping.product_id === opts.productId)
                    .filter((mapping) => {
                        if (!needle) return true;
                        return [mapping.repo_name, mapping.repo_url, mapping.product_name]
                            .filter(Boolean)
                            .some((value) => String(value).toLowerCase().includes(needle));
                    })
                    .sort((a, b) =>
                        `${a.product_name ?? ""}/${a.repo_name ?? ""}`.localeCompare(
                            `${b.product_name ?? ""}/${b.repo_name ?? ""}`
                        )
                    );
                console.log(JSON.stringify({mappings}, null, 2));
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });

    productRepos
        .command("create")
        .description("Create a product-repository mapping for report assignment")
        .requiredOption("--product-id <id>", "Product unique_id")
        .requiredOption("--repo-url <url>", "GitHub repository URL")
        .option("--repo-name <name>", "Repository name; inferred from --repo-url when omitted")
        .action(async (opts) => {
            try {
                const mapping = await createProductRepoMapping({
                    productId: String(opts.productId),
                    repoUrl: String(opts.repoUrl),
                    repoName: opts.repoName ? String(opts.repoName) : undefined,
                });
                console.log(JSON.stringify({mapping}, null, 2));
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });

    ai.command("assign")
        .description("Assign report sessions to products and optional repositories")
        .requiredOption("--file <path>", "Path to ai-daily JSON file")
        .option("--session-id <id>", "Session ID to assign")
        .option("--product-id <id>", "Product unique_id")
        .option("--repo-name <name>", "Existing product-repo repo_name to assign")
        .option("--repo-url <url>", "GitHub repository URL to create and assign")
        .option("--create-mapping", "Create product-repo mapping from --repo-url before assigning")
        .option("--tty", "Assign sessions using cloud mappings and interactive selector when available")
        .option("--web", "Assign sessions in a local web page")
        .action(async (opts) => {
            try {
                const daily = readDailyReport(String(opts.file));
                if (opts.web) {
                    await startAssignmentWebServer(String(opts.file), daily);
                    return;
                }

                if (opts.tty) {
                    const assignedSessions = await assignProjectsFromCloudMappings(daily);
                    assertAllSessionsHaveProduct(daily);
                    writeFileSync(String(opts.file), JSON.stringify(daily, null, 2), "utf-8");
                    console.log(JSON.stringify({
                        file: String(opts.file),
                        assigned_sessions: assignedSessions,
                    }, null, 2));
                    return;
                }

                if (!opts.sessionId) throw new Error("--session-id is required unless --tty or --web is set");
                if (!opts.productId) throw new Error("--product-id is required unless --tty or --web is set");
                const session = findSessionById(daily, String(opts.sessionId));
                const products = await listProductsForSelector();
                const product = findProductById(products, String(opts.productId));
                const mappings = await listProductRepoMappings();

                let mapping: ProductRepoMapping = {
                    product_id: product.product_id,
                    product_name: product.product_name,
                };
                let createdMapping = false;

                if (opts.repoUrl) {
                    if (!opts.createMapping) {
                        throw new Error("--repo-url requires --create-mapping so mapping creation is explicit");
                    }
                    mapping = {
                        ...(await createProductRepoMapping({
                            productId: product.product_id,
                            repoUrl: String(opts.repoUrl),
                        })),
                        product_name: product.product_name,
                    };
                    createdMapping = true;
                } else if (opts.repoName) {
                    const existing = findMappingForProductRepo(product.product_id, String(opts.repoName), mappings);
                    if (!existing) {
                        throw new Error(`product-repo mapping not found for product ${product.product_id} and repo ${opts.repoName}`);
                    }
                    mapping = existing;
                }

                const assignedSessions = applyProductRepoMappingToProject(daily, session, mapping);
                writeFileSync(String(opts.file), JSON.stringify(daily, null, 2), "utf-8");
                console.log(JSON.stringify({
                    file: String(opts.file),
                    session_id: session.session_id,
                    session_name: session.session_name,
                    product_id: session.product_id,
                    product_name: session.product_name,
                    repo_name: mapping.repo_name,
                    repo_url: mapping.repo_url,
                    created_mapping: createdMapping,
                    assigned_sessions: assignedSessions,
                }, null, 2));
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });

    // ── Commit ──────────────────────────────────────────────────────────────────

    ai.command("report")
        .description(
            "Upload a daily AI coding session report. Provide --file"
        )
        .requiredOption("--file <path>", "Path to daily.json; must contain 'author' and 'date' fields")
        .option("--no-backfill", "Skip checking and uploading missing reports in the same month")
        .action(async (opts) => {
            let payload: DailyApiJson | undefined;

            try {
                payload = JSON.parse(readFileSync(opts.file, "utf-8")) as DailyApiJson;
            } catch (e) {
                console.error(`Error: cannot read ${opts.file}: ${(e as Error).message}`);
                process.exit(1);
            }

            if (!payload?.author || !payload.date) {
                console.error("Error: daily.json must contain 'author' and 'date' fields");
                process.exit(1);
            }
            if (warnMissingProductAssignment(String(opts.file), payload)) {
                process.exit(1);
            }

            const result = await uploadDailyReport(payload);
            if (opts.backfill === false) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }

            try {
                const backfill = await backfillMissingMonthlyReports(payload);
                console.log(JSON.stringify({result, backfill}, null, 2));
            } catch (e) {
                console.error(`Warning: monthly report backfill skipped: ${(e as Error).message}`);
                console.log(JSON.stringify(result, null, 2));
            }
        });

    addReportQueryOptions(ai.command("reports")
        .description("List uploaded AI daily reports"))
        .action(async (opts) => {
            const query = buildQueryFromFlags({
                ...dateParams(opts),
                ...limitOffsetParams(opts),
                ...(opts.userId ? {user_id: String(opts.userId)} : {}),
            }, ["date", "date_from", "date_to", "user_id", "limit", "offset"]);
            const result = await cawplanRequest({
                method: "GET",
                path: "/api/v1/public/openapi/ai-session-usage/reports",
                query,
            });
            console.log(JSON.stringify(result, null, 2));
        });


    // ── Render ───────────────────────────────────────────────────────────────────

    ai.command("render")
        .description("Render ai-daily JSON with summaries into enriched daily.api.json")
        .option("--input <path>", "Input ai-daily file path", "ai-daily.json")
        .option("--summaries <dir>", "Directory for per-session summaries", "summaries")
        .option("--output <path>", "Output file path", "daily.api.json")
        .action((opts) => {
            const inputPath = String(opts.input ?? "ai-daily.json");
            const summariesDir = String(opts.summaries ?? "summaries");
            const outputPath = String(opts.output ?? "daily.api.json");

            try {
                const daily = JSON.parse(readFileSync(inputPath, "utf-8")) as DailyApiJson;
                const rendered = renderDailyApiJson(daily, summariesDir);
                writeFileSync(outputPath, JSON.stringify(rendered, null, 2), "utf-8");
                console.error(`Rendered report written to ${outputPath}`);
                console.log(JSON.stringify(rendered, null, 2));
            } catch (e) {
                console.error(`Error: ${(e as Error).message}`);
                process.exit(1);
            }
        });

    // ── Insights ─────────────────────────────────────────────────────────────────

    ai.command("overview")
        .description("Workspace-level cost, token, and member overview")
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/overview`,
                query: buildQueryFromFlags(dateParams(opts), ["date", "date_from", "date_to"]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    ai.command("trend")
        .description("Daily cost/token trend over a date range")
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/trend`,
                query: buildQueryFromFlags(dateParams(opts), ["date", "date_from", "date_to"]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    ai.command("by-member")
        .description("Cost and token breakdown by team member")
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/by-member`,
                query: buildQueryFromFlags(dateParams(opts), ["date", "date_from", "date_to"]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    ai.command("by-product")
        .description("Cost and token breakdown by product (requires product-repo mapping)")
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/by-product`,
                query: buildQueryFromFlags(dateParams(opts), ["date", "date_from", "date_to"]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    ai.command("my-sessions")
        .description("Your own session list and overview")
        .option("--user-id <id>", "User unique_id override; defaults to current credentials user_id")
        .option("--date <YYYY-MM-DD>", "Single date")
        .option("--from <YYYY-MM-DD>", "Start date")
        .option("--to <YYYY-MM-DD>", "End date")
        .action(async (opts) => {
            const userId = opts.userId ? String(opts.userId) : await requireCurrentUserId();
            const query = buildQueryFromFlags(dateParams(opts), [...DATE_KEYS]);
            const [overview, sessions] = await Promise.all([
                cawplanRequest({
                    method: "GET",
                    path: `/api/v1/public/openapi/ai-session-usage/user/${userId}/overview`,
                    query
                }),
                cawplanRequest({
                    method: "GET",
                    path: `/api/v1/public/openapi/ai-session-usage/user/${userId}/sessions`,
                    query
                }),
            ]);
            console.log(JSON.stringify({overview, sessions}, null, 2));
        });

    // ── Workspace breakdown dimensions ──────────────────────────────────────────

    addDatePageOptions(ai.command("by-model")
        .description("Cost and token breakdown by AI model"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/by-model`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(ai.command("by-model-dimension")
        .description("Cost breakdown by model + dimension (input/output/cache)"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/by-model-dimension`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(ai.command("by-agent")
        .description("Cost breakdown by AI coding agent (Claude Code, Cursor, etc.)"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/by-agent`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(ai.command("by-project")
        .description("Cost breakdown by git project/repository"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/by-project`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    // ── Utility ──────────────────────────────────────────────────────────────────

    ai.command("dates")
        .description("List all dates that have session data")
        .action(async () => {
            const result = await cawplanRequest({method: "GET", path: `/api/v1/public/openapi/ai-session-usage/dates`});
            console.log(JSON.stringify(result, null, 2));
        });

    ai.command("members")
        .description("List all members who have session data")
        .action(async () => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/members`
            });
            console.log(JSON.stringify(result, null, 2));
        });

    ai.command("member-detail")
        .description("Full detail for a specific member")
        .requiredOption("--member <name>", "Member name (git username)")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/member-detail`,
                query: {member: opts.member},
            });
            console.log(JSON.stringify(result, null, 2));
        });

    // ── Human Input (Prompt) analysis ────────────────────────────────────────────

    addDateOptions(ai.command("human-input-summary")
        .description("Workspace prompt quality summary: categories, topics, quality distribution"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/human-input-summary`,
                query: buildQueryFromFlags(dateParams(opts), [...DATE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDateOptions(ai.command("human-inputs")
        .description("Paginated list of individual prompts with filtering"))
        .option("--member <name>", "Filter by member")
        .option("--product <name>", "Filter by product")
        .option("--category <name>", "Filter by category")
        .option("--topic <name>", "Filter by topic")
        .option("--q <text>", "Full-text search")
        .option("--needs-review", "Only show prompts flagged for review")
        .option("--limit <n>", "Max results (default 25)", parseInt)
        .option("--offset <n>", "Pagination offset", parseInt)
        .action(async (opts) => {
            const query: Record<string, string> = {...dateParams(opts)};
            if (opts.member) query.member = opts.member;
            if (opts.product) query.product = opts.product;
            if (opts.category) query.category = opts.category;
            if (opts.topic) query.topic = opts.topic;
            if (opts.q) query.q = opts.q;
            if (opts.needsReview) query.needs_review = "true";
            if (opts.limit != null) query.limit = String(opts.limit);
            if (opts.offset != null) query.offset = String(opts.offset);
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/human-inputs`,
                query,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDateOptions(ai.command("human-input-quality")
        .description("Prompt quality score distribution across the workspace"))
        .option("--limit <n>", "Max samples (default 100)", parseInt)
        .action(async (opts) => {
            const query: Record<string, string> = {...dateParams(opts)};
            if (opts.limit != null) query.limit = String(opts.limit);
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/human-input-quality`,
                query,
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(ai.command("human-input-by-product")
        .description("Prompt count and quality breakdown by product"))
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/human-input-by-product`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    // ── Product-scoped views ──────────────────────────────────────────────────────

    addDateOptions(ai.command("product-overview")
        .description("Cost and token overview scoped to a specific product"))
        .requiredOption("--product-id <id>", "Product unique_id")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/product/${opts.productId}/overview`,
                query: buildQueryFromFlags(dateParams(opts), [...DATE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(ai.command("product-trend")
        .description("Daily cost/token trend for a specific product"))
        .requiredOption("--product-id <id>", "Product unique_id")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/product/${opts.productId}/trend`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(ai.command("product-by-member")
        .description("Per-member cost breakdown for a specific product"))
        .requiredOption("--product-id <id>", "Product unique_id")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/product/${opts.productId}/by-member`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDatePageOptions(ai.command("product-by-model")
        .description("Per-model cost breakdown for a specific product"))
        .requiredOption("--product-id <id>", "Product unique_id")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/product/${opts.productId}/by-model`,
                query: buildQueryFromFlags({...dateParams(opts), ...pageParams(opts)}, [...DATE_PAGE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    addDateOptions(ai.command("product-human-inputs")
        .description("Prompt quality summary for a specific product"))
        .requiredOption("--product-id <id>", "Product unique_id")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/product/${opts.productId}/human-input-summary`,
                query: buildQueryFromFlags(dateParams(opts), [...DATE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    // ── User-scoped views ─────────────────────────────────────────────────────────

    addDateOptions(ai.command("user-human-inputs")
        .description("Prompt quality summary for a specific user"))
        .requiredOption("--user-id <id>", "User unique_id")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/user/${opts.userId}/human-input-summary`,
                query: buildQueryFromFlags(dateParams(opts), [...DATE_KEYS]),
            });
            console.log(JSON.stringify(result, null, 2));
        });

    // ── Conversation drill-down ───────────────────────────────────────────────────

    ai.command("conversation")
        .description("Retrieve a single session's full conversation by entry_id")
        .requiredOption("--entry-id <id>", "Session entry_id")
        .action(async (opts) => {
            const result = await cawplanRequest({
                method: "GET",
                path: `/api/v1/public/openapi/ai-session-usage/conversation`,
                query: {entry_id: opts.entryId},
            });
            console.log(JSON.stringify(result, null, 2));
        });
}
