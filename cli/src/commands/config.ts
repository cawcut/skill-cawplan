import { Command } from "commander";
import { getApiBase, getEnvNames, getPortalBase } from "../lib/products.js";
import { success, error } from "../lib/output.js";
import { getConfigPath, readUserConfig, writeUserConfig } from "../lib/user-config.js";

export function registerConfigCommand(program: Command): void {
  const config = program.command("config").description("Manage CLI configuration");

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
