#!/usr/bin/env node

import {Command} from "commander";
import {createRequire} from "node:module";
import {registerAuthCommand} from "./commands/auth.js";
import {registerProductsCommand} from "./commands/products.js";
import {registerVersionsCommand} from "./commands/versions.js";
import {registerTicketsCommand} from "./commands/tickets.js";
import {registerCriticalCommand} from "./commands/critical.js";
import {registerMetricsCommand} from "./commands/metrics.js";
import {registerTodosCommand} from "./commands/todos.js";
import {registerUsersCommand} from "./commands/users.js";
import {registerActivitiesCommand} from "./commands/activities.js";
import {registerUserActivityCommand} from "./commands/user-activity.js";
import {registerProductActivityCommand} from "./commands/product-activity.js";
import {registerKnowledgeCommand} from "./commands/knowledge.js";
import {registerAnalyticsCommand} from "./commands/analytics.js";
import {registerQAReportsCommand} from "./commands/qa-reports.js";
import {registerQAInsightsCommand} from "./commands/qa-insights.js";
import {registerCommunityCommand} from "./commands/community.js";
import {registerSessionCommand} from "./commands/session.js";
import {registerInitCommand} from "./commands/init.js";
import {registerUpgradeCommand} from "./commands/upgrade.js";
import {registerSkillCommand} from "./commands/skill.js";

const require = createRequire(import.meta.url);
const {version} = require("../package.json") as { version: string };

const program = new Command();

program
    .name("cawplan")
    .description("CawPlan CLI")
    .version(version);

// Register all commands
registerAuthCommand(program);
registerProductsCommand(program);
registerVersionsCommand(program);
registerTicketsCommand(program);
registerCriticalCommand(program);
registerMetricsCommand(program);
registerTodosCommand(program);
registerUsersCommand(program);
registerActivitiesCommand(program);
registerUserActivityCommand(program);
registerProductActivityCommand(program);
registerKnowledgeCommand(program);
registerAnalyticsCommand(program);
registerQAReportsCommand(program);
registerQAInsightsCommand(program);
registerCommunityCommand(program);
registerSessionCommand(program);
registerInitCommand(program);
registerUpgradeCommand(program);
registerSkillCommand(program);

// Raw API passthrough
program
    .command("api <method> <path>")
    .description("Raw API request passthrough")
    .option("--query <params>", "Query params as key=val&key2=val2")
    .option("--body <json>", "Request body as JSON")
    .action(async (method: string, path: string, opts) => {
        const {cawplanRequest} = await import("./lib/http.js");
        let body: unknown;
        if (opts.body) {
            try {
                body = JSON.parse(opts.body);
            } catch {
                console.error("Error: --body must be valid JSON");
                process.exit(1);
            }
        }
        const query = opts.query
            ? Object.fromEntries(new URLSearchParams(opts.query).entries())
            : undefined;

        const result = await cawplanRequest({
            method: method.toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
            path,
            query,
            body,
        });
        console.log(JSON.stringify(result, null, 2));
    });

// Cache management
program
    .command("cache")
    .description("Manage local cache")
    .command("clear")
    .description("Clear the local cache")
    .action(async () => {
        const {clearCache} = await import("./lib/cache.js");
        clearCache();
        console.log(JSON.stringify({code: "SUCCESS", msg: "cache cleared"}, null, 2));
    });

await program.parseAsync(process.argv);
