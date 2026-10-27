import {execFile} from "node:child_process";
import {chmod, mkdir, readFile, unlink, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {promisify} from "node:util";
import {getBaseUrl} from "./config.js";
import {getPortalBase} from "./products.js";
import {getCredentialsPath, type Credentials} from "./credentials.js";

const execFileAsync = promisify(execFile);

export const OAUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const OAUTH_POLL_INTERVAL_MS = 2000;
export const OAUTH_TIMEOUT_ERROR = "oauth_timeout";
export const OAUTH_DENIED_ERROR = "access_denied";
export const OAUTH_PENDING_CODE = "PENDING";
export const OAUTH_INVALID_OR_EXPIRED_CODE = "INVALID_OR_EXPIRED";

/** The server no longer knows the polling token (expired or already exchanged). */
export class OAuthTokenInvalidError extends Error {}

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
    if (responseBody.code === OAUTH_INVALID_OR_EXPIRED_CODE) {
        throw new OAuthTokenInvalidError(`Exchange failed: ${responseMessage(responseBody)}`);
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

export function formatOAuthValidity(seconds: number): string {
    const roundedSeconds = Math.max(1, Math.ceil(seconds));
    if (roundedSeconds % 60 === 0) {
        const minutes = roundedSeconds / 60;
        return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    }
    return `${roundedSeconds} second${roundedSeconds === 1 ? "" : "s"}`;
}

async function pollExchangeUntil(
    token: string,
    deadline: number,
    intervalMs: number,
): Promise<Credentials | typeof OAUTH_PENDING_CODE> {
    while (Date.now() < deadline) {
        const result = await postExchange({token});
        if (result !== OAUTH_PENDING_CODE) {
            return result;
        }
        await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    }
    return OAUTH_PENDING_CODE;
}

export async function pollOAuthExchange(
    token: string,
    timeoutMs = OAUTH_TIMEOUT_MS,
    intervalMs = OAUTH_POLL_INTERVAL_MS,
): Promise<Credentials> {
    const result = await pollExchangeUntil(token, Date.now() + timeoutMs, intervalMs);
    if (result === OAUTH_PENDING_CODE) {
        throw new Error("Authentication timed out (5 minutes). Run: cawplan auth login");
    }
    return result;
}

// ─── Full login flow ──────────────────────────────────────────────────────────

export async function runOAuthLogin(options?: OAuthLoginOptions): Promise<Credentials> {
    const login = await startOAuthLogin();
    const consentUrl = buildConsentUrl(login.code);

    const open = options?.openBrowser ?? openBrowser;

    console.error(`Opening browser for authentication...`);
    console.error(`This verification is valid for ${formatOAuthValidity(login.expiresIn)}.`);
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

// ─── Device-auth login (non-blocking, two-step) ──────────────────────────────
//
// For agents, SSH sessions, and sandboxes: the browser cannot be opened locally
// and a blocking poll gets killed by tool timeouts, losing the private token.
// Step 1 starts the login, prints the verification URL, persists the private
// polling token, and exits. Step 2 resumes polling with the persisted token;
// it can be re-run until the user approves or the login expires.

export const DEVICE_LOGIN_DEFAULT_WAIT_MS = 90 * 1000;

const PENDING_LOGIN_MODE = 0o600;

export interface PendingDeviceLogin {
    /** Private polling token; never print or share it. */
    token: string;
    code: string;
    verificationUrl: string;
    /** Unix timestamp (seconds) when the login request expires. */
    expiresAt: number;
    /** Poll interval in seconds. */
    interval: number;
    /** API base the login was started against; the token is only valid there. */
    apiBase: string;
}

export type DeviceLoginCompletion =
    | { status: "success"; credentials: Credentials }
    | { status: "pending"; pending: PendingDeviceLogin };

export function getPendingLoginPath(): string {
    return join(dirname(getCredentialsPath()), "pending-login.json");
}

export async function readPendingLogin(): Promise<PendingDeviceLogin | null> {
    let raw: string;
    try {
        raw = await readFile(getPendingLoginPath(), "utf8");
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
        }
        throw err;
    }
    try {
        const parsed = JSON.parse(raw) as Partial<PendingDeviceLogin>;
        if (
            typeof parsed.token !== "string" ||
            typeof parsed.code !== "string" ||
            typeof parsed.verificationUrl !== "string" ||
            typeof parsed.expiresAt !== "number" ||
            typeof parsed.interval !== "number" ||
            typeof parsed.apiBase !== "string"
        ) {
            return null;
        }
        return parsed as PendingDeviceLogin;
    } catch {
        return null;
    }
}

async function writePendingLogin(pending: PendingDeviceLogin): Promise<void> {
    const path = getPendingLoginPath();
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, `${JSON.stringify(pending, null, 2)}\n`, {encoding: "utf8", mode: PENDING_LOGIN_MODE});
    await chmod(path, PENDING_LOGIN_MODE);
}

export async function deletePendingLogin(): Promise<void> {
    try {
        await unlink(getPendingLoginPath());
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            throw err;
        }
    }
}

