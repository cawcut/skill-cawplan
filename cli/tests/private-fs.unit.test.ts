import { mkdtempSync, mkdirSync, statSync, chmodSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCache, saveCache } from "../src/lib/cache.js";
import { ensurePrivateDir } from "../src/lib/private-fs.js";

const posix = process.platform !== "win32";
const mode = (p: string) => statSync(p).mode & 0o777;

describe.skipIf(!posix)("private file modes", () => {
  let home: string;
  const saved = { HOME: process.env.HOME, CACHE: process.env.CAWPLAN_CACHE_PATH };
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cawplan-home-"));
    process.env.HOME = home;
    delete process.env.CAWPLAN_CACHE_PATH;
  });
  afterEach(() => {
    process.env.HOME = saved.HOME;
    if (saved.CACHE !== undefined) process.env.CAWPLAN_CACHE_PATH = saved.CACHE;
    else delete process.env.CAWPLAN_CACHE_PATH;
    rmSync(home, { recursive: true, force: true });
  });

  it("creates ~/.cawplan as 0700", async () => {
    await ensurePrivateDir(join(home, ".cawplan"));
    expect(mode(join(home, ".cawplan"))).toBe(0o700);
  });

  it("tightens an existing 0755 ~/.cawplan and writes cache.json as 0600", () => {
    const dir = join(home, ".cawplan");
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    const cache = join(dir, "cache.json");
    writeFileSync(cache, "{}", { mode: 0o644 });
    chmodSync(cache, 0o644);
    saveCache({ version: 1, entries: {} });
    expect(mode(dir)).toBe(0o700);
    expect(mode(cache)).toBe(0o600);
  });

  it("tightens an existing 0755 ~/.cawplan and 0644 cache.json on load (cache hit, no write)", () => {
    const dir = join(home, ".cawplan");
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    const cache = join(dir, "cache.json");
    writeFileSync(cache, JSON.stringify({ version: 1, entries: {} }), { mode: 0o644 });
    chmodSync(cache, 0o644);
    expect(loadCache().version).toBe(1);
    expect(mode(dir)).toBe(0o700);
    expect(mode(cache)).toBe(0o600);
  });

  it("does not chmod a custom cache parent on load", () => {
    const custom = join(home, "shared");
    mkdirSync(custom, { mode: 0o755 });
    chmodSync(custom, 0o755);
    process.env.CAWPLAN_CACHE_PATH = join(custom, "cache.json");
    writeFileSync(join(custom, "cache.json"), "{}", { mode: 0o644 });
    loadCache();
    expect(mode(custom)).toBe(0o755);
    expect(mode(join(custom, "cache.json"))).toBe(0o600);
  });

  it("does not chmod a custom parent directory", async () => {
    const custom = join(home, "shared");
    mkdirSync(custom, { mode: 0o755 });
    chmodSync(custom, 0o755);
    await ensurePrivateDir(custom);
    expect(mode(custom)).toBe(0o755);
  });
});
