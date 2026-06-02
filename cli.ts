#!/usr/bin/env npx tsx
/**
 * PRM CLI - Clawdbot Skill Entry Point
 *
 * Env:
 *   PRM_API_KEY (required)
 *   PRM_BEARER_TOKEN (optional, overrides PRM_API_KEY when set)
 *   PRM_BASE_URL (optional, default https://core-api-gw.uid.alpha.ui.com)
 *
 * Config:
 *   ~/.config/prm/config.json (optional)
 */

import { prmRequest } from "./prm-tool.js";
import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { homedir } from "os";

interface PrmConfig {
  apiKey?: string;
  bearerToken?: string;
  baseUrl?: string;
  cachePath?: string;
}

function loadConfig(): PrmConfig {
  const configPath = resolve(homedir(), ".config/prm/config.json");
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      return JSON.parse(content);
    } catch {
      console.error(`Warning: Failed to parse ${configPath}`);
    }
  }
  return {};
}

function applyConfigToEnv(config: PrmConfig) {
  if (config.apiKey && !process.env.PRM_API_KEY) {
    process.env.PRM_API_KEY = config.apiKey;
  }
  if (config.bearerToken && !process.env.PRM_BEARER_TOKEN) {
    process.env.PRM_BEARER_TOKEN = config.bearerToken;
  }
  if (config.baseUrl && !process.env.PRM_BASE_URL) {
    process.env.PRM_BASE_URL = config.baseUrl;
  }
  if (config.cachePath && !process.env.PRM_CACHE_PATH) {
    process.env.PRM_CACHE_PATH = config.cachePath;
  }
}

const config = loadConfig();
applyConfigToEnv(config);

