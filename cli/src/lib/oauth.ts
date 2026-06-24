import {execFile} from "node:child_process";
import {createServer, type Server} from "node:http";
import {promisify} from "node:util";
import {randomBytes} from "node:crypto";
import {getBaseUrl} from "./config.js";
import {getPortalBase} from "./products.js";
import type {Credentials} from "./credentials.js";

const execFileAsync = promisify(execFile);

export const OAUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const OAUTH_TIMEOUT_ERROR = "oauth_timeout";
export const OAUTH_DENIED_ERROR = "access_denied";

export interface CallbackResult {
    stateToken?: string;
    error?: string;
}

export interface OAuthLoginOptions {
    openBrowser?: (url: string) => Promise<void>;
    callbackTimeoutMs?: number;
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

// ─── Local callback server ───────────────────────────────────────────────────

export function waitForOAuthCallback(
    host = "127.0.0.1",
    timeoutMs = OAUTH_TIMEOUT_MS,
): Promise<{ port: number; result: Promise<CallbackResult> }> {
    let resolveCallback!: (value: CallbackResult) => void;
    const result = new Promise<CallbackResult>((resolve) => {
        resolveCallback = resolve;
    });

    return new Promise((resolve, reject) => {
        let timer: NodeJS.Timeout | undefined;

        const cleanup = (server: Server) => {
            if (timer) clearTimeout(timer);
            server.close();
        };

        const server = createServer((req, res) => {
            if (!req.url?.startsWith("/callback")) {
                res.statusCode = 404;
                res.end("Not found");
                return;
            }

            const requestUrl = new URL(req.url, `http://${host}`);
            const error = requestUrl.searchParams.get("error") ?? undefined;
            const stateToken = requestUrl.searchParams.get("state_token") ?? undefined;

            const message = error
                ? `Authentication failed: ${error}.`
                : !stateToken
                    ? "Authentication failed: missing state token."
                    : "Authentication successful.";
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.setHeader("Connection", "close");
            res.end(`${message} You can close this tab and return to the terminal.`);
            cleanup(server);

            if (error) {
                resolveCallback({error});
                return;
            }
            if (!stateToken) {
                resolveCallback({error: "missing_state_token"});
                return;
            }
            resolveCallback({stateToken});
        });

        server.once("error", reject);

        server.listen(0, host, () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                reject(new Error("failed to bind local OAuth callback server"));
                return;
            }

            timer = setTimeout(() => {
                cleanup(server);
                resolveCallback({error: OAUTH_TIMEOUT_ERROR});
            }, timeoutMs);

            resolve({port: address.port, result});
        });
    });
}

// ─── Consent URL builder ─────────────────────────────────────────────────────
//
// Points to the CawPlan web portal's /cli/auth page — NOT the BE API directly.
// The portal page is already authenticated in the user's browser; it calls
// POST /api/v1/cli/oauth/consent with the user's JWT, then redirects the browser
// to the CLI localhost callback with the returned state_token.

export function buildConsentUrl(redirectUri: string, state: string): string {
    const portalBase = getPortalBase().replace(/\/$/, "");
    const params = new URLSearchParams({
        client: "cawplan-cli",
        redirect_uri: redirectUri,
        state,
    });
    return `${portalBase}/cli/auth?${params.toString()}`;
}

// ─── Token exchange ───────────────────────────────────────────────────────────

function responseMessage(body: Record<string, unknown>): string {
    const message = body.msg ?? body.message ?? body.code;
    return typeof message === "string" && message.trim() ? message : "unknown error";
}

export async function exchangeStateToken(stateToken: string): Promise<Credentials> {
    const base = getBaseUrl().replace(/\/$/, "");
    const url = `${base}/api/v1/cli/oauth/exchange`;

    const res = await fetch(url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({state_token: stateToken}),
    });

    const body = await res.json().catch(() => ({})) as Record<string, unknown>;

    if (!res.ok) {
        throw new Error(`Exchange failed (${res.status}): ${responseMessage(body)}`);
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

// ─── Full login flow ──────────────────────────────────────────────────────────

export async function runOAuthLogin(options?: OAuthLoginOptions): Promise<Credentials> {
    const host = "127.0.0.1";
    const {port, result} = await waitForOAuthCallback(host, options?.callbackTimeoutMs);

    const redirectUri = `http://${host}:${port}/callback`;
    const state = randomBytes(16).toString("hex");
    const consentUrl = buildConsentUrl(redirectUri, state);

    const open = options?.openBrowser ?? openBrowser;

    console.error(`Opening browser for authentication...`);
    console.error(`If the browser does not open, visit:\n  ${consentUrl}`);

    try {
        await open(consentUrl);
    } catch {
        // Browser open failed — user can still visit the URL manually
    }

    const callback = await result;

    if (callback.error === OAUTH_DENIED_ERROR) {
        throw new Error("Authentication was denied.");
    }
    if (callback.error === OAUTH_TIMEOUT_ERROR) {
        throw new Error("Authentication timed out (5 minutes). Run: cawplan auth login");
    }
    if (callback.error || !callback.stateToken) {
        throw new Error(`Authentication failed: ${callback.error ?? "missing state token"}`);
    }

    return exchangeStateToken(callback.stateToken);
}
