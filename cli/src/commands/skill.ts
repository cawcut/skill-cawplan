import type {Command} from "commander";
import {getAuthState} from "../lib/auth-state.js";
import {
    currentCawplanVersion,
    isNewerVersion,
    latestCawplanVersion,
    runCawplanUpgrade,
} from "../lib/cawplan-upgrade.js";
import {listInstalledSkills, runSkillsAdd, runSkillsRemove} from "../lib/skill-update.js";
import {
    detectRoles,
    loadSkillRolesConfig,
    parseRoleList,
    skillsForRoles,
    skillsToPrune,
    type DetectedRole,
    type ProductWithMembers,
    type SkillRolesConfig,
} from "../lib/skill-roles.js";
import {listCawplanProducts} from "../lib/product-catalog.js";
import {extractList} from "../lib/ai-session/helpers.js";
import {promptConfirm} from "../lib/assign/products-api.js";

interface SkillUpdateOptions {
    role?: string;
    all?: boolean;
    dryRun?: boolean;
    prune?: boolean;
}

async function detectCurrentUserRoles(config: SkillRolesConfig): Promise<DetectedRole[]> {
    const state = await getAuthState();
    const userId = state.credentials?.user_id;
    if (state.active === "none" || !userId) {
        throw new Error("Not authenticated. Run: cawplan auth login (or pass --role / --all)");
    }
    const products = extractList<ProductWithMembers>(
        await listCawplanProducts({pageSize: "1000", pageNum: "1", refresh: true})
    );
    return detectRoles(config, userId, products);
}

async function resolveTargetRoles(opts: SkillUpdateOptions, config: SkillRolesConfig): Promise<string[]> {
    if (opts.all) return ["owner"];
    if (opts.role) return parseRoleList(opts.role, config);

    const detected = await detectCurrentUserRoles(config);
    if (detected.length === 0) {
        console.error("No product role found for your account; installing the common skills only.");
        console.error("Ask a product owner to add you in Product Settings, or pass --role.");
        return [];
    }
    for (const {role, products} of detected) {
        console.error(`  ${role}: ${products.join(", ")}`);
    }
    return detected.map(({role}) => role);
}

async function runSkillUpdate(opts: SkillUpdateOptions): Promise<void> {
    const config = loadSkillRolesConfig();
    if (!opts.role && !opts.all) console.error("Detecting your CawPlan product roles...");
    const roles = await resolveTargetRoles(opts, config);
    const target = roles.length > 0 ? skillsForRoles(config, roles) : [...config.common].sort();
    const toPrune = skillsToPrune(await listInstalledSkills(), target, config.optional);

    console.error(`Roles: ${roles.length > 0 ? roles.join(", ") : "(none)"}`);
    console.error(`Install/update ${target.length} skills for cursor, claude-code, codex:`);
    for (const name of target) console.error(`  + ${name}`);
    if (toPrune.length > 0) {
        console.error(`Installed but not in your roles (${toPrune.length}):`);
        for (const name of toPrune) console.error(`  - ${name}`);
    }
    if (opts.dryRun) {
        console.error("Dry run: nothing changed.");
        return;
    }

    await runSkillsAdd(target);

    if (toPrune.length > 0) {
        let prune = Boolean(opts.prune);
        if (!prune && process.stdin.isTTY && process.stdout.isTTY) {
            prune = await promptConfirm(`Uninstall ${toPrune.length} skills not in your roles?`, false);
        }
        if (prune) {
            await runSkillsRemove(toPrune);
        } else {
            console.error("Kept the skills above. To uninstall them later, run:");
            console.error(`  cawplan skill update${opts.role ? ` --role ${opts.role}` : opts.all ? " --all" : ""} --prune`);
        }
    }
    console.error("Skill update completed. Restart the agent so the new instructions take effect.");
}

async function ensureLatestCawplan(): Promise<void> {
    let currentVersion: string;
    let latestVersion: string;
    try {
        currentVersion = await currentCawplanVersion();
        latestVersion = await latestCawplanVersion();
    } catch {
        console.error("Unable to check latest cawplan version. Upgrading...");
        await runCawplanUpgrade();
        return;
    }

    if (!isNewerVersion(latestVersion, currentVersion)) return;
    console.error(`cawplan ${latestVersion} is available (current: ${currentVersion}). Upgrading...`);
    await runCawplanUpgrade();
}

async function ensureAuthenticated(): Promise<void> {
    const state = await getAuthState();
    if (state.active !== "none") return;
    throw new Error("Not authenticated. Run: cawplan auth login");
}

export function registerSkillCommand(program: Command): void {
    const skill = program.command("skill").description("Utilities for CawPlan agent skills");

    skill
        .command("check")
        .description("Check cawplan CLI version and authentication for skills")
        .action(async () => {
            try {
                await ensureLatestCawplan();
                await ensureAuthenticated();
            } catch (err) {
                console.error((err as Error).message);
                process.exit(1);
            }
        });

    skill
        .command("update")
        .description("Install or update the CawPlan agent skills for your product roles (npx skills add)")
        .option("--role <roles>", "Comma-separated roles instead of auto-detection: owner, pm, rd, qa, ux, support, viewer")
        .option("--all", "Install every default skill (same as --role owner)")
        .option("--dry-run", "Print the install/uninstall plan without changing anything")
        .option("--prune", "Uninstall no-longer-matching CawPlan skills without asking")
        .action(async (opts: SkillUpdateOptions) => {
            try {
                await runSkillUpdate(opts);
            } catch (err) {
                console.error(`Error: ${(err as Error).message}`);
                console.error(
                    "If HTTPS cloning failed, try: npx skills add git@github.com:cawcut/skill-cawplan.git -a cursor claude-code codex -g -y"
                );
                process.exit(1);
            }
        });
}