function printUsage() {
  console.log(`PRM CLI - Clawdbot Skill

Env:
  PRM_API_KEY (required)
  PRM_BEARER_TOKEN (optional, overrides PRM_API_KEY when set)
  PRM_BASE_URL (optional, default https://core-api-gw.uid.alpha.ui.com)
  PRM_CACHE_PATH (optional, default ~/.config/prm/cache.json)
  PRM_CACHE_TTL_HOURS (optional, default 12)
  PRM_CACHE_TTL_DAYS (optional, deprecated)
Config:
  ~/.config/prm/config.json (optional)

Usage:
  prm api <method> <path> [--query key=val&key2=val2] [--body '{}']
  prm users list [--search q] [--page_size N] [--page_num N] [--refresh]
  prm users query [--email user@ui.com] [--keyword q] [--page_size N] [--page_num N] [--refresh]
  prm todos user <user_id> [--ticket_status CSV] [--issue_status CSV]
  prm cache clear
  prm products list [--search q] [--page_size N] [--page_num N]
  prm product-lines list [--page_size N] [--page_num N]
  prm product-lines detail <product_line_id>
  prm product-lines statuses <product_line_id>
  prm labels list [--search Q] [--product_id PID] [--page_size N] [--page_num N]
  prm versions list <product_id> [--page_size N] [--page_num N]
  prm versions detail <product_id> <version_id>
  prm versions create <product_id> --name X.Y.Z [--major_id <major_uid>] [--description ...]
  prm releases list <product_id> <version_id>
  prm tickets list <product_id> <version_id> --type FEATURE|BUGFIX [--page_size N] [--page_num N]
  prm tickets poll --status CSV [--product_ids CSV] [--product_line_ids CSV] [--since_updated_at TS] [--page_size N] [--page_num N]
  prm tickets search [--time_range 1m|--start_date YYYY-MM-DD --end_date YYYY-MM-DD] [--product_ids CSV] [--product_line_ids CSV] [--version_ids CSV] [--unique_ids CSV] [--display_ids CSV] [--parent_ids CSV] [--type CSV] [--status CSV] [--priority CSV] [--platform CSV] [--assignees CSV] [--search q] [--page_size N] [--page_num N] [--refresh]
  prm tickets create <product_id> [--version_id VID | --backlog] --description ... [--type FEATURE|BUGFIX] [--priority LOW|MEDIUM|HIGH|CRITICAL] [--status KEY] [--assignees CSV] [--parent_id ID] [--label_ids CSV] [--reporter_id ID] [--due_date YYYY-MM-DD]
  prm tickets update <product_id> <version_id> <ticket_id> [--status KEY] [--progress_comment ...] [--priority ...] [--description ...] [--assignees CSV] [--parent_id ID] [--label_ids CSV] [--due_date YYYY-MM-DD] [--expected_version N]
  prm backlog list <product_id> [--page_size N] [--page_num N]
  prm backlog get <product_id> <ticket_id>
  prm tickets relate create <product_id> <version_id> <ticket_id> --target <other_ticket_uid> --type RELATED|BLOCKING|BLOCKED_BY|DUPLICATE
  prm tickets relate update <product_id> <version_id> <ticket_id> <relation_id> --type RELATED|BLOCKING|BLOCKED_BY|DUPLICATE
  prm tickets relate delete <product_id> <version_id> <ticket_id> <relation_id>
  prm tickets relate list   <product_id> <version_id> <ticket_id>
  prm critical list <product_id> [--time_range 1m] [--start YYYY-MM-DD --end YYYY-MM-DD] [--status CSV] [--search q] [--page_size N] [--page_num N]
  prm critical line <product_line_id> [--time_range 1m] [--start YYYY-MM-DD --end YYYY-MM-DD] [--status CSV] [--search q] [--page_size N] [--page_num N]
  prm critical search [--time_range 1m|--days 1m|--start_date YYYY-MM-DD --end_date YYYY-MM-DD] [--status CSV] [--issue_types CSV] [--product_line_ids CSV] [--product_type_ids CSV] [--product_ids CSV] [--tech_owners CSV] [--search q] [--page_size N] [--page_num N] [--refresh]
  prm critical detail <product_id> <critical_issue_id>
  prm critical create <product_id> --body '{}'
  prm critical update <product_id> <critical_issue_id> --body '{}'
  prm critical delete <product_id> <critical_issue_id>
  prm metrics get <product_id> [--time_range 1m] [--start YYYY-MM-DD --end YYYY-MM-DD]
  prm activities query [--time_range 1m] [--page_size N] [--page_num N] [--user_id ID] [--product_id ID] [--activity_types A,B]
  prm config

Examples:
  prm api GET /api/v1/public/openapi/products --query "page_size=10&page_num=1"
  prm users list --search "john" --page_size 10
  prm users query --email "john.doe@ui.com"
  prm users query --keyword "john" --page_size 20
  prm todos user user-123 --ticket_status IN_PROGRESS,NOT_STARTED --issue_status INVESTIGATING
  prm products list --search "UniFi Access"
  prm product-lines list --page_size 10 --page_num 1
  prm product-lines detail unifi
  prm versions list unifi-access
  prm releases list unifi-access version-001
  prm tickets list unifi-access version-001 --type BUGFIX
  prm tickets poll --status NOT_STARTED,IN_PROGRESS --product_line_ids unifi --since_updated_at 1779960000
  prm tickets search --time_range 3m --status IN_PROGRESS,NOT_STARTED --product_ids unifi-access --type FEATURE --search "dashboard"
  prm tickets search --unique_ids tkt-uid-1,tkt-uid-2
  prm tickets search --parent_ids tkt-parent-1            # children of a parent, no --time_range needed
  prm tickets create unifi-access --version_id version-001 --description "Fix login crash" --priority HIGH --status NOT_STARTED --label_ids lbl-bug
  prm tickets create unifi-access --backlog --description "Investigate flaky test" --priority MEDIUM --status NOT_STARTED
  prm tickets create unifi-access --backlog --description "Adapter-created issue"   # priority/status omitted -> backend defaults (MEDIUM + product-line default status)
  prm tickets update unifi-access version-001 ticket-uid --status IN_PROGRESS --progress_comment "Investigation done" --expected_version 3
  prm backlog list unifi-access
  prm tickets relate create unifi-access version-001 ticket-uid --target other-ticket-uid --type BLOCKED_BY
  prm tickets relate list   unifi-access version-001 ticket-uid
  prm product-lines statuses unifi
  prm labels list --product_id unifi-access --search bug
  prm versions create unifi-access --name 1.3.2 --description "Hotfix"
  prm critical list unifi-access --time_range 1m --status OPEN,IN_PROGRESS
  prm critical line unifi --time_range 1m --status OPEN,IN_PROGRESS
  prm critical search --time_range 1m --status OPEN,IN_PROGRESS --product_ids unifi-access --search "connection"
  prm metrics get unifi-access --time_range 1m
  prm activities query --time_range 1m --user_id user-123 --activity_types VERSION,RELEASE
`);
}

type ParseResult = { positional: string[]; flags: Record<string, string> };

function parseArgs(args: string[]): ParseResult {
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        const key = arg.slice(2, eq);
        const value = arg.slice(eq + 1);
        flags[key] = value;
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = "true";
        }
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

type CacheEntry = { fetched_at: number; data: unknown };
type CacheStore = { version: 1; entries: Record<string, CacheEntry> };

function getCachePath() {
  return process.env.PRM_CACHE_PATH || resolve(homedir(), ".config/prm/cache.json");
}

