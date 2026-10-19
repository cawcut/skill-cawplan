import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Marked } from "marked";
import { escapeHtml } from "./ticket-attachment-upload.js";
import { collectLocalRefs, extractReportBody, type ReportFragment } from "./ticket-html-report.js";

/**
 * Content inputs for `tickets attachments add`. Every kind is turned into HTML
 * fragments that go through the same upload + rewrite pipeline:
 *
 * - html:  one HTML file (only its <body> is kept).
 * - md:    one Markdown file, rendered to HTML.
 * - files: plain local files, embedded in the given order.
 * - dir:   a directory laid out by convention, so a folder of files (logs,
 *          screenshots, recordings, docs, test results, ...) can be added
 *          without writing a document:
 *
 *     <dir>/README.md | index.md | summary.md   optional intro, rendered first
 *     <dir>/<section>/                          one section per subdirectory, titled by its name
 *     <dir>/<section>/*.md                      section notes (README.md / notes.md first)
 *     <dir>/<section>/** (other files)          embedded in name order unless the notes already reference them
 *     <dir>/* (other files)                     listed as-is, or under "Attachments" when there is other content
 */

export type ContentSource =
  | { kind: "html" | "md" | "dir"; path: string }
  | { kind: "files"; paths: string[] };

export type ContentSourceKind = ContentSource["kind"];

export interface BuiltContent {
  fragments: ReportFragment[];
  /** Default block id: file / directory name, or a timestamp for plain files. */
  defaultBlockId: string;
}

const INTRO_NAMES = ["readme.md", "index.md", "summary.md"];
const SECTION_NOTE_PRIORITY = ["readme.md", "notes.md", "index.md"];
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".heic", ".heif", ".tif", ".tiff"]);
/** OS / editor droppings that are never meant to be attached. */
const IGNORED_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

// A dedicated instance: the global `marked` may be configured for terminal output.
const markdown = new Marked({ gfm: true, async: false });

export function renderMarkdown(source: string): string {
  return (markdown.parse(source) as string).trim();
}

const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function isIgnored(name: string): boolean {
  return name.startsWith(".") || IGNORED_NAMES.has(name.toLowerCase());
}

function isMarkdown(name: string): boolean {
  return path.extname(name).toLowerCase() === ".md";
}

/** Files under `dir` (recursively), as paths relative to `dir`, in natural order. */
async function listFilesRecursive(dir: string, rel = ""): Promise<string[]> {
  const entries = (await readdir(path.join(dir, rel), { withFileTypes: true }))
    .filter((e) => !isIgnored(e.name))
    .sort((a, b) => naturalCompare(a.name, b.name));
  const out: string[] = [];
  for (const entry of entries) {
    const child = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...(await listFilesRecursive(dir, child)));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

/** HTML that embeds a local file by relative path; rewritten to an attachment later. */
function embedFile(relPath: string): string {
  const ref = escapeHtml(relPath.split(path.sep).join("/"));
  const name = escapeHtml(path.basename(relPath));
  return IMAGE_EXTS.has(path.extname(relPath).toLowerCase())
    ? `<p><img src="${ref}" alt="${name}"></p>`
    : `<p><a href="${ref}">${name}</a></p>`;
}

/** Absolute paths of local files an HTML fragment references. */
function referencedPaths(html: string, baseDir: string): Set<string> {
  return new Set(collectLocalRefs(html, baseDir).files.map((f) => f.path));
}

async function renderMarkdownFile(file: string): Promise<string> {
  return renderMarkdown(await readFile(file, "utf8"));
}

export async function buildDirectoryContent(dir: string): Promise<ReportFragment[]> {
  const root = path.resolve(dir);
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((e) => !isIgnored(e.name))
    .sort((a, b) => naturalCompare(a.name, b.name));
  const fragments: ReportFragment[] = [];
  const embedded = new Set<string>();

  const intro = entries.find((e) => e.isFile() && INTRO_NAMES.includes(e.name.toLowerCase()));
  if (intro) {
    const html = await renderMarkdownFile(path.join(root, intro.name));
    if (html) fragments.push({ html, baseDir: root });
    for (const p of referencedPaths(html, root)) embedded.add(p);
  }

  for (const sectionDir of entries.filter((e) => e.isDirectory())) {
    const sectionRoot = path.join(root, sectionDir.name);
    const files = await listFilesRecursive(sectionRoot);
    const notes = files
      .filter((f) => !f.includes(path.sep) && isMarkdown(f))
      .sort((a, b) => {
        const pa = SECTION_NOTE_PRIORITY.indexOf(a.toLowerCase());
        const pb = SECTION_NOTE_PRIORITY.indexOf(b.toLowerCase());
        return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || naturalCompare(a, b);
      });

    const parts = [`<h3>${escapeHtml(sectionDir.name)}</h3>`];
    for (const note of notes) {
      const html = await renderMarkdownFile(path.join(sectionRoot, note));
      if (html) parts.push(html);
    }
    for (const p of referencedPaths(parts.join("\n"), sectionRoot)) embedded.add(p);

    for (const rel of files) {
      const abs = path.join(sectionRoot, rel);
      if (notes.includes(rel) || embedded.has(abs)) continue;
      parts.push(embedFile(rel));
      embedded.add(abs);
    }
    fragments.push({ html: parts.join("\n"), baseDir: sectionRoot });
  }

  const loose = entries
    .filter((e) => e.isFile() && e !== intro && !isMarkdown(e.name))
    .map((e) => e.name)
    .filter((name) => !embedded.has(path.join(root, name)));
  if (loose.length > 0) {
    // A flat folder of files needs no heading; next to an intro or sections it gets one.
    const heading = fragments.length > 0 ? ["<h3>Attachments</h3>"] : [];
    fragments.push({ html: [...heading, ...loose.map(embedFile)].join("\n"), baseDir: root });
  }
  return fragments;
}

/** Plain files, embedded in the given order (each resolved against its own directory). */
export async function buildFilesContent(paths: string[]): Promise<ReportFragment[]> {
  const fragments: ReportFragment[] = [];
  for (const p of paths) {
    const abs = path.resolve(p);
    const info = await stat(abs).catch(() => undefined);
    if (info?.isDirectory()) throw new Error(`--file is a directory, use --dir instead: ${p}`);
    // A missing file is kept so it is reported in missing[] like any other reference.
    // Absolute reference, so missing[] names the path the caller gave.
    fragments.push({ html: embedFile(abs), baseDir: path.dirname(abs) });
  }
  return fragments;
}

function timestampBlockId(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `attach-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export async function buildContent(source: ContentSource, now = new Date()): Promise<BuiltContent> {
  switch (source.kind) {
    case "html": {
      const abs = path.resolve(source.path);
      return {
        fragments: [{ html: extractReportBody(await readFile(abs, "utf8")), baseDir: path.dirname(abs) }],
        defaultBlockId: path.parse(abs).name,
      };
    }
    case "md": {
      const abs = path.resolve(source.path);
      return {
        fragments: [{ html: await renderMarkdownFile(abs), baseDir: path.dirname(abs) }],
        defaultBlockId: path.parse(abs).name,
      };
    }
    case "dir": {
      const abs = path.resolve(source.path);
      return { fragments: await buildDirectoryContent(abs), defaultBlockId: path.basename(abs) };
    }
    case "files":
      // Each run of loose files is its own block, so repeated adds append instead of replacing.
      return { fragments: await buildFilesContent(source.paths), defaultBlockId: timestampBlockId(now) };
  }
}