function currentApiBase(): string {
    return getBaseUrl().replace(/\/$/, "");
}

export async function startDeviceLogin(nowMs = Date.now()): Promise<PendingDeviceLogin> {
    const login = await startOAuthLogin();
    const pending: PendingDeviceLogin = {
        token: login.token,
        code: login.code,
        verificationUrl: buildConsentUrl(login.code),
        expiresAt: Math.floor(nowMs / 1000) + login.expiresIn,
        interval: login.interval,
        apiBase: currentApiBase(),
    };
    await writePendingLogin(pending);
    return pending;
}

export async function completeDeviceLogin(options?: {
    waitMs?: number;
    pollIntervalMs?: number;
}): Promise<DeviceLoginCompletion> {
    const pending = await readPendingLogin();
    if (!pending) {
        throw new Error("No pending device login. Run: cawplan auth login --device-auth");
    }

    const expiresAtMs = pending.expiresAt * 1000;
    if (Date.now() >= expiresAtMs) {
        await deletePendingLogin();
        throw new Error("Device login expired. Run: cawplan auth login --device-auth");
    }
    if (pending.apiBase !== currentApiBase()) {
        throw new Error(
            `Pending device login was started against ${pending.apiBase}, ` +
            `but the current environment is ${currentApiBase()}. ` +
            "Switch back with `cawplan config env`, or run: cawplan auth login --device-auth",
        );
    }

    const waitMs = options?.waitMs ?? DEVICE_LOGIN_DEFAULT_WAIT_MS;
    const deadline = Math.min(Date.now() + waitMs, expiresAtMs);
    let result: Credentials | typeof OAUTH_PENDING_CODE;
    try {
        // Always poll at least once, even with --wait 0.
        result = await postExchange({token: pending.token});
        if (result === OAUTH_PENDING_CODE) {
            result = await pollExchangeUntil(
                pending.token,
                deadline,
                options?.pollIntervalMs ?? pending.interval * 1000,
            );
        }
    } catch (err) {
        // Server-side state is gone (expired or already exchanged); keeping the
        // token would only fail again. Transient errors keep it for a retry.
        if (err instanceof OAuthTokenInvalidError) {
            await deletePendingLogin();
            throw new Error(`${err.message}. Run: cawplan auth login --device-auth`);
        }
        throw err;
    }

    if (result === OAUTH_PENDING_CODE) {
        if (Date.now() >= expiresAtMs) {
            await deletePendingLogin();
            throw new Error("Device login expired. Run: cawplan auth login --device-auth");
        }
        return {status: "pending", pending};
    }

    await deletePendingLogin();
    return {status: "success", credentials: result};
}

// ─── Login mode detection ────────────────────────────────────────────────────
//
// Agents run commands without a terminal and follow CLI error hints
// ("Run: cawplan auth login") rather than skill text, so the plain command must
// pick the non-blocking device-auth flow on its own in those environments.

/** Env vars set by coding agents in the commands they run. */
export const AGENT_ENV_MARKERS = ["CLAUDECODE", "CODEX_THREAD_ID"] as const;

export interface LoginEnvironment {
    env: NodeJS.ProcessEnv;
    stdinIsTTY: boolean;
    stdoutIsTTY: boolean;
}

export function currentLoginEnvironment(): LoginEnvironment {
    return {
        env: process.env,
        stdinIsTTY: Boolean(process.stdin.isTTY),
        stdoutIsTTY: Boolean(process.stdout.isTTY),
    };
}

/** Returns why device-auth should be used instead of a browser, or null for an interactive terminal. */
export function detectDeviceAuthReason(environment: LoginEnvironment): string | null {
    const marker = AGENT_ENV_MARKERS.find((name) => environment.env[name]);
    if (marker) {
        return `coding agent detected (${marker})`;
    }
    if (!environment.stdinIsTTY || !environment.stdoutIsTTY) {
        return "no interactive terminal";
    }
    return null;
}
