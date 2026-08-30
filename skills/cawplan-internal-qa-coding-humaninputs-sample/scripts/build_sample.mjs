#!/usr/bin/env node
/**
 * Fetch human-input logs via cawplan CLI and emit a classify labeling fixture JSON.
 * Context preprocessing matches uid.core-product ClassifyPrevAssistantTail /
 * ClassifyAssistantSnippet (prev = last paragraph of previous assistant in session;
 * assistant stored raw; editor shows first 3 paragraphs).
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyPrevAssistantTail } from "./classify_context.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(__dirname, "..");

function usage() {
  console.error(`Usage: node scripts/build_sample.mjs [options]

Options:
  --from YYYY-MM-DD       Start date (required unless --date)
  --to YYYY-MM-DD         End date (defaults to --from)
  --date YYYY-MM-DD       Single-day shorthand
  --member <git-member>   Filter by report member key
  --product <name>        Resolve product name via cawplan products list
  --product-id <id>       Filter by product unique_id
  --user-id <id>          With --product-id: filter rows to one PRM user
  --session-id <id>       Keep only one AI session
  --one-session           Auto-pick the session with the most rows in range
  --limit <n>             Max items in output (default 20)
  --output <path>         Output JSON path (default: ./human-input-sample-<ts>.json)
  --copy-for-editor       Also copy to assets/samples/latest.json for the web editor
  --help                  Show this help
`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    limit: 20,
    copyForEditor: false,
    oneSession: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usage();
    else if (a === "--copy-for-editor") opts.copyForEditor = true;
    else if (a === "--one-session") opts.oneSession = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2).replace(/-/g, "_");
      const val = argv[++i];
      if (val == null || val.startsWith("--")) {
        console.error(`Missing value for ${a}`);
        usage();
      }
      opts[key] = val;
    } else {
      console.error(`Unknown arg: ${a}`);
      usage();
    }
  }
  if (opts.date && !opts.from) opts.from = opts.to = opts.date;
  if (!opts.from) {
    console.error("--from (or --date) is required");
    usage();
  }
  if (!opts.to) opts.to = opts.from;
  opts.limit = Number(opts.limit);
  if (!Number.isFinite(opts.limit) || opts.limit < 1) {
    console.error("--limit must be a positive integer");
    process.exit(1);
  }
  return opts;
}

function runCawplan(args) {
  let out;
  try {
    out = execFileSync("cawplan", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const msg = err?.stderr || err?.message || "cawplan failed";
    throw new Error(`cawplan ${args.join(" ")} failed: ${msg}`);
  }
  const parsed = JSON.parse(out);
  if (parsed?.code && parsed.code !== "SUCCESS") {
    throw new Error(`cawplan ${args.join(" ")}: ${parsed.msg || parsed.code}`);
  }
  return parsed;
}

function resolveProductId(name) {
  const resp = runCawplan(["products", "list", "--search", name]);
  const items = resp?.data?.items ?? resp?.data ?? [];
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    throw new Error(`No product matched search: ${name}`);
  }
  if (list.length > 1) {
    const names = list.map((p) => `${p.name ?? p.unique_id} (${p.unique_id})`).join(", ");
    throw new Error(`Ambiguous product "${name}": ${names}`);
  }
  return list[0].unique_id;
}

function fetchAllRows(opts) {
  const productId = opts.product_id || (opts.product ? resolveProductId(opts.product) : "");
  const baseArgs = productId
    ? ["session", "product-human-input-logs", "--product-id", productId]
    : ["session", "human-input-logs"];

  const flags = [
    ...baseArgs,
    "--from",
    opts.from,
    "--to",
    opts.to,
    "--page-size",
    "100",
  ];
  if (opts.member) flags.push("--member", opts.member);
  if (productId && opts.user_id) flags.push("--user-id", opts.user_id);
  if (opts.product && !productId) flags.push("--product", opts.product);

  const rows = [];
  let page = 1;
  while (page <= 200) {
    let resp;
    try {
      resp = runCawplan([...flags, "--page-num", String(page)]);
    } catch (err) {
      if (page === 1) throw err;
      break;
    }
    const items = resp?.data?.items ?? [];
    if (!items.length) break;
    rows.push(...items);
    const total = Number(resp?.data?.total ?? 0);
    if (items.length < 100) break;
    if (total > 0 && page * 100 >= total) break;
    page += 1;
  }
  return rows.filter((r) => String(r.content ?? "").trim() !== "");
}

function pickSessionId(rows, opts) {
  if (opts.session_id) return opts.session_id;
  if (!opts.oneSession) return "";
  const counts = new Map();
  for (const r of rows) {
    const sid = r.session_id;
    if (!sid) continue;
    counts.set(sid, (counts.get(sid) ?? 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [sid, n] of counts) {
    if (n > bestN) {
      best = sid;
      bestN = n;
    }
  }
  return best;
}

function sortRowsChronological(rows) {
  return [...rows].sort((a, b) => {
    const ta = String(a.start_time ?? a.session_time ?? "");
    const tb = String(b.start_time ?? b.session_time ?? "");
    if (ta !== tb) return ta.localeCompare(tb);
    return String(a.unique_id ?? "").localeCompare(String(b.unique_id ?? ""));
  });
}

function takeRecentRows(rows, limit) {
  const ranked = [...rows].sort((a, b) => {
    const ta = String(a.start_time ?? a.session_time ?? "");
    const tb = String(b.start_time ?? b.session_time ?? "");
    if (ta !== tb) return tb.localeCompare(ta);
    return String(b.unique_id ?? "").localeCompare(String(a.unique_id ?? ""));
  });
  return sortRowsChronological(ranked.slice(0, limit));
}

function sortRows(rows) {
  return sortRowsChronological(rows);
}

function buildSessionTimelines(rows) {
  const map = new Map();
  for (const row of rows) {
    const sid = String(row.session_id ?? "");
    if (!sid) continue;
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid).push(row);
  }
  for (const [sid, list] of map) {
    map.set(sid, sortRowsChronological(list));
  }
  return map;
}

function rowKey(row) {
  return String(row.unique_id ?? `${row.start_time ?? ""}:${row.content ?? ""}`);
}

function findPreviousAssistant(timelines, row) {
  const sid = String(row.session_id ?? "");
  const list = timelines.get(sid);
  if (!list?.length) return null;
  const key = rowKey(row);
  const idx = list.findIndex((r) => rowKey(r) === key);
  if (idx <= 0) return null;
  const prevRow = list[idx - 1];
  if (!prevRow?.assistant_message) return null;
  return classifyPrevAssistantTail(prevRow.assistant_message);
}

function buildSample(rows, opts, productId) {
  const sessionId = pickSessionId(rows, opts);
  const timelines = buildSessionTimelines(rows);
  let filtered;
  if (sessionId) {
    filtered = takeRecentRows(rows.filter((r) => r.session_id === sessionId), opts.limit);
  } else {
    filtered = takeRecentRows(rows, opts.limit);
  }

  const items = [];
  let turn = 0;
  for (const row of filtered) {
    turn += 1;
    items.push({
      turn_index: turn,
      unique_id: row.unique_id ?? null,
      session_id: row.session_id ?? null,
      session_title: row.session_title ?? null,
      start_time: row.start_time ?? row.session_time ?? null,
      content: String(row.content ?? "").trim(),
      assistant_message: row.assistant_message ?? "",
      prev_assistant_message: findPreviousAssistant(timelines, row),
      cloud_category: row.cloud_category ?? row.category ?? null,
      cloud_topic: row.cloud_topic ?? row.topic ?? null,
      expected_categories: [],
      expected_topic: "",
      expected_reason: "",
      review_required: false,
    });
  }

  const sessionIds = [...new Set(items.map((i) => i.session_id).filter(Boolean))];
  const first = filtered[0] ?? {};
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

  return {
    doc: {
      processed_at: now.toISOString(),
      source_query: {
        from: opts.from,
        to: opts.to,
        member: opts.member ?? null,
        product: opts.product ?? null,
        product_id: productId || null,
        user_id: opts.user_id ?? null,
        session_id: sessionId || null,
        one_session: opts.oneSession,
        limit: opts.limit,
      },
      session_id: sessionId || (sessionIds.length === 1 ? sessionIds[0] : null),
      session_title: sessionId
        ? (first.session_title ?? null)
        : sessionIds.length === 1
          ? (items.find((i) => i.session_title)?.session_title ?? null)
          : null,
      sessions_in_sample: sessionIds.length,
      fetched_row_count: rows.length,
      item_count: items.length,
      prev_assistant_message_rule:
        "last paragraph of the immediately previous turn's assistant in the SAME session; resolved from all rows fetched in the date range, not only the selected N",
      assistant_message_rule:
        "stored raw from API; classify payload uses first 3 paragraphs after same cleanup, max 1200 runes",
      items,
    },
    defaultOut: `human-input-sample-${ts}.json`,
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const productId =
    opts.product_id || (opts.product ? resolveProductId(opts.product) : "");
  const rows = fetchAllRows({ ...opts, product_id: productId });
  if (!rows.length) {
    console.error("No human-input rows returned for the given filters.");
    process.exit(1);
  }
  const { doc, defaultOut } = buildSample(rows, opts, productId);
  const outPath = resolve(process.cwd(), opts.output ?? defaultOut);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`Wrote ${itemsSummary(doc)} -> ${outPath}`);

  if (opts.copyForEditor) {
    const editorPath = join(SKILL_ROOT, "assets", "samples", "latest.json");
    mkdirSync(dirname(editorPath), { recursive: true });
    writeFileSync(editorPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    copyFileSync(
      join(SKILL_ROOT, "scripts", "classify_context.mjs"),
      join(SKILL_ROOT, "assets", "js", "classify_context.mjs"),
    );
    console.log(`Copied for editor -> ${editorPath}`);
    console.log(
      "\nOpen label editor:\n" +
        `  cd ${join(SKILL_ROOT, "assets")}\n` +
        "  python3 -m http.server 8765\n" +
        "  # browser: http://localhost:8765/label-editor.html\n",
    );
  }
}

function itemsSummary(doc) {
  const base = `${doc.item_count} item(s) from ${doc.sessions_in_sample ?? "?"} session(s)`;
  if (doc.session_title) return `${base}, session "${doc.session_title}"`;
  return `${base} (most recent by start_time; prev from ${doc.fetched_row_count ?? "?"} fetched rows)`;
}

main();