function getCacheTtlMs() {
  const hoursRaw = process.env.PRM_CACHE_TTL_HOURS;
  if (hoursRaw !== undefined) {
    const hours = Number(hoursRaw);
    if (!Number.isFinite(hours) || hours <= 0) return 12 * 60 * 60 * 1000;
    return hours * 60 * 60 * 1000;
  }
  const daysRaw = process.env.PRM_CACHE_TTL_DAYS;
  if (daysRaw !== undefined) {
    const days = Number(daysRaw);
    if (!Number.isFinite(days) || days <= 0) return 12 * 60 * 60 * 1000;
    return days * 24 * 60 * 60 * 1000;
  }
  return 12 * 60 * 60 * 1000;
}

function loadCache(): CacheStore {
  const cachePath = getCachePath();
  if (!existsSync(cachePath)) return { version: 1, entries: {} };
  try {
    const raw = readFileSync(cachePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && typeof parsed.entries === "object") {
      return parsed as CacheStore;
    }
  } catch {
    // Ignore cache read/parse errors.
  }
  return { version: 1, entries: {} };
}

function saveCache(store: CacheStore) {
  const cachePath = getCachePath();
  try {
    mkdirSync(resolve(cachePath, ".."), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(store, null, 2));
  } catch {
    // Ignore cache write errors.
  }
}

function getCache(key: string, refresh: boolean) {
  if (refresh) return undefined;
  const store = loadCache();
  const entry = store.entries[key];
  if (!entry) return undefined;
  const ttlMs = getCacheTtlMs();
  if (Date.now() - entry.fetched_at > ttlMs) return undefined;
  return entry.data;
}

function setCache(key: string, data: unknown) {
  const store = loadCache();
  store.entries[key] = { fetched_at: Date.now(), data };
  saveCache(store);
}

function clearCache() {
  const cachePath = getCachePath();
  try {
    if (existsSync(cachePath)) {
      unlinkSync(cachePath);
    }
  } catch {
    // Ignore cache delete errors.
  }
}

function parseJsonBody(value: string | undefined) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    console.error("Error: --body must be valid JSON");
    process.exit(1);
  }
}

function buildQueryFromFlags(flags: Record<string, string>, allow: string[]) {
  const query: Record<string, string> = {};
  for (const key of allow) {
    if (flags[key] !== undefined) {
      query[key] = flags[key];
    }
  }
  return Object.keys(query).length ? query : undefined;
}

function cacheKey(prefix: string, query: Record<string, string> | undefined) {
  if (!query) return prefix;
  const normalized = Object.keys(query)
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join("&");
  return `${prefix}?${normalized}`;
}

