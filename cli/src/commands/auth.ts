import {Command} from "commander";
import {createInterface} from "node:readline";
import {
    readCredentials,
    writeCredentials,
    deleteCredentials,
    isAccessTokenExpired,
} from "../lib/credentials.js";
import {runOAuthLogin} from "../lib/oauth.js";
import {success, error} from "../lib/output.js";

function maskKey(key: string): string {
    if (key.length <= 8) return "****";
    return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

async function prompt(question: string): Promise<string> {
    const rl = createInterface({input: process.stdin, output: process.stdout});
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

export function registerAuthCommand(program: Command): void {
    const auth = program.command("auth").description("Manage authentication");

    auth
        .command("login")
        .description("Log in via browser (OAuth2, recommended)")
        .action(async () => {
            try {
                const creds = await runOAuthLogin();
                const existing = await readCredentials();
                await writeCredentials({...existing, ...creds});
                const who = creds.email ? ` as ${creds.email}` : "";
                success(`Logged in${who}. Token expires in 24h (auto-refresh enabled).`);
            } catch (err_) {
                error(String(err_ instanceof Error ? err_.message : err_));
                process.exit(1);
            }
        });

    auth
        .command("configure")
        .description("Configure an API Key for authentication")
        .action(async () => {
            const portalBase = (process.env.CAWPLAN_PORTAL_URL ?? "https://www.cawplan.com").replace(/\/$/, "");
            console.log(`Open ${portalBase}/settings to generate an API Key`);
            const apiKey = await prompt("Paste your API Key: ");
            if (!apiKey) {
                error("API Key cannot be empty");
                process.exit(1);
            }
            const existing = await readCredentials();
            await writeCredentials({...existing, apiKey});
            success("API Key saved.");
        });

    auth
        .command("status")
        .description("Show current authentication status")
        .action(async () => {
            const creds = await readCredentials();

            const hasOAuth = Boolean(creds?.accessToken);
            const hasApiKey = Boolean(creds?.apiKey);

            let oauthLine: string;
            let activeLine: string;

            if (hasOAuth) {
                const expired = isAccessTokenExpired(creds!);
                if (expired && creds!.refreshToken) {
                    const expiry = new Date((creds!.expire ?? 0) * 1000).toISOString();
                    oauthLine = `OAuth:   token expired at ${expiry}, auto-refresh enabled`;
                } else if (!expired) {
                    const nowSec = Math.floor(Date.now() / 1000);
                    const remaining = (creds!.expire ?? 0) - nowSec;
                    const hours = Math.floor(remaining / 3600);
                    const email = creds!.email ? ` as ${creds!.email}` : "";
                    const autoRefresh = creds!.refreshToken ? ", auto-refresh enabled" : "";
                    oauthLine = `OAuth:   logged in${email} (expires in ${hours}h${autoRefresh})`;
                } else {
                    oauthLine = `OAuth:   token expired (no refresh token)`;
                }
                activeLine = "Active:  OAuth (preferred)";
            } else {
                oauthLine = "OAuth:   not configured";
                if (hasApiKey) {
                    activeLine = "Active:  API Key";
                } else {
                    activeLine = "Active:  none";
                }
            }

            const apiKeyLine = hasApiKey
                ? `API Key: configured (${maskKey(creds!.apiKey!)})`
                : "API Key: not configured";

            console.log(oauthLine);
            console.log(apiKeyLine);
            console.log(activeLine);
        });

    auth
        .command("logout")
        .description("Remove stored credentials")
        .action(async () => {
            await deleteCredentials();
            success("Logged out.");
        });
}
