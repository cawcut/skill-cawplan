import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {getBaseUrl} from "./config.js";
import {getPortalBase} from "./products.js";
import type {Credentials} from "./credentials.js";

const execFileAsync = promisify(execFile);

export const OAUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const OAUTH_POLL_INTERVAL_MS = 2000;
export const OAUTH_TIMEOUT_ERROR = "oauth_timeout";
export const OAUTH_DENIED_ERROR = "access_denied";
export const OAUTH_PENDING_CODE = "PENDING";

export interface OAuthLoginOptions {
    openBrowser?: (url: string) => Promise<void>;
    pollingTimeoutMs?: number;
    pollIntervalMs?: number;
}

export interface OAuthStartResult {
    code: string;
    token: string;
    expiresIn: number;
    interval: number;
}

// ─── Browser opener ──────────────────────────────────────────────────────────

export function browserOpenCommand(
    url: string,
    platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
    if (platform === "darwin") {
        return {command: "open", args: [url]};
    }
    if (platform === "win32") {
        // Avoid `cmd /c start <url>`: cmd treats `&` in OAuth query strings as
        // command separators unless every layer quotes perfectly.
        return {command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url]};
    }
    return {command: "xdg-open", args: [url]};
}

export async function openBrowser(url: string): Promise<void> {
    const {command, args} = browserOpenCommand(url);
    await execFileAsync(command, args);
}

// ─── Consent URL builder ─────────────────────────────────────────────────────
//
// Points to the CawPlan web portal's /cli/auth page — NOT the BE API directly.
// The portal page is already authenticated in the user's browser; it calls
// POST /api/v1/cli/oauth/consent with the user's JWT and public code. The CLI
// polls the public exchange endpoint with its private token until consent is complete.

export function buildConsentUrl(code: string): string {
    const portalBase = getPortalBase().replace(/\/$/, "");
    const params = new URLSearchParams({
        client: "cawplan-cli",
        code,
    });
    return `${portalBase}/cli/auth?${params.toString()}`;
}

// ─── Token exchange ───────────────────────────────────────────────────────────

function responseMessage(body: Record<string, unknown>): string {
    const message = body.msg ?? body.message ?? body.code;
    return typeof message === "string" && message.trim() ? message : "unknown error";
}

function credentialsFromExchangeResponse(body: Record<string, unknown>): Credentials {
    const code = body.code;
    if (typeof code === "string" && code !== "SUCCESS") {
        throw new Error(responseMessage(body));
    }

    const data = (body.data ?? {}) as Record<string, unknown>;
    const accessToken = data.access_token as string | undefined;
    const refreshToken = data.refresh_token as string | undefined;
    const expire = data.expire as number | undefined;

    if (!accessToken || !refreshToken || typeof expire !== "number") {
        throw new Error("Exchange response missing required token fields");
    }

    return {
        accessToken,
        refreshToken,
        expire,
    };
}

export async function startOAuthLogin(): Promise<OAuthStartResult> {
    const base = getBaseUrl().replace(/\/$/, "");
    const url = `${base}/api/v1/cli/oauth/start`;

    const res = await fetch(url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({client: "cawplan-cli"}),
    });
    const responseBody = await res.json().catch(() => ({})) as Record<string, unknown>;

    if (!res.ok) {
        throw new Error(`OAuth start failed (${res.status}): ${responseMessage(responseBody)}`);
    }
    const code = responseBody.code;
    if (typeof code === "string" && code !== "SUCCESS") {
        throw new Error(`OAuth start failed: ${responseMessage(responseBody)}`);
    }

    const data = (responseBody.data ?? {}) as Record<string, unknown>;
    const loginCode = data.code as string | undefined;
    const token = data.token as string | undefined;
    const expiresIn = data.expires_in as number | undefined;
    const interval = data.interval as number | undefined;

    if (!loginCode || !token) {
        throw new Error("OAuth start response missing required code/token fields");
    }

    return {
        code: loginCode,
        token,
        expiresIn: typeof expiresIn === "number" ? expiresIn : OAUTH_TIMEOUT_MS / 1000,
        interval: typeof interval === "number" ? interval : OAUTH_POLL_INTERVAL_MS / 1000,
    };
}

async function postExchange(body: Record<string, string>): Promise<Credentials | typeof OAUTH_PENDING_CODE> {
    const base = getBaseUrl().replace(/\/$/, "");
    const url = `${base}/api/v1/cli/oauth/exchange`;

    const res = await fetch(url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body),
    });

    const responseBody = await res.json().catch(() => ({})) as Record<string, unknown>;

    if (!res.ok) {
        throw new Error(`Exchange failed (${res.status}): ${responseMessage(responseBody)}`);
    }

    if (responseBody.code === OAUTH_PENDING_CODE) {
        return OAUTH_PENDING_CODE;
    }

    try {
        return credentialsFromExchangeResponse(responseBody);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Exchange failed: ${msg}`);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollOAuthExchange(
    token: string,
    timeoutMs = OAUTH_TIMEOUT_MS,
    intervalMs = OAUTH_POLL_INTERVAL_MS,
): Promise<Credentials> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await postExchange({token});
        if (result !== OAUTH_PENDING_CODE) {
            return result;
        }
        await sleep(intervalMs);
    }
    throw new Error("Authentication timed out (5 minutes). Run: cawplan auth login");
}

// ─── Full login flow ──────────────────────────────────────────────────────────

export async function runOAuthLogin(options?: OAuthLoginOptions): Promise<Credentials> {
    const login = await startOAuthLogin();
    const consentUrl = buildConsentUrl(login.code);

    const open = options?.openBrowser ?? openBrowser;

    console.error(`Opening browser for authentication...`);
    console.error(`If the browser does not open, visit:\n  ${consentUrl}`);
    console.error(`Waiting for browser authorization...`);

    try {
        await open(consentUrl);
    } catch {
        // Browser open failed — user can still visit the URL manually
    }

    return pollOAuthExchange(
        login.token,
        options?.pollingTimeoutMs ?? login.expiresIn * 1000,
        options?.pollIntervalMs ?? login.interval * 1000,
    );
}
