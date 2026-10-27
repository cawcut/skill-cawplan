import {Command} from "commander";
import {cawplanRequest} from "../lib/http.js";

export function registerUserActivityCommand(program: Command): void {
    const userActivity = program.command("user-activity").description("User activity reports");

    userActivity
        .command("get")
        .description("Get user activity report")
        .option("--user_id <id>", "User ID")
        .option("--email <email>", "User email (exact match)")
        .requiredOption("--start <date>", "Start date YYYY-MM-DD")
        .requiredOption("--end <date>", "End date YYYY-MM-DD")
        .action(async (opts) => {
            if (!opts.user_id && !opts.email) {
                console.error("Error: user-activity get requires --user_id or --email");
                process.exit(1);
            }

            const query: Record<string, string> = {
                start_date: opts.start,
                end_date: opts.end,
            };
            if (opts.user_id) query.user_id = opts.user_id;
            if (opts.email) query.email = opts.email;

            const result = await cawplanRequest({
                method: "GET",
                path: "/api/v1/public/openapi/user-report",
                query,
            });
            console.log(JSON.stringify(result, null, 2));
        });
}
