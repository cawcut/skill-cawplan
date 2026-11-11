import {ensurePrivateDir} from "./private-fs.js";
import {execFile} from "node:child_process";
import {createHash, randomBytes, timingSafeEqual} from "node:crypto";
import {chmod, readFile, unlink, writeFile} from "node:fs/promises";
import {createServer, type ServerResponse} from "node:http";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {promisify} from "node:util";
import {getBaseUrl} from "./config.js";
import {getPortalBase} from "./products.js";
import {getCredentialsPath, type Credentials} from "./credentials.js";

const execFileAsync = promisify(execFile);

const {version: CLI_VERSION} = createRequire(import.meta.url)("../../package.json") as { version: string };

/** Sent on start and exchange; the consent page shows it as reported by the CLI. */
export const OAUTH_USER_AGENT = `cawplan-cli/${CLI_VERSION}`;

export const OAUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const OAUTH_POLL_INTERVAL_MS = 2000;
export const OAUTH_TIMEOUT_ERROR = "oauth_timeout";
export const OAUTH_DENIED_ERROR = "access_denied";
export const OAUTH_PENDING_CODE = "PENDING";
export const OAUTH_INVALID_OR_EXPIRED_CODE = "INVALID_OR_EXPIRED";

/** The server no longer knows the polling token (expired or already exchanged). */
export class OAuthTokenInvalidError extends Error {}

/**
 * The server refused the start request as invalid input (INVALID_INPUT). For a
 * loopback start this means it does not accept loopback logins.
 */
export class OAuthStartRejectedError extends Error {}

/**
 * The request did not get an HTTP response (DNS, connect, TLS, reset, a
 * local proxy closing the connection, ...). The message keeps the low-level
 * cause, which plain fetch errors ("fetch failed") hide.
 */
export class OAuthNetworkError extends Error {}

/** "fetch failed (UND_ERR_SOCKET: other side closed)" from a fetch error. */
export function describeFetchError(err: unknown): string {
    if (!(err instanceof Error)) {
        return String(err);
    }
    const cause = err.cause as {code?: unknown; message?: unknown} | undefined;
    const code = typeof cause?.code === "string" ? cause.code : "";
    const detail = typeof cause?.message === "string" ? cause.message : "";
    const parts = [code, detail].filter(Boolean).join(": ");
    return parts ? `${err.message} (${parts})` : err.message;
}

async function oauthFetch(url: string, init: RequestInit): Promise<Response> {
    try {
        return await fetch(url, init);
    } catch (err) {
        throw new OAuthNetworkError(describeFetchError(err), {cause: err});
    }
}

/** Response code a server uses for a start request it cannot accept. */
export const OAUTH_INVALID_INPUT_CODE = "INVALID_INPUT";

export interface OAuthLoginOptions {
    openBrowser?: (url: string) => Promise<void>;
    /** Only print the consent URL (remote machines, --no-browser). */
    skipBrowser?: boolean;
    pollingTimeoutMs?: number;
    pollIntervalMs?: number;
}

/** Loopback mode: the consent page redirects an authorization code to this CLI. */
export const OAUTH_MODE_LOOPBACK = "loopback";

export interface LoopbackStartParams {
    redirectUri: string;
    codeChallenge: string;
    state: string;
}

export interface OAuthStartResult {
    /** "loopback", "user_code", or empty for servers that predate modes. */
    mode: string;
    code: string;
    /** Private polling token; empty in loopback mode. */
    token: string;
    /** Code the user must type on the consent page; empty for servers that predate it. */
    userCode: string;
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
// The user code is never put in the URL: it is shown only in this terminal and
// the user must type it, so a forwarded link alone cannot be approved.

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

function credentialsFromExchangeResponse(body: Record<string, unknown>, apiBase: string): Credentials {
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
        apiBase,
    };
}

