import {commandOutput, spawnCommand} from "./portable-spawn.js";

// npm view can hang on a slow or offline registry; skill check must stay fast.
const NPM_VIEW_TIMEOUT_MS = 5000;

interface ParsedVersion {
    core: [number, number, number];
    prerelease: string[];
}

function parseVersion(version: string): ParsedVersion | undefined {
    const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+\S*)?$/.exec(version.trim());
    if (!match) return undefined;
    return {
        core: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
        prerelease: match[4] ? match[4].split(".") : [],
    };
}

// SemVer 2.0 identifier precedence: numeric < alphanumeric, numerics by value.
function comparePrereleaseIds(a: string, b: string): number {
    const aNum = /^\d+$/.test(a);
    const bNum = /^\d+$/.test(b);
    if (aNum && bNum) return Number(a) - Number(b);
    if (aNum !== bNum) return aNum ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * SemVer ordering, including prereleases (0.1.0-rc.1 < 0.1.0). Returns 0 when
 * either side is unparsable, so a local or odd version never triggers an
 * upgrade or a block.
 */
export function compareVersions(a: string, b: string): number {
    const va = parseVersion(a);
    const vb = parseVersion(b);
    if (!va || !vb) return 0;
    for (let i = 0; i < 3; i++) {
        const diff = va.core[i] - vb.core[i];
        if (diff !== 0) return diff;
    }
    if (va.prerelease.length === 0 || vb.prerelease.length === 0) {
        return vb.prerelease.length - va.prerelease.length;
    }
    for (let i = 0; i < Math.min(va.prerelease.length, vb.prerelease.length); i++) {
        const diff = comparePrereleaseIds(va.prerelease[i], vb.prerelease[i]);
        if (diff !== 0) return diff;
    }
    return va.prerelease.length - vb.prerelease.length;
}

export function isNewerVersion(candidate: string, base: string): boolean {
    return compareVersions(candidate, base) > 0;
}

export function currentCawplanVersion(): Promise<string> {
    return commandOutput("cawplan", ["--version"]);
}

export function latestCawplanVersion(): Promise<string> {
    return commandOutput("npm", ["view", "cawplan", "version"], {timeoutMs: NPM_VIEW_TIMEOUT_MS});
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Args for installing one exact, already-resolved version (never a moving tag like "latest"). */
export function buildUpgradeArgs(version: string): string[] {
    const pinned = version.trim();
    if (!SEMVER_RE.test(pinned)) {
        throw new Error(`Refusing to install unpinned or malformed cawplan version: ${JSON.stringify(version)}`);
    }
    return ["install", "-g", `cawplan@${pinned}`];
}

export function runCawplanUpgrade(version: string): Promise<void> {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawnCommand("npm", buildUpgradeArgs(version), {stdio: "inherit"});
        } catch (err) {
            reject(err);
            return;
        }

        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`npm install exited with code ${code ?? "unknown"}`));
        });
    });
}
