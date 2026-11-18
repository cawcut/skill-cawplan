#!/usr/bin/env node
// flow-cawplan-skill setup — install skills for Claude Code, Cursor, Codex, etc.
// Cross-platform (macOS, Linux, Windows): run `node setup.mjs` or `./setup`.
// Idempotent: safe to run multiple times.
import {spawnSync} from "node:child_process";
import {existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync} from "node:fs";
import {homedir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const isWindows = process.platform === "win32";
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const GREEN = paint("32");
const YELLOW = paint("33");
const RED = paint("31");
const BOLD = paint("1");

const ok = (msg) => console.log(`${GREEN("✓")} ${msg}`);
const warn = (msg) => console.log(`${YELLOW("!")} ${msg}`);
const err = (msg) => console.log(`${RED("✗")} ${msg}`);
const info = (msg) => console.log(`${BOLD("→")} ${msg}`);

const ROOT = dirname(fileURLToPath(import.meta.url));
if (!existsSync(join(ROOT, "VERSION")) || !existsSync(join(ROOT, "skills", "cawplan-ticket-create"))) {
    err("Cannot find VERSION or skills/cawplan-ticket-create/ — run this script from the flow-cawplan-skill repo root.");
    process.exit(1);
}

const VERSION = readFileSync(join(ROOT, "VERSION"), "utf8").trim();
console.log();
console.log(BOLD(`CawPlan Skills setup — v${VERSION}`));
console.log();

const HELP = `Usage: ./setup [options]     (Windows: node setup.mjs [options])

  --agent <name>  Force install path for: claude, cursor, codex
                  (auto-detected if omitted)
  --all           Install into all existing agent skill directories
  --role <roles>  Only install skills for these comma-separated roles:
                  owner, pm, rd, qa, ux, support, viewer
                  (see cli/config/skill-roles.json)
  --optional-qa   Also link the optional skills in scripts/optional-skills.json (off by default)
  --skip-cli      Skip 'npm install -g cawplan' (assumes CLI on PATH)
  --skip-auth     Skip 'cawplan auth status' check
  --help          Show this message

Idempotent: safe to run multiple times.

Unlike \`gh skill install\`, this script links skills (directory junctions on Windows)
and can install/check the CLI.`;

let agentOverride = "";
let skipCli = false;
let skipAuth = false;
let installAll = false;
let installOptionalQa = false;
let roles = "";

const argv = process.argv.slice(2);
while (argv.length > 0) {
    const arg = argv.shift();
    if (arg === "--agent") {
        if (argv.length === 0) {
            err("--agent requires a value: claude | cursor | codex");
            process.exit(1);
        }
        agentOverride = argv.shift();
    } else if (arg.startsWith("--agent=")) {
        agentOverride = arg.slice("--agent=".length);
    } else if (arg === "--skip-cli") {
        skipCli = true;
    } else if (arg === "--skip-auth") {
        skipAuth = true;
    } else if (arg === "--all" || arg === "all") {
        installAll = true;
    } else if (arg === "--optional-qa") {
        installOptionalQa = true;
    } else if (arg === "--role") {
        if (argv.length === 0) {
            err("--role requires a value: owner,pm,rd,qa,ux,support,viewer");
            process.exit(1);
        }
        roles = argv.shift();
    } else if (arg.startsWith("--role=")) {
        roles = arg.slice("--role=".length);
    } else if (arg === "--help" || arg === "-h") {
        console.log(HELP);
        process.exit(0);
    } else if (["cursor", "claude", "codex"].includes(arg)) {
        agentOverride = arg;
    } else {
        warn(`Unknown flag: ${arg}`);
    }
}

const HOME = homedir();
const AGENT_HOMES = {
    claude: join(HOME, ".claude"),
    cursor: join(HOME, ".cursor"),
    codex: join(HOME, ".codex"),
};

function detectAgent() {
    if (agentOverride) return agentOverride;
    for (const agent of ["claude", "cursor", "codex"]) {
        if (existsSync(AGENT_HOMES[agent])) return agent;
    }
    return "unknown";
}

function targetForAgent(agent) {
    return Object.hasOwn(AGENT_HOMES, agent) ? join(AGENT_HOMES[agent], "skills") : undefined;
}

function detectAllAgents() {
    return ["claude", "cursor", "codex"].filter((agent) => existsSync(AGENT_HOMES[agent]));
}

let SKILLS = [
    "cawplan-ticket-create",
    "cawplan-product-report",
    "cawplan-product-insights",
    "cawplan-plan-create",
    "cawplan-plan-track",
    "cawplan-ticket-context",
    "cawplan-ticket-attachments",
    "cawplan-coding-commit",
    "cawplan-coding-insights",
    "cawplan-coding-recall",
    "cawplan-requirement-analyze",
    "cawplan-testpoint-generate",
    "cawplan-testcase-generate",
    "cawplan-qa-commit",
];

// Not installed by default — see scripts/optional-skills.json and --optional-qa.
const OPTIONAL_QA_SKILLS = JSON.parse(readFileSync(join(ROOT, "scripts", "optional-skills.json"), "utf8")).skills ?? [];

function skillsForRoles(roleList) {
    const config = JSON.parse(readFileSync(join(ROOT, "cli", "config", "skill-roles.json"), "utf8"));
    const names = roleList.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
    const unknown = names.filter((r) => !Object.hasOwn(config.roles, r));
    if (names.length === 0 || unknown.length > 0) {
        err(`Unknown role(s): ${unknown.join(", ") || "(none)"}. Valid roles: ${Object.keys(config.roles).join(", ")}`);
        process.exit(1);
    }
    let skills = new Set();
    for (const name of names) {
        const role = config.roles[name];
        if (role.all) {
            skills = new Set(config.common);
            for (const other of Object.values(config.roles)) for (const s of other.skills ?? []) skills.add(s);
            break;
        }
        if (role.include_common ?? true) for (const s of config.common) skills.add(s);
        for (const s of role.skills ?? []) skills.add(s);
    }
    return [...skills].sort();
}

if (roles) {
    SKILLS = skillsForRoles(roles);
    ok(`Roles ${roles}: ${SKILLS.length} skills`);
}

const LEGACY_SKILLS = [
    "cawplan-query",
    "cawplan-ticket",
    "cawplan-my-todos",
    "cawplan-user-activity",
    "cawplan-product-activity",
    "cawplan-critical",
    "cawplan-metrics",
    "cawplan-analytics",
    "cawplan-qa-report",
    "cawplan-user-report",
];

// npm and cawplan are .cmd shims on Windows, which Node only runs through a
// shell. Every argument passed here is a constant.
function run(command, args, {quiet = false} = {}) {
    const result = spawnSync(command, args, {stdio: quiet ? "ignore" : "inherit", shell: isWindows});
    return result.status === 0;
}

const hasCawplan = () => run("cawplan", ["--version"], {quiet: true});

if (!skipCli) {
    if (hasCawplan()) {
        ok("cawplan CLI already on PATH");
    } else {
        info("Installing cawplan CLI globally via npm...");
        if (run("npm", ["install", "-g", "cawplan"])) {
            ok("cawplan CLI installed");
        } else {
            err("cawplan CLI install failed. Try: npm install -g cawplan");
            process.exit(1);
        }
    }
} else {
    warn("Skipping cawplan CLI install (--skip-cli)");
}
console.log();

if (!skipAuth) {
    if (hasCawplan() && run("cawplan", ["auth", "status"], {quiet: true})) {
        ok("Authenticated (cawplan auth status)");
    } else {
        warn("Not authenticated or cawplan not available.");
        info("Run: cawplan auth login");
        info("Then re-run this script (or pass --skip-auth).");
        process.exit(1);
    }
} else {
    warn("Skipping auth check (--skip-auth)");
}
console.log();

function isLink(path) {
    try {
        return lstatSync(path).isSymbolicLink();
    } catch {
        return false;
    }
}

function exists(path) {
    try {
        lstatSync(path);
        return true;
    } catch {
        return false;
    }
}

// Junction targets on Windows come back absolute, sometimes with a trailing separator.
function linkPointsTo(link, target) {
    try {
        return resolve(dirname(link), readlinkSync(link)) === resolve(target);
    } catch {
        return false;
    }
}

// Junctions need no admin rights or Developer Mode on Windows.
function link(src, dst, skill) {
    try {
        symlinkSync(src, dst, isWindows ? "junction" : "dir");
        return true;
    } catch (e) {
        err(`${skill}: failed to create link at ${dst} (${e.code ?? e.message})`);
        return false;
    }
}

function installForAgent(agent) {
    const targetDir = targetForAgent(agent);
    if (!targetDir) {
        err(`Unknown agent: ${agent}`);
        return false;
    }

    ok(`Target agent: ${agent}`);
    ok(`Target install path: ${targetDir}/`);
    mkdirSync(targetDir, {recursive: true});

    for (const legacySkill of LEGACY_SKILLS) {
        const legacyDst = join(targetDir, legacySkill);
        if (isLink(legacyDst)) {
            if (linkPointsTo(legacyDst, join(ROOT, "skills", legacySkill))) {
                unlinkSync(legacyDst);
                ok(`${legacySkill} legacy symlink removed`);
            }
        } else if (exists(legacyDst)) {
            warn(`${legacyDst} exists but is not a managed symlink — leaving alone.`);
        }
    }

    for (const skill of SKILLS) {
        const src = join(ROOT, "skills", skill);
        const dst = join(targetDir, skill);
        if (!existsSync(src)) {
            err(`Source missing: ${src}`);
            continue;
        }
        if (isLink(dst)) {
            if (linkPointsTo(dst, src)) {
                ok(`${skill} already symlinked`);
            } else {
                info(`${skill}: replacing stale symlink`);
                unlinkSync(dst);
                if (link(src, dst, skill)) ok(`${skill} symlinked`);
            }
        } else if (exists(dst)) {
            warn(`${dst} exists but is not a symlink to ${src} — leaving alone.`);
        } else if (link(src, dst, skill)) {
            ok(`${skill} symlinked`);
        }
    }

    if (installOptionalQa) {
        info("Installing optional human-input QA skills...");
        for (const skill of OPTIONAL_QA_SKILLS) {
            const src = join(ROOT, "skills", skill);
            const dst = join(targetDir, skill);
            if (!existsSync(src)) {
                err(`Source missing: ${src}`);
                continue;
            }
            if (isLink(dst) && linkPointsTo(dst, src)) {
                ok(`${skill} already symlinked (optional)`);
            } else if (exists(dst) && !isLink(dst)) {
                warn(`${dst} exists but is not a managed symlink — leaving alone.`);
            } else {
                if (isLink(dst)) unlinkSync(dst);
                if (link(src, dst, skill)) ok(`${skill} symlinked (optional)`);
            }
        }
    }
    console.log();

    info(`Verifying ${agent} install...`);
    let verified = true;
    const check = (skill, suffix) => {
        if (existsSync(join(targetDir, skill, "SKILL.md"))) {
            ok(`${skill} present${suffix}`);
        } else {
            err(`${skill} missing at ${join(targetDir, skill, "SKILL.md")}`);
            verified = false;
        }
    };
    for (const skill of SKILLS) check(skill, "");
    if (installOptionalQa) for (const skill of OPTIONAL_QA_SKILLS) check(skill, " (optional)");
    console.log();
    return verified;
}

let agents;
if (installAll) {
    agents = detectAllAgents();
    if (agents.length === 0) {
        warn("Could not find any agent directories under ~/.claude, ~/.cursor, or ~/.codex.");
        info("Re-run with --agent claude|cursor|codex to create a target explicitly.");
        process.exit(1);
    }
} else {
    const agent = detectAgent();
    if (agent === "unknown") {
        warn("Could not auto-detect agent.");
        info("Re-run with --agent claude|cursor|codex, --all, or use: gh skill install cawcut/skill-cawplan");
        process.exit(1);
    }
    agents = [agent];
}

let allOk = true;
for (const agent of agents) {
    if (!installForAgent(agent)) allOk = false;
}

if (!allOk) process.exit(1);

console.log(`${GREEN("Setup complete.")}

Skills installed for: ${agents.join(" ")}
Next: cawplan auth login    (if not done)
      cawplan products list --search "UniFi Access"
      /cawplan-product-report show UniFi Access status report for last week

Alternative install (skills only, no CLI):
  gh skill install cawcut/skill-cawplan --agent <agent> --scope user`);
if (OPTIONAL_QA_SKILLS.length > 0) {
    console.log(`
Optional human-input classify QA skills (not in default bundle):
  ./setup --optional-qa
  INSTALL_INTERNAL_SKILLS=1 npx skills add Ubiquiti-UID/flow-cawplan-skill --skill ${OPTIONAL_QA_SKILLS[0]} -g`);
}
