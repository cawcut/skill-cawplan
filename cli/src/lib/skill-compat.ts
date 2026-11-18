import {existsSync, readdirSync, readFileSync, realpathSync, statSync} from "node:fs";
import {homedir} from "node:os";
import {delimiter, join, resolve} from "node:path";
import {compareVersions} from "./cawplan-upgrade.js";

// Skills declare the oldest CLI they work with in SKILL.md frontmatter:
//   min_cli_version: 0.0.67
// `cawplan skill check` takes no arguments (older CLIs would reject new
// flags), so it scans the installed CawPlan skills instead of being told
// which skill is running.

const SKILL_PREFIX = "cawplan-";
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const MIN_CLI_LINE = /^min_cli_version:[ \t]*["']?([^"'\s#]+)["']?[ \t]*(?:#.*)?$/m;
// The contract names released CLI versions only, so no prerelease suffix.
const STABLE_SEMVER = /^\d+\.\d+\.\d+$/;

export interface SkillRequirement {
    name: string;
    path: string;
    minCliVersion: string;
}

export interface CompatibilityResult {
    unsatisfied: SkillRequirement[];
    invalid: SkillRequirement[];
}

export function parseMinCliVersion(skillMd: string): string | undefined {
    const frontmatter = FRONTMATTER.exec(skillMd)?.[1];
    if (!frontmatter) return undefined;
    return MIN_CLI_LINE.exec(frontmatter)?.[1];
}

/**
 * True when the CLI version is below the required stable version. A
 * prerelease sorts before its release (0.1.0-rc.1 does not satisfy 0.1.0),
 * matching `cawplan upgrade`, so the suggested upgrade always helps.
 * An unparsable CLI version (a local build, say) is never treated as too old.
 */
export function cliIsOlderThan(cliVersion: string, required: string): boolean {
    if (!STABLE_SEMVER.test(required)) return false;
    return compareVersions(cliVersion, required) < 0;
}

function readJson(path: string): unknown {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch {
        return undefined;
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Skill directories of the Claude Code plugins that are installed for this
 * user (or this project) and not disabled, from plugins/installed_plugins.json
 * and settings.json `enabledPlugins`. Marketplace checkouts and stale cached
 * versions are not loaded by Claude Code, so they are not scanned.
 */
export function claudePluginSkillDirs(claudeHome: string, cwd: string): string[] {
    const installed = asRecord(asRecord(readJson(join(claudeHome, "plugins", "installed_plugins.json"))).plugins);
    const enabled = asRecord(asRecord(readJson(join(claudeHome, "settings.json"))).enabledPlugins);
    const dirs: string[] = [];
    for (const [key, entries] of Object.entries(installed)) {
        if (enabled[key] === false || !Array.isArray(entries)) continue;
        for (const entry of entries.map(asRecord)) {
            if (typeof entry.installPath !== "string") continue;
            if (typeof entry.projectPath === "string" && resolve(entry.projectPath) !== resolve(cwd)) continue;
            dirs.push(join(entry.installPath, "skills"));
        }
    }
    return dirs;
}

function newestSubdir(dir: string): string | undefined {
    let newest: {path: string; mtime: number} | undefined;
    try {
        for (const entry of readdirSync(dir, {withFileTypes: true})) {
            if (!entry.isDirectory()) continue;
            const path = join(dir, entry.name);
            const mtime = statSync(path).mtimeMs;
            if (!newest || mtime > newest.mtime) newest = {path, mtime};
        }
    } catch {
        return undefined;
    }
    return newest?.path;
}

/**
 * Skill directories of the Codex plugins enabled in config.toml
 * (`[plugins."name@marketplace"]`, `enabled = false` disables). Codex caches
 * them as plugins/cache/<marketplace>/<name>/<version>; the most recently
 * written version is the one in use.
 */
export function codexPluginSkillDirs(codexHome: string): string[] {
    let config: string;
    try {
        config = readFileSync(join(codexHome, "config.toml"), "utf8");
    } catch {
        return [];
    }
    const dirs: string[] = [];
    const sections = config.split(/^(?=\[)/m);
    for (const section of sections) {
        const key = /^\[plugins\."([^"]+)"\][ \t]*$/m.exec(section.split(/\r?\n/, 1)[0] ?? "")?.[1];
        if (!key || /^[ \t]*enabled[ \t]*=[ \t]*false\b/m.test(section)) continue;
        const at = key.lastIndexOf("@");
        if (at <= 0) continue;
        const version = newestSubdir(join(codexHome, "plugins", "cache", key.slice(at + 1), key.slice(0, at)));
        if (version) dirs.push(join(version, "skills"));
    }
    return dirs;
}

/**
 * Directories agents load CawPlan skills from: global skill directories,
 * project-local ones under the current directory, and enabled Claude Code and
 * Codex plugins. CAWPLAN_SKILLS_DIRS replaces the whole list.
 */
export function defaultSkillDirs(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string[] {
    const override = env.CAWPLAN_SKILLS_DIRS?.trim();
    if (override) return override.split(delimiter).filter(Boolean);
    const home = homedir();
    const claudeHome = env.CLAUDE_HOME ?? join(home, ".claude");
    const cursorHome = env.CURSOR_HOME ?? join(home, ".cursor");
    const codexHome = env.CODEX_HOME ?? join(home, ".codex");
    return [
        join(home, ".agents", "skills"),
        join(claudeHome, "skills"),
        join(cursorHome, "skills"),
        join(codexHome, "skills"),
        ...[".agents", ".claude", ".cursor", ".codex"].map((dir) => join(cwd, dir, "skills")),
        ...claudePluginSkillDirs(claudeHome, cwd),
        ...codexPluginSkillDirs(codexHome),
    ];
}

function safeRealpath(path: string): string {
    try {
        return realpathSync(path);
    } catch {
        return path;
    }
}

export function findInstalledSkillRequirements(dirs: string[] = defaultSkillDirs()): SkillRequirement[] {
    const seen = new Set<string>();
    const found: SkillRequirement[] = [];
    for (const dir of dirs) {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            continue;
        }
        for (const name of entries.sort()) {
            if (!name.startsWith(SKILL_PREFIX)) continue;
            const skillMd = join(dir, name, "SKILL.md");
            if (!existsSync(skillMd)) continue;
            // ~/.claude/skills/<name> is usually a symlink into ~/.agents/skills.
            const real = safeRealpath(skillMd);
            if (seen.has(real)) continue;
            seen.add(real);
            let text: string;
            try {
                text = readFileSync(skillMd, "utf8");
            } catch {
                continue;
            }
            const minCliVersion = parseMinCliVersion(text);
            if (minCliVersion) found.push({name, path: skillMd, minCliVersion});
        }
    }
    return found;
}

export function checkSkillCompatibility(cliVersion: string, requirements: SkillRequirement[]): CompatibilityResult {
    const unsatisfied: SkillRequirement[] = [];
    const invalid: SkillRequirement[] = [];
    for (const req of requirements) {
        if (!STABLE_SEMVER.test(req.minCliVersion)) {
            invalid.push(req);
        } else if (cliIsOlderThan(cliVersion, req.minCliVersion)) {
            unsatisfied.push(req);
        }
    }
    return {unsatisfied, invalid};
}

export function formatIncompatibility(cliVersion: string, unsatisfied: SkillRequirement[]): string {
    const required = unsatisfied
        .map((req) => req.minCliVersion)
        .reduce((max, version) => (cliIsOlderThan(max, version) ? version : max));
    const lines = [
        `CLI too old: installed CawPlan skills need cawplan >= ${required} (current: ${cliVersion}):`,
        ...unsatisfied.map((req) => `  ${req.name} requires >= ${req.minCliVersion} (${req.path})`),
        "Run: cawplan upgrade",
    ];
    return lines.join("\n");
}