export async function startOAuthLogin(loopback?: LoopbackStartParams): Promise<OAuthStartResult> {
    const base = getBaseUrl().replace(/\/$/, "");
    const url = `${base}/api/v1/cli/oauth/start`;

    // displays_user_code tells the server this CLI prints the user code, so
    // the consent page asks the user to type it instead of showing it.
    const body: Record<string, unknown> = {client: "cawplan-cli", displays_user_code: true};
    if (loopback) {
        body.redirect_uri = loopback.redirectUri;
        body.code_challenge = loopback.codeChallenge;
        body.code_challenge_method = "S256";
        body.state = loopback.state;
    }
    const res = await oauthFetch(url, {
        method: "POST",
        headers: {"Content-Type": "application/json", "User-Agent": OAUTH_USER_AGENT},
        body: JSON.stringify(body),
    });
    const responseBody = await res.json().catch(() => ({})) as Record<string, unknown>;

    const code = responseBody.code;
    if (code === OAUTH_INVALID_INPUT_CODE) {
        throw new OAuthStartRejectedError(`OAuth start failed: ${responseMessage(responseBody)}`);
    }
    if (!res.ok) {
        throw new Error(`OAuth start failed (${res.status}): ${responseMessage(responseBody)}`);
    }
    if (typeof code === "string" && code !== "SUCCESS") {
        throw new Error(`OAuth start failed: ${responseMessage(responseBody)}`);
    }

    const data = (responseBody.data ?? {}) as Record<string, unknown>;
    const mode = typeof data.mode === "string" ? data.mode : "";
    const loginCode = data.code as string | undefined;
    const token = data.token as string | undefined;
    const userCode = data.user_code;
    const expiresIn = data.expires_in as number | undefined;
    const interval = data.interval as number | undefined;

    if (!loginCode || (!token && mode !== OAUTH_MODE_LOOPBACK)) {
        throw new Error("OAuth start response missing required code/token fields");
    }

    return {
        mode,
        code: loginCode,
        token: token ?? "",
        userCode: typeof userCode === "string" ? userCode : "",
        expiresIn: typeof expiresIn === "number" ? expiresIn : OAUTH_TIMEOUT_MS / 1000,
        interval: typeof interval === "number" ? interval : OAUTH_POLL_INTERVAL_MS / 1000,
    };
}

