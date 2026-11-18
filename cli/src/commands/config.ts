import { Command } from "commander";
import { getApiBase, getEnvNames, getPortalBase } from "../lib/products.js";
import { success, error } from "../lib/output.js";
import { getConfigPath, readUserConfig, writeUserConfig } from "../lib/user-config.js";

export function registerConfigCommand(program: Command): void {
  const config = program.command("config").description("Manage CLI configuration");

  config
    .command("cache [enabled]")
    .description("Show or set whether the local response cache is used (on/off; default: off)")
    .action(async (enabled?: string) => {
      if (enabled === undefined) {
        const configFile = await readUserConfig();
        success(`Local cache: ${configFile?.cache === true ? "on" : "off"} (${getConfigPath()})`);
        return;
      }

      const cache = parseOnOff(enabled);
      if (cache === undefined) {
        error(`Invalid cache setting '${enabled}'. Expected on or off`);
        process.exit(1);
      }

      const existingConfig = await readUserConfig() ?? {};
      await writeUserConfig({ ...existingConfig, cache });
      success(`Local cache ${cache ? "enabled" : "disabled"} (${getConfigPath()})`);
    });

  config
    .command("cursor-usage [enabled]")
    .description(
      "Show or set whether session collect may read your Cursor login token and query cursor.com for exact Cursor token/cost data (on/off; default: off)"
    )
    .action(async (enabled?: string) => {
      if (enabled === undefined) {
        const configFile = await readUserConfig();
        success(`Cursor usage lookup: ${configFile?.cursor_usage === true ? "on" : "off"} (${getConfigPath()})`);
        return;
      }

      const cursorUsage = parseOnOff(enabled);
      if (cursorUsage === undefined) {
        error(`Invalid cursor-usage setting '${enabled}'. Expected on or off`);
        process.exit(1);
      }

      const existingConfig = await readUserConfig() ?? {};
      await writeUserConfig({ ...existingConfig, cursor_usage: cursorUsage });
      success(
        cursorUsage
          ? `Cursor usage lookup enabled (${getConfigPath()}). session collect will read the Cursor login token from the local Cursor app (or CURSOR_ACCESS_TOKEN / CURSOR_SESSION_TOKEN) and query cursor.com.`
          : `Cursor usage lookup disabled (${getConfigPath()}). Cursor GUI sessions will have no token/cost data.`
      );
    });

  config
    .command("env [env]")
    .description("Show or set the CawPlan environment")
    .action(async (env?: string) => {
      if (env === undefined) {
        const configFile = await readUserConfig();
        success(`Environment: ${configFile?.env ?? "prd"} (${getConfigPath()})`);
        success(`API: ${getApiBase()}`);
        success(`Portal: ${getPortalBase()}`);
        return;
      }

      const normalizedEnv = env.trim();
      const envNames = getEnvNames();
      if (!envNames.includes(normalizedEnv)) {
        error(`Unknown environment '${env}'. Expected one of: ${envNames.join(", ")}`);
        process.exit(1);
      }

      const existingConfig = await readUserConfig() ?? {};
      await writeUserConfig({
        ...existingConfig,
        env: normalizedEnv,
      });
      success(`Environment set to ${normalizedEnv} (${getConfigPath()})`);
    });
}

function parseOnOff(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "on" || normalized === "true") return true;
  if (normalized === "off" || normalized === "false") return false;
  return undefined;
}
