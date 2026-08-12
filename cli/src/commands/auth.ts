import { Command } from "commander";
import {
  readCredentials,
  writeCredentials,
  deleteCredentials,
  isAccessTokenExpired,
} from "../lib/credentials.js";
import { getAuthState } from "../lib/auth-state.js";
import { runOAuthLogin } from "../lib/oauth.js";
import { success, error } from "../lib/output.js";
import { getConfigPath, readUserConfig } from "../lib/user-config.js";

export function registerAuthCommand(program: Command): void {
  const auth = program.command("auth").description("Manage authentication");

  auth
    .command("login")
    .description("Log in via browser (OAuth2, recommended)")
    .action(async () => {
      try {
        const creds = await runOAuthLogin();
        const existing = await readCredentials();
        await writeCredentials({ ...existing, ...creds });
        const who = creds.email ? ` as ${creds.email}` : "";
        success(`Logged in${who}. Token expires in 24h (auto-refresh enabled).`);
      } catch (err_) {
        error(String(err_ instanceof Error ? err_.message : err_));
        process.exit(1);
      }
    });

  auth
    .command("status")
    .description("Show current authentication status")
    .action(async () => {
      const state = await getAuthState();
      const creds = state.credentials;

      let oauthLine: string;
      let activeLine: string;

      if (creds?.accessToken) {
        const expired = isAccessTokenExpired(creds);
        if (expired && creds.refreshToken) {
          const expiry = new Date((creds.expire ?? 0) * 1000).toISOString();
          oauthLine = `OAuth:   token expired at ${expiry}, auto-refresh enabled`;
        } else if (!expired) {
          const nowSec = Math.floor(Date.now() / 1000);
          const remaining = (creds.expire ?? 0) - nowSec;
          const hours = Math.floor(remaining / 3600);
          const email = creds.email ? ` as ${creds.email}` : "";
          const autoRefresh = creds.refreshToken ? ", auto-refresh enabled" : "";
          oauthLine = `OAuth:   logged in${email} (expires in ${hours}h${autoRefresh})`;
        } else {
          oauthLine = `OAuth:   token expired (no refresh token)`;
        }
      } else {
        oauthLine = "OAuth:   not configured";
      }

      activeLine = state.active === "oauth" ? "Active:  OAuth" : "Active:  none";

      console.log(oauthLine);
      if (creds?.user_id) {
        console.log(`User ID: ${creds.user_id}`);
      }
      const config = await readUserConfig();
      if (config) {
        console.log(`Config:  ${config.env ?? "default"} (${getConfigPath()})`);
      } else {
        console.log("Config:  default");
      }
      console.log(activeLine);

      if (state.active === "none") {
        process.exit(1);
      }
    });

  auth
    .command("logout")
    .description("Remove stored credentials")
    .action(async () => {
      await deleteCredentials();
      success("Logged out.");
    });
}