async function postExchange(body: Record<string, string>): Promise<Credentials | typeof OAUTH_PENDING_CODE> {
    const base = getBaseUrl().replace(/\/$/, "");
    const url = `${base}/api/v1/cli/oauth/exchange`;

    let res: Response;
    try {
        res = await oauthFetch(url, {
            method: "POST",
            headers: {"Content-Type": "application/json", "User-Agent": OAUTH_USER_AGENT},
            body: JSON.stringify(body),
        });
    } catch (err) {
        throw err instanceof OAuthNetworkError ? new OAuthNetworkError(`Exchange failed: ${err.message}`, {cause: err.cause}) : err;
    }

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
        return credentialsFromExchangeResponse(responseBody, base);
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
    let lastNetworkError: OAuthNetworkError | null = null;
    while (Date.now() < deadline) {
        let result: Credentials | typeof OAUTH_PENDING_CODE;
        try {
            result = await postExchange({token});
            lastNetworkError = null;
        } catch (err) {
            // A dropped connection says nothing about the login: keep polling
            // until the deadline (the token is only consumed by a success).
            if (!(err instanceof OAuthNetworkError)) {
                throw err;
            }
            lastNetworkError = err;
            result = OAUTH_PENDING_CODE;
        }
        if (result !== OAUTH_PENDING_CODE) {
            return result;
        }
        await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    }
    if (lastNetworkError) {
        throw lastNetworkError;
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

/** Tells the user to type the code on the consent page, and never someone else's. */
export function userCodeMessage(userCode: string): string {
    return `When the browser asks for a code, enter: ${userCode}\n` +
        "Never enter a code or open a login link that someone else sent you.";
}

/**
 * User-code login: the user approves in any browser and types the code this
 * CLI prints; the CLI polls with its private token. Used on remote or
 * headless machines and with --no-browser.
 */
export async function runOAuthLogin(options?: OAuthLoginOptions): Promise<Credentials> {
    return pollStartedLogin(await startOAuthLogin(), options);
}

async function pollStartedLogin(login: OAuthStartResult, options?: OAuthLoginOptions): Promise<Credentials> {
    if (!login.token) {
        throw new Error("OAuth start response missing the polling token");
    }
    const consentUrl = buildConsentUrl(login.code);

    const open = options?.openBrowser ?? openBrowser;

    if (options?.skipBrowser) {
        console.error(`Open this URL in a browser on any device where you are signed in to CawPlan:\n  ${consentUrl}`);
    } else {
        console.error(`Opening browser for authentication...`);
    }
    if (login.userCode) {
        console.error(userCodeMessage(login.userCode));
    }
    console.error(`This verification is valid for ${formatOAuthValidity(login.expiresIn)}.`);
    if (!options?.skipBrowser) {
        console.error(`If the browser does not open, visit:\n  ${consentUrl}`);
    }
    console.error(`Waiting for browser authorization...`);

    if (!options?.skipBrowser) {
        try {
            await open(consentUrl);
        } catch {
            // Browser open failed — user can still visit the URL manually
        }
    }

    return pollOAuthExchange(
        login.token,
        options?.pollingTimeoutMs ?? login.expiresIn * 1000,
        options?.pollIntervalMs ?? login.interval * 1000,
    );
}

// ─── Loopback login (local machine, PKCE) ────────────────────────────────────
//
// On the user's own machine the consent page redirects a one-time
// authorization code to a listener on 127.0.0.1 (RFC 8252). Only this process
// holds the PKCE verifier and the state, and no polling token exists, so a
// login link sent to someone else gives the sender nothing: the code lands on
// the other person's own loopback interface.

export const NO_BROWSER_HINT =
    "If you cannot finish signing in with a browser on this machine, run: cawplan auth login --no-browser";

export interface LoopbackLoginOptions {
    openBrowser?: (url: string) => Promise<void>;
    timeoutMs?: number;
}

/** How a loopback sign-in ended, as reported to the browser. */
export type LoopbackResult = "success" | "state_mismatch" | "exchange_failed" | "expired" | "denied";

/** A loopback sign-in failure, with the result reported to the browser. */
export class LoopbackSignInError extends Error {
    constructor(message: string, readonly result: Exclude<LoopbackResult, "success">) {
        super(message);
    }
}

export interface LoopbackCallback {
    params: URLSearchParams;
    /** Answers the browser (status + result page), then closes the listener. */
    respond(result: LoopbackResult): void;
}

export interface LoopbackListener {
    redirectUri: string;
    /**
     * Resolves with the first /callback request carrying the expected state;
     * rejects after timeoutMs, counted from this call.
     */
    waitForCallback(timeoutMs: number): Promise<LoopbackCallback>;
    close(): void;
}

function randomBase64Url(bytes: number): string {
    return randomBytes(bytes).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url");
}

// Fixed texts only: nothing from the request is ever written into the page.
const RESULT_TEXT: Record<LoopbackResult, {title: string; text: string}> = {
    success: {title: "Connection successful", text: "You can close this window and return to your terminal."},
    state_mismatch: {
        title: "Connection failed",
        text: "This sign-in response does not belong to the CawPlan CLI login waiting on this computer.",
    },
    exchange_failed: {
        title: "Connection failed",
        text: "The CLI could not finish signing in. Run \"cawplan auth login\" again.",
    },
    expired: {title: "Connection failed", text: "This sign-in has expired. Run \"cawplan auth login\" again."},
    denied: {title: "Sign-in cancelled", text: "You can close this window."},
};

/**
 * Self-contained result page for when the callback is opened as a top-level
 * navigation (the portal normally requests it with fetch and shows its own
 * screen). Same layout as the portal's: centered title and one grey line.
 */
export function loopbackResultPage(result: LoopbackResult): string {
    const {title, text} = RESULT_TEXT[result];
    return "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">" +
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
        "<meta name=\"color-scheme\" content=\"light dark\">" +
        `<title>${title} - CawPlan CLI</title>` +
        "<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;" +
        "font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;background:#fff;color:#212327}" +
        ".brand{position:absolute;top:20px;left:24px;font-size:14px;font-weight:600}" +
        "main{max-width:420px;padding:24px 16px;text-align:center}" +
        "h1{margin:0 0 8px;font-size:20px;font-weight:700;letter-spacing:-.45px}" +
        "p{margin:0;font-size:14px;line-height:20px;color:#808893}" +
        "@media (prefers-color-scheme:dark){body{background:#141518;color:#f4f5f6}p{color:#9ba1a9}}</style>" +
        `<div class="brand">CawPlan</div><main><h1>${title}</h1><p>${text}</p></main></html>`;
}

/** The only origin allowed to read the callback response: the CawPlan portal. */
export function portalOrigin(): string | null {
    try {
        const url = new URL(getPortalBase());
        return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
    } catch {
        return null;
    }
}

function corsHeaders(origin: string | undefined, allowed: string | null): Record<string, string> {
    // Vary on every response so a cached answer for one origin is not reused for another.
    return origin && allowed && origin === allowed
        ? {"Vary": "Origin", "Access-Control-Allow-Origin": allowed}
        : {"Vary": "Origin"};
}

function writeResult(res: ServerResponse, result: LoopbackResult, cors: Record<string, string>): void {
    res.writeHead(result === "success" ? 200 : 400, {
        ...cors,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Connection": "close",
    });
    res.end(loopbackResultPage(result));
}

/**
 * Listens on 127.0.0.1 only, on a free port, for the consent result of this
 * login. The portal requests GET /callback with fetch and shows the result
 * itself, so the response allows exactly the portal origin (CORS) and the
 * Private Network Access preflight is answered; other origins get no CORS
 * headers and cannot read the response. Other paths and methods get 404 and
 * a /callback with another state gets 400; the listener keeps waiting in
 * both cases, so a stray or forged request cannot end the login. The first
 * matching callback is the only one served, after which the listener closes.
 */
export async function startLoopbackListener(expectedState: string): Promise<LoopbackListener> {
    let deliver: ((cb: LoopbackCallback) => void) | null = null;
    let received: LoopbackCallback | null = null;
    const allowedOrigin = portalOrigin();
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const origin = req.headers.origin;
        const cors = corsHeaders(origin, allowedOrigin);
        if (req.method === "OPTIONS" && url.pathname === "/callback" && !received) {
            // CORS / Private Network Access preflight from the portal.
            const allowed = "Access-Control-Allow-Origin" in cors &&
                req.headers["access-control-request-method"] === "GET";
            res.writeHead(allowed ? 204 : 403, {
                "Vary": "Origin",
                ...(allowed ? {
                    ...cors,
                    "Access-Control-Allow-Methods": "GET",
                    "Access-Control-Max-Age": "60",
                    ...(req.headers["access-control-request-private-network"] === "true"
                        ? {"Access-Control-Allow-Private-Network": "true"}
                        : {}),
                } : {}),
            });
            res.end();
            return;
        }
        if (req.method !== "GET" || url.pathname !== "/callback" || received) {
            res.writeHead(404, {"Connection": "close"});
            res.end();
            return;
        }
        if (!sameSecret(url.searchParams.get("state") ?? "", expectedState)) {
            writeResult(res, "state_mismatch", cors);
            return;
        }
        received = {
            params: url.searchParams,
            respond: (result) => {
                writeResult(res, result, cors);
                close();
            },
        };
        deliver?.(received);
    });
    const close = () => {
        server.close();
        server.closeAllConnections();
    };
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        close();
        throw new Error("Failed to start the local sign-in listener");
    }
    return {
        redirectUri: `http://127.0.0.1:${address.port}/callback`,
        close,
        waitForCallback: (timeoutMs) => new Promise((resolve, reject) => {
            if (received) {
                resolve(received);
                return;
            }
            const timer = setTimeout(() => {
                deliver = null;
                reject(new Error(`Authentication timed out (${formatOAuthValidity(timeoutMs / 1000)}). ${NO_BROWSER_HINT}`));
            }, timeoutMs);
            deliver = (cb) => {
                clearTimeout(timer);
                resolve(cb);
            };
        }),
    };
}