function csvToArray(value: string | undefined) {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${entries.join(",")}}`;
}

function printConfigStatus() {
  const configPath = resolve(homedir(), ".config/prm/config.json");
  const hasConfig = existsSync(configPath);
  const hasKey = Boolean(process.env.PRM_API_KEY);
  const hasBearer = Boolean(process.env.PRM_BEARER_TOKEN);
  const base = process.env.PRM_BASE_URL || "https://core-api-gw.uid.alpha.ui.com";
  const cachePath = process.env.PRM_CACHE_PATH || resolve(homedir(), ".config/prm/cache.json");
  const cacheTtlHours = process.env.PRM_CACHE_TTL_HOURS || "12";
  const cacheTtlDays = process.env.PRM_CACHE_TTL_DAYS;
  console.log(`Config file: ${configPath}${hasConfig ? "" : " (missing)"}`);
  console.log(`PRM_API_KEY: ${hasKey ? "set" : "missing"}`);
  console.log(`PRM_BEARER_TOKEN: ${hasBearer ? "set" : "missing"}`);
  console.log(`PRM_BASE_URL: ${base}`);
  console.log(`PRM_CACHE_PATH: ${cachePath}`);
  console.log(`PRM_CACHE_TTL_HOURS: ${cacheTtlHours}`);
  if (cacheTtlDays) {
    console.log(`PRM_CACHE_TTL_DAYS (deprecated): ${cacheTtlDays}`);
  }
}

export async function runCli(args: string[]) {
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    printUsage();
    return;
  }

  const [subsystem, ...rest] = args;
  const { positional, flags } = parseArgs(rest);

  try {
    if (subsystem === "config") {
      printConfigStatus();
      return;
    }

    if (subsystem === "api") {
      const [method, path] = positional;
      if (!method || !path) {
        console.error("Error: api requires <method> <path>");
        process.exit(1);
      }
      const body = parseJsonBody(flags.body);
      const query = flags.query
        ? Object.fromEntries(
            flags.query.split("&").map((pair) => {
              const [k, v] = pair.split("=");
              return [k, v || ""];
            })
          )
        : undefined;

      const result = await prmRequest({
        method: method.toUpperCase() as any,
        path,
        query,
        body,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (subsystem === "cache") {
      const [action] = positional;
      if (action === "clear") {
        clearCache();
        console.log(JSON.stringify({ code: "SUCCESS", msg: "cache cleared" }, null, 2));
        return;
      }
      console.error("Error: cache requires clear");
      process.exit(1);
    }

    if (subsystem === "users") {
      const [action] = positional;
      const refresh = flags.refresh === "true";
      if (action === "list") {
        const query = buildQueryFromFlags(flags, ["search", "page_size", "page_num"]);
        const key = cacheKey("users:list", query);
        const cached = getCache(key, refresh);
        if (cached) {
          console.log(JSON.stringify(cached, null, 2));
          return;
        }
        const result = await prmRequest({
          method: "GET",
          path: "/api/v1/public/openapi/users",
          query,
        });
        setCache(key, result);
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (action === "query") {
        if (!flags.email && !flags.keyword) {
          console.error("Error: users query requires --email or --keyword");
          process.exit(1);
        }
        const key = cacheKey("users:query", {
          email: flags.email || "",
          keyword: flags.keyword || "",
          page_num: flags.page_num || "",
          page_size: flags.page_size || "",
        });
        const cached = getCache(key, refresh);
        if (cached) {
          console.log(JSON.stringify(cached, null, 2));
          return;
        }
        const body: Record<string, string> = {};
        if (flags.email) {
          body.email = flags.email;
        } else if (flags.keyword) {
          body.keyword = flags.keyword;
          if (flags.page_num) body.page_num = flags.page_num;
          if (flags.page_size) body.page_size = flags.page_size;
        }
        const result = await prmRequest({
          method: "POST",
          path: "/api/v1/public/openapi/users/query",
          body,
        });
        setCache(key, result);
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.error("Error: users requires list|query");
      process.exit(1);
    }

    if (subsystem === "todos") {
      const [action, userId] = positional;
      if (action !== "user") {
        console.error("Error: todos requires 'user'");
        process.exit(1);
      }
      if (!userId) {
        console.error("Error: todos user requires <user_id>");
        process.exit(1);
      }
      const query = buildQueryFromFlags(flags, ["ticket_status", "issue_status"]);
      const result = await prmRequest({
        method: "GET",
        path: `/api/v1/public/openapi/todos/users/${userId}`,
        query,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (subsystem === "products") {
      const [action] = positional;
      if (action !== "list") {
        console.error("Error: products requires 'list'");
        process.exit(1);
      }
      const refresh = flags.refresh === "true";
      const query = buildQueryFromFlags(flags, ["search", "page_size", "page_num", "type_id", "product_line_id"]);
      const key = cacheKey("products:list", query);
      const cached = getCache(key, refresh);
      if (cached) {
        console.log(JSON.stringify(cached, null, 2));
        return;
      }
      const result = await prmRequest({
        method: "GET",
        path: "/api/v1/public/openapi/products",
        query,
      });
      setCache(key, result);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (subsystem === "product-lines") {
      const [action, productLineId] = positional;
      if (action === "list") {
        const refresh = flags.refresh === "true";
        const query = buildQueryFromFlags(flags, ["page_size", "page_num"]);
        const key = cacheKey("product-lines:list", query);
        const cached = getCache(key, refresh);
        if (cached) {
          console.log(JSON.stringify(cached, null, 2));
          return;
        }
        const result = await prmRequest({
          method: "GET",
          path: "/api/v1/public/openapi/product_lines",
          query,
        });
        setCache(key, result);
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (action === "detail") {
        if (!productLineId) {
          console.error("Error: product-lines detail requires <product_line_id>");
          process.exit(1);
        }
        const refresh = flags.refresh === "true";
        const key = `product-lines:detail:${productLineId}`;
        const cached = getCache(key, refresh);
        if (cached) {
          console.log(JSON.stringify(cached, null, 2));
          return;
        }
        const result = await prmRequest({
          method: "GET",
          path: `/api/v1/public/openapi/product_lines/${productLineId}`,
        });
        setCache(key, result);
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (action === "statuses") {
        if (!productLineId) {
          console.error("Error: product-lines statuses requires <product_line_id>");
          process.exit(1);
        }
        const result = await prmRequest({
          method: "GET",
          path: `/api/v1/public/openapi/product_lines/${productLineId}/ticket_statuses`,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.error("Error: product-lines requires list|detail|statuses");
      process.exit(1);
    }

    if (subsystem === "labels") {
      const [action] = positional;
      if (action !== "list") {
        console.error("Error: labels requires 'list'");
        process.exit(1);
      }
      const refresh = flags.refresh === "true";
      const query = buildQueryFromFlags(flags, ["search", "product_id", "page_size", "page_num"]);
      const key = cacheKey("labels:list", query);
      const cached = getCache(key, refresh);
      if (cached) {
        console.log(JSON.stringify(cached, null, 2));
        return;
      }
      const result = await prmRequest({
        method: "GET",
        path: "/api/v1/public/openapi/labels",
        query,
      });
      setCache(key, result);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (subsystem === "backlog") {
      const [action, productId, ticketId] = positional;
      if (!productId) {
        console.error("Error: backlog requires <product_id>");
        process.exit(1);
      }
      if (action === "list") {
        const query = buildQueryFromFlags(flags, ["page_size", "page_num"]);
        const result = await prmRequest({
          method: "GET",
          path: `/api/v1/public/openapi/product/${productId}/tickets`,
          query,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (action === "get") {
        if (!ticketId) {
          console.error("Error: backlog get requires <product_id> <ticket_id>");
          process.exit(1);
        }
        const result = await prmRequest({
          method: "GET",
          path: `/api/v1/public/openapi/product/${productId}/tickets/${ticketId}`,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.error("Error: backlog requires list|get");
      process.exit(1);
    }

    if (subsystem === "versions") {
      const [action, productId, versionId] = positional;
      if (action === "list") {
        if (!productId) {
          console.error("Error: versions list requires <product_id>");
          process.exit(1);
        }
        const query = buildQueryFromFlags(flags, ["page_size", "page_num"]);
        const result = await prmRequest({
          method: "GET",
          path: `/api/v1/public/openapi/product/${productId}/versions`,
          query,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (action === "detail") {
        if (!productId || !versionId) {
          console.error("Error: versions detail requires <product_id> <version_id>");
          process.exit(1);
        }
        const result = await prmRequest({
          method: "GET",
          path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}`,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (action === "create") {
        if (!productId) {
          console.error("Error: versions create requires <product_id>");
          process.exit(1);
        }
        if (!flags.name) {
          console.error("Error: versions create requires --name X.Y.Z");
          process.exit(1);
        }
        const body: Record<string, unknown> = {
          name: flags.name,
        };
        if (flags.major_id) body.major_id = flags.major_id;
        if (flags.description !== undefined) body.description = flags.description;
        const result = await prmRequest({
          method: "POST",
          path: `/api/v1/public/openapi/product/${productId}/versions`,
          body,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.error("Error: versions requires 'list' | 'detail' | 'create'");
      process.exit(1);
    }

    if (subsystem === "releases") {
      const [action, productId, versionId] = positional;
      if (action !== "list") {
        console.error("Error: releases requires 'list'");
        process.exit(1);
      }
      if (!productId || !versionId) {
        console.error("Error: releases list requires <product_id> <version_id>");
        process.exit(1);
      }
      const result = await prmRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/release`,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (subsystem === "tickets") {
      const [action, productId, versionId, ticketId, relationId] = positional;
      if (action === "create") {
        if (!productId) {
          console.error("Error: tickets create requires <product_id>");
          process.exit(1);
        }
        if (!flags.description) {
          console.error("Error: tickets create requires --description");
          process.exit(1);
        }
        // Resolve target version: --backlog omits version_id (product-level ticket);
        // --version_id flag wins; a legacy 2nd positional is treated as version_id.
        let resolvedVersionId: string | undefined;
        if (flags.backlog === "true") {
          resolvedVersionId = undefined;
        } else if (flags.version_id) {
          resolvedVersionId = flags.version_id;
        } else if (versionId) {
          resolvedVersionId = versionId;
        }
        const body: Record<string, unknown> = {
          description: flags.description,
        };
        // type is legacy/optional — backend derives it from label_ids when omitted.
        if (flags.type) body.type = flags.type;
        if (resolvedVersionId) body.version_id = resolvedVersionId;
        // priority/status are optional: when omitted the backend defaults them
        // (priority -> MEDIUM, status -> the product line's default status), so
        // an adapter that only carries a "todo" intent can leave them unset.
        if (flags.priority) body.priority = flags.priority;
        if (flags.status) body.status = flags.status;
        if (flags.parent_id) body.parent_id = flags.parent_id;
        if (flags.reporter_id) body.reporter_id = flags.reporter_id;
        if (flags.due_date) body.due_date = flags.due_date;
        const assignees = csvToArray(flags.assignees);
        if (assignees) body.assignee_ids = assignees;
        const labelIds = csvToArray(flags.label_ids);
        if (labelIds) body.label_ids = labelIds;
        if (flags.comment) body.comment = flags.comment;
        const result = await prmRequest({
          method: "POST",
          path: `/api/v1/public/openapi/product/${productId}/tickets`,
          body,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (action === "update") {
        if (!productId || !versionId || !ticketId) {
          console.error("Error: tickets update requires <product_id> <version_id> <ticket_id>");
          process.exit(1);
        }
        const body: Record<string, unknown> = {};
        if (flags.status) body.status = flags.status;
        if (flags.progress_comment !== undefined) body.progress_comment = flags.progress_comment;
        if (flags.priority) body.priority = flags.priority;
        if (flags.description !== undefined) body.description = flags.description;
        if (flags.comment !== undefined) body.comment = flags.comment;
        if (flags.parent_id) body.parent_id = flags.parent_id;
        if (flags.due_date) body.due_date = flags.due_date;
        const assignees = csvToArray(flags.assignees);
        if (assignees) body.assignee_ids = assignees;
        const labelIds = csvToArray(flags.label_ids);
        if (labelIds) body.label_ids = labelIds;
        // Optimistic lock: pass the version read from the ticket detail. On a
        // 409 conflict the caller should re-read and retry (no auto-retry here).
        const hasExpectedVersion = flags.expected_version !== undefined;
        if (hasExpectedVersion) body.version = Number(flags.expected_version);
        if (Object.keys(body).length === 0) {
          console.error("Error: tickets update requires at least one updatable flag (e.g. --status)");
          process.exit(1);
        }
        try {
          const result = await prmRequest({
            method: "PUT",
            path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets/${ticketId}`,
            body,
          });
          console.log(JSON.stringify(result, null, 2));
        } catch (err: any) {
          if (hasExpectedVersion && err?.status === 409) {
            throw new Error(
              `Conflict: ticket was modified since version ${flags.expected_version}. Re-read the ticket and retry with the latest --expected_version.`
            );
          }
          throw err;
        }
        return;
      }
      if (action === "relate") {
        // positional layout: tickets relate <sub> <product_id> <version_id> <ticket_id> [<relation_id>]
        const sub = positional[1];
        const pid = positional[2];
        const vid = positional[3];
        const tid = positional[4];
        const rid = positional[5];
        if (sub === "create") {
          if (!pid || !vid || !tid) {
            console.error("Error: tickets relate create requires <product_id> <version_id> <ticket_id>");
            process.exit(1);
          }
          if (!flags.target || !flags.type) {
            console.error("Error: tickets relate create requires --target <ticket_uid> --type RELATED|BLOCKING|BLOCKED_BY|DUPLICATE");
            process.exit(1);
          }
          const result = await prmRequest({
            method: "POST",
            path: `/api/v1/public/openapi/product/${pid}/versions/${vid}/tickets/${tid}/relations`,
            body: {
              target_ticket_id: flags.target,
              relation_type: flags.type,
            },
          });
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (sub === "update") {
          if (!pid || !vid || !tid || !rid) {
            console.error("Error: tickets relate update requires <product_id> <version_id> <ticket_id> <relation_id>");
            process.exit(1);
          }
          if (!flags.type) {
            console.error("Error: tickets relate update requires --type RELATED|BLOCKING|BLOCKED_BY|DUPLICATE");
            process.exit(1);
          }
          const result = await prmRequest({
            method: "PUT",
            path: `/api/v1/public/openapi/product/${pid}/versions/${vid}/tickets/${tid}/relations/${rid}`,
            body: { relation_type: flags.type },
          });
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (sub === "delete") {
          if (!pid || !vid || !tid || !rid) {
            console.error("Error: tickets relate delete requires <product_id> <version_id> <ticket_id> <relation_id>");
            process.exit(1);
          }
          const result = await prmRequest({
            method: "DELETE",
            path: `/api/v1/public/openapi/product/${pid}/versions/${vid}/tickets/${tid}/relations/${rid}`,
          });
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (sub === "list") {
          if (!pid || !vid || !tid) {
            console.error("Error: tickets relate list requires <product_id> <version_id> <ticket_id>");
            process.exit(1);
          }
          const result = await prmRequest({
            method: "GET",
            path: `/api/v1/public/openapi/product/${pid}/versions/${vid}/tickets/${tid}/relations`,
          });
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.error("Error: tickets relate requires create|update|delete|list");
        process.exit(1);
      }
      if (action === "list") {
        if (!productId || !versionId) {
          console.error("Error: tickets list requires <product_id> <version_id>");
          process.exit(1);
        }
        if (!flags.type) {
          console.error("Error: tickets list requires --type FEATURE|BUGFIX");
          process.exit(1);
        }
        const query = buildQueryFromFlags(flags, ["type", "page_size", "page_num"]);
        const result = await prmRequest({
          method: "GET",
          path: `/api/v1/public/openapi/product/${productId}/versions/${versionId}/tickets`,
          query,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (action === "poll") {
        const status = csvToArray(flags.status);
        if (!status) {
          console.error("Error: tickets poll requires --status CSV (e.g. NOT_STARTED,IN_PROGRESS)");
          process.exit(1);
        }
        const body: Record<string, unknown> = { status };
        const productIds = csvToArray(flags.product_ids);
        const productLineIds = csvToArray(flags.product_line_ids);
        if (productIds) body.product_ids = productIds;
        if (productLineIds) body.product_line_ids = productLineIds;
        if (flags.since_updated_at !== undefined) {
          body.since_updated_at = Number(flags.since_updated_at);
        }
        if (flags.page_num !== undefined) body.page_num = Number(flags.page_num);
        if (flags.page_size !== undefined) body.page_size = Number(flags.page_size);
        const base = process.env.PRM_BASE_URL || "";
        const path = base.includes("/core-product")
          ? "/api/v1/public/openapi/tickets/poll"
          : "/core-product/api/v1/public/openapi/tickets/poll";
        const result = await prmRequest({
          method: "POST",
          path,
          body,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (action === "search") {
        const uniqueIds = csvToArray(flags.unique_ids);
        const displayIds = csvToArray(flags.display_ids);
        const parentIds = csvToArray(flags.parent_ids);
        // unique_ids / display_ids are exact-match lookups and parent_ids is a
        // bounded child lookup; the backend serves all three without a time
        // window, so --time_range becomes optional when any of them is set.
        const idLookup = Boolean(uniqueIds || displayIds || parentIds);
        if (!idLookup && !flags.time_range && !(flags.start_date && flags.end_date)) {
          console.error("Error: tickets search requires --time_range or --start_date + --end_date (unless --unique_ids/--display_ids/--parent_ids is set)");
          process.exit(1);
        }
        const refresh = flags.refresh === "true";
        const query = buildQueryFromFlags(flags, ["time_range", "start_date", "end_date", "page_size", "page_num"]);
        const body: Record<string, unknown> = {};
        const productIds = csvToArray(flags.product_ids);
        const productLineIds = csvToArray(flags.product_line_ids);
        const versionIds = csvToArray(flags.version_ids);
        const type = csvToArray(flags.type);
        const status = csvToArray(flags.status);
        const priority = csvToArray(flags.priority);
        const platform = csvToArray(flags.platform);
        const assignees = csvToArray(flags.assignees);
        if (productIds) body.product_ids = productIds;
        if (productLineIds) body.product_line_ids = productLineIds;
        if (versionIds) body.version_ids = versionIds;
        if (uniqueIds) body.unique_ids = uniqueIds;
        if (displayIds) body.display_ids = displayIds;
        if (parentIds) body.parent_ids = parentIds;
        if (type) body.type = type;
        if (status) body.status = status;
        if (priority) body.priority = priority;
        if (platform) body.platform = platform;
        if (assignees) body.assignees = assignees;
        if (flags.search) body.search = flags.search;
        const key = `tickets:search:${cacheKey("query", query)}|body=${stableStringify(body)}`;
        const cached = getCache(key, refresh);
        if (cached) {
          console.log(JSON.stringify(cached, null, 2));
          return;
        }
        const base = process.env.PRM_BASE_URL || "";
        const path = base.includes("/core-product")
          ? "/api/v1/public/openapi/tickets/search"
          : "/core-product/api/v1/public/openapi/tickets/search";
        const result = await prmRequest({
          method: "POST",
          path,
          query,
          body,
        });
        setCache(key, result);
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.error("Error: tickets requires list|poll|search|create|update|relate");
      process.exit(1);
    }

    if (subsystem === "critical") {
      const [action, productId, criticalId] = positional;
      if (!productId && action !== "search") {
        console.error("Error: critical requires <product_id>");
        process.exit(1);
      }
      if (action === "list") {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) {
          console.error(
            "Warning: critical list expects a product unique_id (e.g., unifi-access), not a UUID. Use 'products list --search' to find the unique_id."
          );
        }
        const query = buildQueryFromFlags(flags, ["time_range", "start", "end", "status", "search", "page_size", "page_num"]);
        const result = await prmRequest({
          method: "GET",
          path: `/api/v1/public/openapi/product/${productId}/critical_issues`,
          query,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (action === "line") {
        const query = buildQueryFromFlags(flags, ["time_range", "start", "end", "status", "search", "page_size", "page_num"]);
        const result = await prmRequest({
          method: "GET",
          path: `/api/v1/public/openapi/product_line/${productId}/critical_issues`,
          query,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (action === "search") {
        if (!flags.time_range && !flags.days && !(flags.start_date && flags.end_date)) {
          console.error("Error: critical search requires --time_range, --days, or --start_date + --end_date");
          process.exit(1);
        }
        const refresh = flags.refresh === "true";
        const query = buildQueryFromFlags(flags, [
          "time_range",
          "days",
          "start_date",
          "end_date",
          "page_size",
          "page_num",
        ]);
        const body: Record<string, unknown> = {};
        const status = csvToArray(flags.status);
        const issueTypes = csvToArray(flags.issue_types);
        const productLineIds = csvToArray(flags.product_line_ids);
        const productTypeIds = csvToArray(flags.product_type_ids);
        const productIds = csvToArray(flags.product_ids);
        const techOwners = csvToArray(flags.tech_owners);
        if (status) body.status = status;
        if (issueTypes) body.issue_types = issueTypes;
        if (productLineIds) body.product_line_ids = productLineIds;
        if (productTypeIds) body.product_type_ids = productTypeIds;
        if (productIds) body.product_ids = productIds;
        if (techOwners) body.tech_owners = techOwners;
        if (flags.search) body.search = flags.search;
        const key = `critical:search:${cacheKey("query", query)}|body=${stableStringify(body)}`;
        const cached = getCache(key, refresh);
        if (cached) {
          console.log(JSON.stringify(cached, null, 2));
          return;
        }
        const base = process.env.PRM_BASE_URL || "";
        const path = base.includes("/core-product")
          ? "/api/v1/public/openapi/critical_issues/search"
          : "/core-product/api/v1/public/openapi/critical_issues/search";
        const result = await prmRequest({
          method: "POST",
          path,
          query,
          body,
        });
        setCache(key, result);
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (action === "detail") {
        if (!criticalId) {
          console.error("Error: critical detail requires <critical_issue_id>");
          process.exit(1);
        }
        const result = await prmRequest({
          method: "GET",
          path: `/api/v1/public/openapi/product/${productId}/critical_issues/${criticalId}`,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (action === "create") {
        const body = parseJsonBody(flags.body);
        if (!body) {
          console.error("Error: critical create requires --body JSON");
          process.exit(1);
        }
        const result = await prmRequest({
          method: "POST",
          path: `/api/v1/public/openapi/product/${productId}/critical_issues`,
          body,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (action === "update") {
        if (!criticalId) {
          console.error("Error: critical update requires <critical_issue_id>");
          process.exit(1);
        }
        const body = parseJsonBody(flags.body);
        if (!body) {
          console.error("Error: critical update requires --body JSON");
          process.exit(1);
        }
        const result = await prmRequest({
          method: "PUT",
          path: `/api/v1/public/openapi/product/${productId}/critical_issues/${criticalId}`,
          body,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (action === "delete") {
        if (!criticalId) {
          console.error("Error: critical delete requires <critical_issue_id>");
          process.exit(1);
        }
        const result = await prmRequest({
          method: "DELETE",
          path: `/api/v1/public/openapi/product/${productId}/critical_issues/${criticalId}`,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.error("Error: critical requires list|line|search|detail|create|update|delete");
      process.exit(1);
    }

    if (subsystem === "metrics") {
      const [action, productId] = positional;
      if (action !== "get") {
        console.error("Error: metrics requires 'get'");
        process.exit(1);
      }
      if (!productId) {
        console.error("Error: metrics get requires <product_id>");
        process.exit(1);
      }
      const query = buildQueryFromFlags(flags, ["time_range", "start", "end"]);
      const result = await prmRequest({
        method: "GET",
        path: `/api/v1/public/openapi/product/${productId}/metrics`,
        query,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (subsystem === "activities") {
      const [action] = positional;
      if (action !== "query") {
        console.error("Error: activities requires 'query'");
        process.exit(1);
      }
      const query = buildQueryFromFlags(flags, [
        "time_range",
        "page_size",
        "page_num",
      ]);
      const types = flags.activity_types || flags.types;
      const body: Record<string, unknown> = {};
      if (flags.user_id) body.user_id = flags.user_id;
      if (flags.product_id) body.product_id = flags.product_id;
      if (types) {
        body.activity_types = types.split(",").map((t) => t.trim()).filter(Boolean);
      }
      const result = await prmRequest({
        method: "POST",
        path: "/core-product/api/v1/public/openapi/activities/query",
        query,
        body: Object.keys(body).length ? body : undefined,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.error("Error: unknown command");
    printUsage();
    process.exit(1);
  } catch (err: any) {
    console.error(err?.message || String(err));
    process.exit(1);
  }
}

async function main() {
  await runCli(process.argv.slice(2));
}

main();
