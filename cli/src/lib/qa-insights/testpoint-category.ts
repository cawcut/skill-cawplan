import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TESTPOINT_CATEGORY_CODES,
  type AutoMappableCategoryCode,
  type TestPointCategoryCode,
} from "./types.js";

type UnicodeNormalizationForm = "NFC" | "NFD" | "NFKC" | "NFKD";

interface CategoryMappingNormalization {
  unicode: string;
  trim: boolean;
  english_case: string;
  match: string;
  collapse_internal_whitespace: boolean;
  substring_match: boolean;
  fuzzy_match: boolean;
  llm_fallback: boolean;
}

interface CategoryMappingEntry {
  code: TestPointCategoryCode;
  labels: { zh: string; en: string };
  aliases: { zh: string[]; en: string[] };
  auto_mappable: boolean;
}

interface CategoryMappingManifest {
  version: string;
  classification: {
    source: string;
    source_index: number;
    unmatched_result: null;
    automatic_other: boolean;
  };
  normalization: CategoryMappingNormalization;
  categories: CategoryMappingEntry[];
}

export interface TestPointCategoryMapping {
  readonly version: string;
  readonly lookup: ReadonlyMap<string, AutoMappableCategoryCode>;
  normalize(value: string): string;
}

export const TESTPOINT_CATEGORY_MAPPING_VERSION = "qa-testpoint-category/v1" as const;

const manifestRequire = createRequire(import.meta.url);
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(
  moduleDirectory,
  "../../../config/qa-testpoint-category-mapping.v1.json",
);