function sameSecret(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
}

/** Returns the authorization code from a loopback redirect, after checking state. */
export function codeFromLoopbackCallback(params: URLSearchParams, expectedState: string): string {
    if (!sameSecret(params.get("state") ?? "", expectedState)) {
        throw new LoopbackSignInError("Sign-in response did not match this login (state mismatch). Run: cawplan auth login", "state_mismatch");
    }
    const error = params.get("error");
    if (error) {
        throw error === OAUTH_DENIED_ERROR
            ? new LoopbackSignInError("Sign-in was cancelled in the browser.", "denied")
            : new LoopbackSignInError(`Sign-in failed: ${error}`, "exchange_failed");
    }
    const code = params.get("code");
    if (!code) {
        throw new LoopbackSignInError("Sign-in response is missing the authorization code. Run: cawplan auth login", "exchange_failed");
    }
    return code;
}

export async function exchangeAuthorizationCode(code: string, codeVerifier: string, redirectUri: string): Promise<Credentials> {
    const body = {code, code_verifier: codeVerifier, redirect_uri: redirectUri};
    let result: Credentials | typeof OAUTH_PENDING_CODE;
    try {
        result = await postExchange(body);
    } catch (err) {
        if (!(err instanceof OAuthNetworkError)) {
            throw err;
        }
        // No HTTP response, so the server may never have seen the code: try
        // once more on a new connection. If it did consume the code, the
        // retry fails with INVALID_OR_EXPIRED, which is no worse; the code
        // is one-time and useless without this process's PKCE verifier.
        result = await postExchange(body);
    }
    if (result === OAUTH_PENDING_CODE) {
        throw new Error("Exchange failed: unexpected pending state");
    }
    return result;
}

