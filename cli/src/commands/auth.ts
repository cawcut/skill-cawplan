import { Command } from "commander";
import { createInterface } from "node:readline";
import {
  readCredentials,
  writeCredentials,
  deleteCredentials,
  isAccessTokenExpired,
} from "../lib/credentials.js";
import { getAuthState } from "../lib/auth-state.js";
import { runOAuthLogin } from "../lib/oauth.js";
import { success, error } from "../lib/output.js";
import { getConfigPath, readUserConfig, writeUserConfig } from "../lib/user-config.js";
import { getDefaultEnvName, getEnvNames, getProductEnvConfig } from "../lib/products.js";

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptWithDefault(question: string, defaultValue: string): Promise<string> {
  const answer = await prompt(`${question} [${defaultValue}]: `);
  return answer || defaultValue;
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
        await writeCredentials({ ...existing, ...creds });
        const who = creds.email ? ` as ${creds.email}` : "";
        success(`Logged in${who}. Token expires in 24h (auto-refresh enabled).`);
      } catch (err_) {
        error(String(err_ instanceof Error ? err_.message : err_));
        process.exit(1);
      }
    });

  auth
    .command("configure")
    .description("Configure environment and API Key for authentication")
    .action(async () => {
      const existingConfig = await readUserConfig();
      const envNames = getEnvNames();
      const defaultEnv = existingConfig?.env ?? getDefaultEnvName();

      console.log("Open https://www.cawplan.com/account/api to generate an API Key");
      const env = await promptWithDefault(
        `Environment (${envNames.join(" / ")})`,
        defaultEnv,
      );
      if (!envNames.includes(env)) {
        error(`Unknown environment '${env}'. Expected one of: ${envNames.join(", ")}`);
        process.exit(1);
      }

      const envConfig = getProductEnvConfig(env);
      const useExistingUrls = existingConfig?.env === env;
      const baseUrlDefault =
        useExistingUrls && existingConfig?.baseUrl ? existingConfig.baseUrl : envConfig.apiBase;
      const portalUrlDefault =
        useExistingUrls && existingConfig?.portalUrl
          ? existingConfig.portalUrl
          : envConfig.portalBase;

      const baseUrl = await promptWithDefault("API base URL", baseUrlDefault);
      const portalUrl = await promptWithDefault("Portal URL", portalUrlDefault);
      const apiKey = await prompt("Paste your API Key: ");
      if (!apiKey) {
        error("API Key cannot be empty");
        process.exit(1);
      }
      const existing = await readCredentials();
      await writeUserConfig({ env, baseUrl, portalUrl });
      await writeCredentials({ ...existing, apiKey });
      success(`Configuration saved to ${getConfigPath()}.`);
      success("API Key saved.");
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

      if (state.active === "oauth") {
        activeLine = "Active:  OAuth (preferred)";
      } else if (state.active === "apiKey") {
        activeLine = "Active:  API Key";
      } else {
        activeLine = "Active:  none";
      }

      let apiKeyLine = "API Key: not configured";
      if (creds?.apiKey && state.envApiKey) {
        apiKeyLine = `API Key: configured (${maskKey(creds.apiKey)}, env ${maskKey(state.envApiKey)})`;
      } else if (creds?.apiKey) {
        apiKeyLine = `API Key: configured (${maskKey(creds.apiKey)})`;
      } else if (state.envApiKey) {
        apiKeyLine = `API Key: configured via CAWPLAN_API_KEY (${maskKey(state.envApiKey)})`;
      }

      console.log(oauthLine);
      console.log(apiKeyLine);
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
