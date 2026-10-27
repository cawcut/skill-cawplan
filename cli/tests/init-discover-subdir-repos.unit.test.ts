import { describe, expect, test } from "vitest";
import {
  discoverSubdirRepos,
  normalizeGitHubRemoteUrl,
  type DiscoverSubdirReposDeps,
} from "../src/lib/init/discover-subdir-repos.js";

describe("normalizeGitHubRemoteUrl", () => {
  test("accepts the SCP-style form", () => {
    expect(normalizeGitHubRemoteUrl("git@github.com:acme/repo-a.git")).toBe(
      "https://github.com/acme/repo-a"
    );
  });

  test("accepts the https form", () => {
    expect(normalizeGitHubRemoteUrl("https://github.com/acme/repo-a.git")).toBe(
      "https://github.com/acme/repo-a"
    );
  });

  test("accepts the full ssh:// URL form", () => {
    expect(normalizeGitHubRemoteUrl("ssh://git@github.com/acme/repo-a.git")).toBe(
      "https://github.com/acme/repo-a"
    );
  });

  test("rejects a non-GitHub origin", () => {
    expect(() => normalizeGitHubRemoteUrl("git@gitlab.internal:acme/repo-a.git")).toThrow(
      "origin must be a GitHub repository URL"
    );
  });
});

function makeDeps(opts: {
  dirs: string[];
  gitDirs: Set<string>;
  origins: Record<string, string | Error>;
}): DiscoverSubdirReposDeps {
  return {
    listSubdirectories: (dir) => opts.dirs.map((name) => ({ dir: `${dir}/${name}`, name })),
    hasGitEntry: (dir) => opts.gitDirs.has(dir),
    getOriginUrl: (dir) => {
      const origin = opts.origins[dir];
      if (origin instanceof Error) throw origin;
      if (!origin) throw new Error("no origin");
      return origin;
    },
  };
}

describe("discoverSubdirRepos", () => {
  test("classifies mapped, pending, and skipped repos, ignoring non-git directories", () => {
    const deps = makeDeps({
      dirs: ["repo-a", "repo-b", "repo-c", "repo-d", "not-a-repo"],
      gitDirs: new Set(["/work/repo-a", "/work/repo-b", "/work/repo-c", "/work/repo-d"]),
      origins: {
        "/work/repo-a": "https://github.com/acme/repo-a",
        "/work/repo-b": "https://github.com/acme/repo-b",
        "/work/repo-c": new Error("fatal: no such remote 'origin'"),
        "/work/repo-d": "git@gitlab.internal:acme/repo-d.git",
      },
    });
    const existingMappings = [
      { product_id: "p1", product_name: "Product X", repo_url: "https://github.com/acme/repo-a" },
    ];

    const result = discoverSubdirRepos("/work", existingMappings, deps);

    expect(result.mapped).toEqual([
      {
        dir: "/work/repo-a",
        name: "repo-a",
        repoUrl: "https://github.com/acme/repo-a",
        repoName: "repo-a",
        productId: "p1",
        productName: "Product X",
      },
    ]);
    expect(result.pending).toEqual([
      { dir: "/work/repo-b", name: "repo-b", repoUrl: "https://github.com/acme/repo-b", repoName: "repo-b" },
    ]);
    expect(result.skipped).toEqual([
      { dir: "/work/repo-c", name: "repo-c", reason: "no GitHub origin" },
      { dir: "/work/repo-d", name: "repo-d", reason: "no GitHub origin" },
    ]);
  });

  test("returns empty result when no subdirectory has a .git entry", () => {
    const deps = makeDeps({ dirs: ["file-only"], gitDirs: new Set(), origins: {} });

    const result = discoverSubdirRepos("/work", [], deps);

    expect(result).toEqual({ mapped: [], pending: [], skipped: [] });
  });
});
