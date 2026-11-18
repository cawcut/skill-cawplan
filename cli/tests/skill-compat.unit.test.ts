import {mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {delimiter, join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    checkSkillCompatibility,
    cliIsOlderThan,
    defaultSkillDirs,
    claudePluginSkillDirs,
    codexPluginSkillDirs,
    findInstalledSkillRequirements,
    formatIncompatibility,
    parseMinCliVersion,
} from "../src/lib/skill-compat.js";

function skillMd(fields: string): string {
    return `---\nversion: 0.2.13\nname: x\n${fields}\n---\n\n# Body\nmin_cli_version: 9.9.9\n`;
}

describe("parseMinCliVersion", () => {
    it("reads the frontmatter field", () => {
        expect(parseMinCliVersion(skillMd("min_cli_version: 0.0.67"))).toBe("0.0.67");
    });

    it("accepts quotes, comments and CRLF", () => {
        expect(parseMinCliVersion(skillMd('min_cli_version: "0.1.0" # pinned'))).toBe("0.1.0");
        expect(parseMinCliVersion("---\r\nname: x\r\nmin_cli_version: 0.0.70\r\n---\r\n")).toBe("0.0.70");
    });

    it("ignores the body and files without frontmatter", () => {
        expect(parseMinCliVersion(skillMd("argument-hint: x"))).toBeUndefined();
        expect(parseMinCliVersion("min_cli_version: 1.0.0\n")).toBeUndefined();
    });
});

describe("checkSkillCompatibility", () => {
    const req = (name: string, minCliVersion: string) => ({name, path: `/s/${name}/SKILL.md`, minCliVersion});

    it("passes when the CLI is at or above every requirement", () => {
        expect(checkSkillCompatibility("0.0.67", [req("a", "0.0.67"), req("b", "0.0.10")])).toEqual({
            unsatisfied: [],
            invalid: [],
        });
    });

    it("reports skills that need a newer CLI and malformed values separately", () => {
        const result = checkSkillCompatibility("0.0.67", [
            req("a", "0.0.68"),
            req("b", "latest"),
            req("c", "0.0.1"),
            req("d", "0.1.0-rc.1"),
        ]);
        expect(result.unsatisfied.map((r) => r.name)).toEqual(["a"]);
        expect(result.invalid.map((r) => r.name)).toEqual(["b", "d"]);
    });

    it("orders a prerelease CLI before its release", () => {
        expect(cliIsOlderThan("0.1.0-rc.1", "0.1.0")).toBe(true);
        expect(cliIsOlderThan("0.1.0", "0.1.0")).toBe(false);
        expect(cliIsOlderThan("0.1.1-rc.1", "0.1.0")).toBe(false);
        expect(cliIsOlderThan("0.0.9", "0.0.10")).toBe(true);
        expect(cliIsOlderThan("dev", "0.0.10")).toBe(false);
    });

    it("tells the user to upgrade and names the highest requirement", () => {
        const message = formatIncompatibility("0.0.67", [req("a", "0.0.68"), req("b", "0.1.0")]);
        expect(message).toContain("CLI too old: installed CawPlan skills need cawplan >= 0.1.0 (current: 0.0.67)");
        expect(message).toContain("a requires >= 0.0.68");
        expect(message).toContain("Run: cawplan upgrade");
    });
});

describe("findInstalledSkillRequirements", () => {
    let root: string;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), "skill-compat-"));
    });

    afterEach(() => {
        rmSync(root, {recursive: true, force: true});
    });

    function writeSkill(dir: string, name: string, fields: string): string {
        const skillDir = join(dir, name);
        mkdirSync(skillDir, {recursive: true});
        writeFileSync(join(skillDir, "SKILL.md"), skillMd(fields));
        return skillDir;
    }

    it("collects cawplan skills, skips others and de-duplicates symlinked installs", () => {
        const agents = join(root, "agents");
        const claude = join(root, "claude");
        mkdirSync(claude, {recursive: true});
        const target = writeSkill(agents, "cawplan-my-work", "min_cli_version: 0.0.67");
        writeSkill(agents, "cawplan-no-field", "argument-hint: x");
        writeSkill(agents, "other-skill", "min_cli_version: 9.9.9");
        symlinkSync(target, join(claude, "cawplan-my-work"), "junction");
        writeSkill(claude, "cawplan-too-new", "min_cli_version: 9.9.9");

        const found = findInstalledSkillRequirements([agents, claude, join(root, "missing")]);
        expect(found.map((r) => [r.name, r.minCliVersion])).toEqual([
            ["cawplan-my-work", "0.0.67"],
            ["cawplan-too-new", "9.9.9"],
        ]);
    });

    it("checks only enabled, installed Claude Code plugins and project-local skills", () => {
        const claudeHome = join(root, "claude-home");
        const project = join(root, "project");
        const cache = join(claudeHome, "plugins", "cache", "mkt", "cawplan");
        writeSkill(join(cache, "0.2.14", "skills"), "cawplan-a", "min_cli_version: 0.0.70");
        // Stale cached version and the marketplace checkout are not loaded by Claude Code.
        writeSkill(join(cache, "0.2.99", "skills"), "cawplan-stale", "min_cli_version: 9.9.9");
        writeSkill(join(claudeHome, "plugins", "marketplaces", "mkt", "skills"), "cawplan-checkout", "min_cli_version: 9.9.9");
        writeSkill(join(claudeHome, "plugins", "cache", "mkt", "off", "1.0.0", "skills"), "cawplan-off", "min_cli_version: 9.9.9");
        writeSkill(join(claudeHome, "plugins", "cache", "mkt", "other", "1.0.0", "skills"), "cawplan-other", "min_cli_version: 9.9.9");
        writeSkill(join(project, ".claude", "skills"), "cawplan-b", "min_cli_version: 0.0.71");
        writeFileSync(
            join(claudeHome, "plugins", "installed_plugins.json"),
            JSON.stringify({
                version: 2,
                plugins: {
                    "cawplan@mkt": [{scope: "user", installPath: join(cache, "0.2.14")}],
                    "off@mkt": [{scope: "user", installPath: join(claudeHome, "plugins", "cache", "mkt", "off", "1.0.0")}],
                    "other@mkt": [
                        {
                            scope: "project",
                            projectPath: join(root, "elsewhere"),
                            installPath: join(claudeHome, "plugins", "cache", "mkt", "other", "1.0.0"),
                        },
                    ],
                },
            })
        );
        writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({enabledPlugins: {"off@mkt": false}}));

        expect(claudePluginSkillDirs(claudeHome, project)).toEqual([join(cache, "0.2.14", "skills")]);
        const dirs = defaultSkillDirs({CLAUDE_HOME: claudeHome}, project);
        expect(findInstalledSkillRequirements(dirs).map((r) => r.name)).toEqual(["cawplan-b", "cawplan-a"]);
    });

    it("checks only enabled Codex plugins, at their newest cached version", () => {
        const codexHome = join(root, "codex-home");
        const base = join(codexHome, "plugins", "cache", "mkt", "cawplan");
        writeSkill(join(base, "0.2.13", "skills"), "cawplan-old", "min_cli_version: 0.0.60");
        writeSkill(join(base, "0.2.14", "skills"), "cawplan-a", "min_cli_version: 0.0.70");
        utimesSync(join(base, "0.2.13"), new Date(1_000_000), new Date(1_000_000));
        writeSkill(join(codexHome, "plugins", "cache", "mkt", "off", "1.0.0", "skills"), "cawplan-off", "min_cli_version: 9.9.9");
        writeFileSync(
            join(codexHome, "config.toml"),
            [
                'model = "x"',
                '[plugins."cawplan@mkt"]',
                "enabled = true",
                "",
                '[plugins."off@mkt"]',
                "enabled = false",
                "",
                '[plugins."missing@mkt"]',
            ].join("\n")
        );

        expect(codexPluginSkillDirs(codexHome)).toEqual([join(base, "0.2.14", "skills")]);
        expect(codexPluginSkillDirs(join(root, "no-codex"))).toEqual([]);
    });

    it("lets CAWPLAN_SKILLS_DIRS replace the default directories", () => {
        expect(defaultSkillDirs({CAWPLAN_SKILLS_DIRS: ["/a", "/b"].join(delimiter)})).toEqual(["/a", "/b"]);
        expect(defaultSkillDirs({CODEX_HOME: "/codex"})).toContain(join("/codex", "skills"));
    });
});
