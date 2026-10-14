import { Command } from "commander";
import {
  readCredentials,
  writeCredentials,
  deleteCredentials,
  isAccessTokenExpired,
  type Credentials,
} from "../lib/credentials.js";
import { getAuthState } from "../lib/auth-state.js";
import {
  DEVICE_LOGIN_DEFAULT_WAIT_MS,
  completeDeviceLogin,
  currentLoginEnvironment,
  deletePendingLogin,
  detectDeviceAuthReason,
  formatOAuthValidity,
  runOAuthLogin,
  startDeviceLogin,
} from "../lib/oauth.js";
import { success, error, info } from "../lib/output.js";
import { getConfigPath, readUserConfig } from "../lib/user-config.js";

export function registerAuthCommand(program: Command): void {
  const auth = program.command("auth").description("Manage authentication");

  auth
    .command("login")
    .description("Log in via browser (OAuth2); switches to device-auth automatically for coding agents and non-interactive shells")
    .option(
      "--device-auth",
      "Do not open a browser: print a verification URL to approve on any device, then exit (for agents, SSH, sandboxes)",
    )
    .option("--complete", "Finish a pending --device-auth login after approving it in the browser")
    .option(
      "--wait <seconds>",
      "With --complete: how long to wait for approval before exiting with status 2",
      String(DEVICE_LOGIN_DEFAULT_WAIT_MS / 1000),
    )
    .option("--browser", "Force the browser flow even when no interactive terminal or a coding agent is detected")
    .action(async (opts: { deviceAuth?: boolean; complete?: boolean; browser?: boolean; wait: string }) => {
      try {
        if (opts.browser && (opts.deviceAuth || opts.complete)) {
          throw new Error("--browser cannot be combined with --device-auth or --complete");
        }
        if (opts.complete) {
          const waitSeconds = Number(opts.wait);
          if (!Number.isFinite(waitSeconds) || waitSeconds < 0) {
            throw new Error(`--wait must be a non-negative number of seconds, got: ${opts.wait}`);
          }
          const result = await completeDeviceLogin({ waitMs: waitSeconds * 1000 });
          if (result.status === "pending") {
            const remaining = result.pending.expiresAt - Math.floor(Date.now() / 1000);
            info(`Still waiting for approval at:\n  ${result.pending.verificationUrl}`);
            info(`The login expires in ${formatRemaining(remaining)}. Re-run: cawplan auth login --device-auth --complete`);
            process.exit(2);
          }
          await saveLogin(result.credentials);
          return;
        }

        const autoReason = opts.deviceAuth || opts.browser
          ? null
          : detectDeviceAuthReason(currentLoginEnvironment());
        if (opts.deviceAuth || autoReason) {
          const pending = await startDeviceLogin();
          const validity = formatRemaining(pending.expiresAt - Math.floor(Date.now() / 1000));
          if (autoReason) {
            success(`Using device-auth login: ${autoReason}. To open a local browser instead, run: cawplan auth login --browser`);
            success("If you are an AI agent: show the URL below to the user, wait until they confirm approval, then run the command on the last line.");
          }
          success("Open this URL on any device where you are signed in to CawPlan, and approve the login:");
          success(`  ${pending.verificationUrl}`);
          success(`Code: ${pending.code}`);
          success(`This verification is valid for ${validity}.`);
          success("After approving, run: cawplan auth login --device-auth --complete");
          return;
        }

        await saveLogin(await runOAuthLogin());
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
      await deletePendingLogin();
      success("Logged out.");
    });
}

/** Seconds left, shown in whole minutes once over a minute (299s -> "5 minutes"). */
function formatRemaining(seconds: number): string {
  return seconds >= 60 ? formatOAuthValidity(Math.ceil(seconds / 60) * 60) : formatOAuthValidity(seconds);
}

async function saveLogin(creds: Credentials): Promise<void> {
  const existing = await readCredentials();
  await writeCredentials({ ...existing, ...creds });
  const saved = await readCredentials();
  const who = saved?.email ? ` as ${saved.email}` : "";
  success(`Logged in${who}. Token expires in 24h (auto-refresh enabled).`);
}