function fail(message: string): never {
  throw new Error(`qa-testpoint-category-mapping.v1.json: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${path} must be an object`);
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${path} must be a non-empty string`);
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(`${path} must be a boolean`);
  return value;
}

function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value.map((item, index) => requireString(item, `${path}[${index}]`));
}

function parseNormalization(value: unknown): CategoryMappingNormalization {
  const raw = requireRecord(value, "normalization");
  const normalization: CategoryMappingNormalization = {
    unicode: requireString(raw.unicode, "normalization.unicode"),
    trim: requireBoolean(raw.trim, "normalization.trim"),
    english_case: requireString(raw.english_case, "normalization.english_case"),
    match: requireString(raw.match, "normalization.match"),
    collapse_internal_whitespace: requireBoolean(
      raw.collapse_internal_whitespace,
      "normalization.collapse_internal_whitespace",
    ),
    substring_match: requireBoolean(raw.substring_match, "normalization.substring_match"),
    fuzzy_match: requireBoolean(raw.fuzzy_match, "normalization.fuzzy_match"),
    llm_fallback: requireBoolean(raw.llm_fallback, "normalization.llm_fallback"),
  };

  if (normalization.unicode !== "NFKC") fail("normalization.unicode must be NFKC");
  if (!normalization.trim) fail("normalization.trim must be true");
  if (normalization.english_case !== "lowercase") {
    fail("normalization.english_case must be lowercase");
  }
  if (normalization.match !== "exact") fail("normalization.match must be exact");
  if (normalization.collapse_internal_whitespace) {
    fail("normalization.collapse_internal_whitespace must be false");
  }
  if (normalization.substring_match) fail("normalization.substring_match must be false");
  if (normalization.fuzzy_match) fail("normalization.fuzzy_match must be false");
  if (normalization.llm_fallback) fail("normalization.llm_fallback must be false");

  return normalization;
}

function normalizeWithManifest(
  value: string,
  normalization: CategoryMappingNormalization,
): string {
  let normalized = value.normalize(normalization.unicode as UnicodeNormalizationForm);
  if (normalization.trim) normalized = normalized.trim();
  if (normalization.english_case === "lowercase") normalized = normalized.toLowerCase();
  return normalized;
}

function parseCategory(value: unknown, index: number): CategoryMappingEntry {
  const path = `categories[${index}]`;
  const raw = requireRecord(value, path);
  const code = requireString(raw.code, `${path}.code`);
  if (!TESTPOINT_CATEGORY_CODES.includes(code as TestPointCategoryCode)) {
    fail(`${path}.code contains unknown code ${code}`);
  }

  const labels = requireRecord(raw.labels, `${path}.labels`);
  const aliases = requireRecord(raw.aliases, `${path}.aliases`);
  return {
    code: code as TestPointCategoryCode,
    labels: {
      zh: requireString(labels.zh, `${path}.labels.zh`),
      en: requireString(labels.en, `${path}.labels.en`),
    },
    aliases: {
      zh: requireStringArray(aliases.zh, `${path}.aliases.zh`),
      en: requireStringArray(aliases.en, `${path}.aliases.en`),
    },
    auto_mappable: requireBoolean(raw.auto_mappable, `${path}.auto_mappable`),
  };
}

export function createTestPointCategoryMapping(input: unknown): TestPointCategoryMapping {
  const raw = requireRecord(input, "manifest");
  const version = requireString(raw.version, "version");
  if (version !== TESTPOINT_CATEGORY_MAPPING_VERSION) {
    fail(`unsupported version ${version}`);
  }

  const classification = requireRecord(raw.classification, "classification");
  if (classification.source !== "tags[0]" || classification.source_index !== 0) {
    fail("classification source must be tags[0] at index 0");
  }
  if (classification.unmatched_result !== null) {
    fail("classification.unmatched_result must be null");
  }
  if (classification.automatic_other !== false) {
    fail("classification.automatic_other must be false");
  }

  const normalization = parseNormalization(raw.normalization);
  if (!Array.isArray(raw.categories)) fail("categories must be an array");
  const categories = raw.categories.map(parseCategory);
  const codes = categories.map((category) => category.code);
  if (
    codes.length !== TESTPOINT_CATEGORY_CODES.length ||
    TESTPOINT_CATEGORY_CODES.some((code) => !codes.includes(code)) ||
    new Set(codes).size !== codes.length
  ) {
    fail(`categories must contain each of the ${TESTPOINT_CATEGORY_CODES.length} codes exactly once`);
  }

  const other = categories.find((category) => category.code === "OTHER");
  if (!other || other.auto_mappable) fail("OTHER must set auto_mappable to false");
  if (other.aliases.zh.length !== 0 || other.aliases.en.length !== 0) {
    fail("OTHER must not define automatic aliases");
  }
  for (const category of categories) {
    if (category.code !== "OTHER" && !category.auto_mappable) {
      fail(`${category.code} must set auto_mappable to true`);
    }
  }

  const lookup = new Map<string, AutoMappableCategoryCode>();
  for (const category of categories) {
    if (!category.auto_mappable) continue;
    if (category.code === "OTHER") fail("OTHER must set auto_mappable to false");
    const code: AutoMappableCategoryCode = category.code;
    const terms = [
      category.labels.zh,
      category.labels.en,
      ...category.aliases.zh,
      ...category.aliases.en,
    ];
    for (const term of terms) {
      const key = normalizeWithManifest(term, normalization);
      if (!key) fail(`${category.code} contains an empty normalized mapping key`);
      if (lookup.has(key)) {
        fail(`duplicate normalized mapping key ${JSON.stringify(key)}`);
      }
      lookup.set(key, code);
    }
  }

  return {
    version,
    lookup,
    normalize: (value: string) => normalizeWithManifest(value, normalization),
  };
}

let mapping: TestPointCategoryMapping | undefined;

function getTestPointCategoryMapping(): TestPointCategoryMapping {
  if (!mapping) {
    const manifest = manifestRequire(manifestPath) as unknown;
    mapping = createTestPointCategoryMapping(manifest);
  }
  return mapping;
}

export function classifyTestPointCategory(
  tags: readonly string[],
): AutoMappableCategoryCode | null {
  const mapping = getTestPointCategoryMapping();
  const primaryTag = tags[0];
  if (typeof primaryTag !== "string") return null;
  return mapping.lookup.get(mapping.normalize(primaryTag)) ?? null;
}