/**
 * Loopback login for a CLI on the user's own machine: the browser sends the
 * authorization code straight back to this process, no code is typed.
 */
export async function runLoopbackLogin(options?: LoopbackLoginOptions): Promise<Credentials> {
    const verifier = randomBase64Url(32);
    const state = randomBase64Url(32);
    const listener = await startLoopbackListener(state);
    try {
        let login: OAuthStartResult;
        try {
            login = await startOAuthLogin({
                redirectUri: listener.redirectUri,
                codeChallenge: pkceChallenge(verifier),
                state,
            });
        } catch (err) {
            if (!(err instanceof OAuthStartRejectedError)) {
                throw err;
            }
            // The server refused the loopback request (e.g. its redirect_uri):
            // sign in with a code instead of waiting for a redirect that never comes.
            listener.close();
            console.error(`The server did not accept a browser-return sign-in (${err.message}); using a sign-in code instead.`);
            return await pollStartedLogin(await startOAuthLogin(), {openBrowser: options?.openBrowser});
        }
        if (login.mode !== OAUTH_MODE_LOOPBACK) {
            // The server predates loopback logins: it ignored the loopback
            // fields and started a user-code login, which is what we follow.
            listener.close();
            return await pollStartedLogin(login, {openBrowser: options?.openBrowser});
        }

        const consentUrl = buildConsentUrl(login.code);
        console.error("Opening browser for authentication...");
        console.error(`If the browser does not open, visit:\n  ${consentUrl}`);
        console.error("Waiting for browser authorization...");
        // The clock starts now and the browser launcher is not awaited, so a
        // launcher that hangs cannot stall the login past its expiry.
        const waiting = listener.waitForCallback(options?.timeoutMs ?? login.expiresIn * 1000);
        let settled = false;
        (options?.openBrowser ?? openBrowser)(consentUrl).catch(() => {
            if (!settled) {
                console.error(`Could not open a browser. ${NO_BROWSER_HINT}`);
            }
        });
        let callback: LoopbackCallback;
        try {
            callback = await waiting;
        } finally {
            settled = true;
        }

        let code: string;
        try {
            code = codeFromLoopbackCallback(callback.params, state);
        } catch (err) {
            callback.respond(err instanceof LoopbackSignInError ? err.result : "exchange_failed");
            throw err;
        }
        try {
            // The browser is answered only after the exchange, so a success
            // response really means this CLI is signed in.
            const credentials = await exchangeAuthorizationCode(code, verifier, listener.redirectUri);
            callback.respond("success");
            return credentials;
        } catch (err) {
            // The server consumes the code on the first attempt, whatever the outcome.
            const message = `${err instanceof Error ? err.message : String(err)}. ` +
                "This sign-in code has been used and cannot be retried; run: cawplan auth login";
            callback.respond(err instanceof OAuthTokenInvalidError ? "expired" : "exchange_failed");
            throw new Error(message);
        }
    } finally {
        listener.close();
    }
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
    /** Code the user types on the consent page; absent in files from older CLIs. */
    userCode?: string;
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
            typeof parsed.apiBase !== "string" ||
            (parsed.userCode !== undefined && typeof parsed.userCode !== "string")
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
    await ensurePrivateDir(dirname(path));
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
        ...(login.userCode ? {userCode: login.userCode} : {}),
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

/** Env vars that mean this CLI runs on a different machine than the user's browser. */
export const REMOTE_ENV_MARKERS = ["SSH_CONNECTION", "SSH_TTY", "SSH_CLIENT", "CODESPACES", "REMOTE_CONTAINERS"] as const;

/**
 * Returns why the browser cannot reach a loopback listener on this machine
 * (so the user-code login must be used), or null for a local desktop.
 */
export function detectRemoteLoginReason(
    env: NodeJS.ProcessEnv,
    platform: NodeJS.Platform = process.platform,
): string | null {
    const marker = REMOTE_ENV_MARKERS.find((name) => env[name]);
    if (marker) {
        return `remote session detected (${marker})`;
    }
    if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
        return "no graphical display (DISPLAY and WAYLAND_DISPLAY are unset)";
    }
    return null;
}
