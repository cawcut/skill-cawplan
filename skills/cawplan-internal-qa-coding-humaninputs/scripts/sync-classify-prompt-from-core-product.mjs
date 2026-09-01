#!/usr/bin/env node
/**
 * Sync references/PRODUCTION_CLASSIFY_PROMPT.md from uid.core-product export.
 *
 * Usage (from repo root):
 *   node skills/cawplan-internal-qa-coding-humaninputs/scripts/sync-classify-prompt-from-core-product.mjs
 *
 * Env:
 *   UID_CORE_PRODUCT=/path/to/uid.core-product  (default: sibling or ~/github/uid.core-product)
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");
const refsDir = path.join(skillRoot, "references");

const coreProduct =
  process.env.UID_CORE_PRODUCT ||
  [path.resolve(skillRoot, "../../../../uid.core-product"), path.join(process.env.HOME || "", "github/uid.core-product")].find(
    (p) => fs.existsSync(path.join(p, "tools/classify-prompt-export/main.go")),
  );

if (!coreProduct) {
  console.error("uid.core-product not found; set UID_CORE_PRODUCT");
  process.exit(1);
}

const raw = execSync("go run ./tools/classify-prompt-export/", {
  cwd: coreProduct,
  encoding: "utf8",
});
const d = JSON.parse(raw);
const catTopic = d.category_definitions + d.topic_definitions;
const gap =
  d.definitions_tail.length > catTopic.length ? d.definitions_tail.slice(catTopic.length) : "";

const snapshot = `# Production Classify Prompt Snapshot

Auto-synced from \`uid.core-product\` via \`go run ./tools/classify-prompt-export/\`.
Re-run \`scripts/sync-classify-prompt-from-core-product.mjs\` after prompt changes ship.

Source commit: run \`git -C ${coreProduct} rev-parse --short HEAD\` locally.

---

## System base

${d.base}

---

## Category definitions

${d.category_definitions}

---

## Topic definitions

${d.topic_definitions}

---

## Gap-analysis guard

${gap || "(empty — check uid.core-product promptAISessionClassifyGapAnalysisGuard)"}
`;

const outPath = path.join(refsDir, "PRODUCTION_CLASSIFY_PROMPT.md");
fs.writeFileSync(outPath, snapshot, "utf8");
console.log(`Wrote ${outPath} (${snapshot.length} chars) from ${coreProduct}`);
