import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { escapeHtml, renderAttachmentHtml, type UploadedAttachment } from "./ticket-attachment-upload.js";

/**
 * HTML test reports with local file references (`<img src="./shots/a.png">`,
 * `<a href="rec/a.mp4">`, `<video src=…>`, `data-src=…`) are turned into ticket
 * rich text: every local file is uploaded once and its reference rewritten to
 * the editor's attachment shape. Remote URLs, anchors and data: URIs are left
 * untouched.
 *
 * Parsing is a tag-level scan, not a full HTML parser: it only needs to find
 * these few elements in agent-authored HTML and keeps everything else verbatim.
 */

export const REPORT_FIELDS = ["progress_comment", "comment", "remarks"] as const;
export type ReportField = (typeof REPORT_FIELDS)[number];
export const REPORT_MODES = ["append", "replace"] as const;
export type ReportMode = (typeof REPORT_MODES)[number];

const ATTRS = String.raw`(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*`;
const VIDEO_RE = new RegExp(String.raw`<video\b(${ATTRS})\s*(?:/>|>([\s\S]*?)</video\s*>)`, "gi");
const ANCHOR_RE = new RegExp(String.raw`<a\b(${ATTRS})\s*>[\s\S]*?</a\s*>`, "gi");
const IMG_RE = new RegExp(String.raw`<img\b(${ATTRS})\s*/?>`, "gi");
const OPEN_TAG_RE = new RegExp(String.raw`<([a-zA-Z][a-zA-Z0-9-]*)\b(${ATTRS})\s*(/?)>`, "g");
const SOURCE_RE = new RegExp(String.raw`<source\b(${ATTRS})\s*/?>`, "i");
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

interface HtmlAttr {
  name: string;
  value?: string;
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (m, ent: string) => {
    const e = ent.toLowerCase();
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos" || e === "#39") return "'";
    const code = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

function parseAttrs(text: string): HtmlAttr[] {
  const attrs: HtmlAttr[] = [];
  for (const m of text.matchAll(ATTR_RE)) {
    const raw = m[2] ?? m[3] ?? m[4];
    attrs.push({ name: m[1]!.toLowerCase(), value: raw === undefined ? undefined : decodeEntities(raw) });
  }
  return attrs;
}

function attr(attrs: HtmlAttr[], name: string): string | undefined {
  return attrs.find((a) => a.name === name)?.value;
}

function setAttr(attrs: HtmlAttr[], name: string, value: string, onlyIfMissing = false): HtmlAttr[] {
  const existing = attrs.find((a) => a.name === name);
  if (existing) {
    if (!onlyIfMissing || !existing.value) existing.value = value;
    return attrs;
  }
  return [...attrs, { name, value }];
}

function serializeOpenTag(tag: string, attrs: HtmlAttr[], selfClosing: boolean): string {
  const parts = attrs.map((a) => (a.value === undefined ? a.name : `${a.name}="${escapeHtml(a.value)}"`));
  return `<${tag}${parts.length ? " " + parts.join(" ") : ""}${selfClosing ? " /" : ""}>`;
}

/** True for a reference to a file on disk rather than a URL or in-page anchor. */
export function isLocalRef(value: string | undefined): value is string {
  const v = value?.trim();
  if (!v || v.startsWith("#") || v.startsWith("//")) return false;
  if (/^file:/i.test(v)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(v)) return true; // Windows drive path
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v);
}

/** Resolve a local reference to an existing regular file, or undefined. */
export function resolveLocalRef(value: string, baseDir: string): string | undefined {
  const v = value.trim();
  const candidates: string[] = [];
  if (/^file:/i.test(v)) {
    try {
      candidates.push(fileURLToPath(v));
    } catch {
      return undefined;
    }
  } else {
    const stripped = v.replace(/[?#].*$/, "");
    candidates.push(v, stripped);
    for (const c of [v, stripped]) {
      try {
        candidates.push(decodeURIComponent(c));
      } catch {
        // not percent-encoded
      }
    }
  }
  for (const c of candidates) {
    const abs = path.resolve(baseDir, c);
    try {
      if (statSync(abs).isFile()) return abs;
    } catch {
      // try the next spelling
    }
  }
  return undefined;
}

export type LocalRefElement = "video" | "a" | "img" | "data-src";

export interface LocalRef {
  element: LocalRefElement;
  /** Reference as written in the HTML. */
  ref: string;
  /** Absolute path, or undefined when the file does not exist. */
  path?: string;
  /** Display name hint from the HTML (alt / data-filename / link text is not used). */
  filenameHint?: string;
}

type Replacer = (ref: LocalRef, original: string, attrs: HtmlAttr[], tag?: string, selfClosing?: boolean) => string;

/**
 * Visit each local reference in document order of element kind (video, a,
 * img, then any element carrying data-src). A replaced element is gone for the
 * later passes, so e.g. an <img> inside a local <a> is not visited twice.
 */
function transformLocalRefs(html: string, baseDir: string, replace: Replacer): string {
  const mkRef = (element: LocalRefElement, ref: string, filenameHint?: string): LocalRef => ({
    element,
    ref,
    path: resolveLocalRef(ref, baseDir),
    filenameHint: filenameHint?.trim() || undefined,
  });

  let out = html.replace(VIDEO_RE, (whole, attrText: string, inner: string | undefined) => {
    const attrs = parseAttrs(attrText);
    let src = attr(attrs, "src");
    if (!isLocalRef(src) && inner) {
      const source = SOURCE_RE.exec(inner);
      if (source) src = attr(parseAttrs(source[1]!), "src");
    }
    return isLocalRef(src) ? replace(mkRef("video", src, attr(attrs, "data-filename")), whole, attrs) : whole;
  });
  out = out.replace(ANCHOR_RE, (whole, attrText: string) => {
    const attrs = parseAttrs(attrText);
    const href = attr(attrs, "href");
    return isLocalRef(href) ? replace(mkRef("a", href, attr(attrs, "data-filename") ?? attr(attrs, "download")), whole, attrs) : whole;
  });
  out = out.replace(IMG_RE, (whole, attrText: string) => {
    const attrs = parseAttrs(attrText);
    const src = attr(attrs, "src");
    return isLocalRef(src) ? replace(mkRef("img", src, attr(attrs, "alt")), whole, attrs, "img", whole.endsWith("/>")) : whole;
  });
  out = out.replace(OPEN_TAG_RE, (whole, tag: string, attrText: string, slash: string) => {
    const attrs = parseAttrs(attrText);
    const src = attr(attrs, "data-src");
    return isLocalRef(src)
      ? replace(mkRef("data-src", src, attr(attrs, "data-filename")), whole, attrs, tag, slash === "/")
      : whole;
  });
  return out;
}

/** Use the <body> content of a full HTML document and drop <script>/<style>. */
export function extractReportBody(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html);
  const content = body ? body[1]! : html.replace(/<!doctype[^>]*>/i, "").replace(/<\/?(html|head)\b[^>]*>/gi, "");
  return content
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<title\b[\s\S]*?<\/title\s*>/gi, "")
    .replace(/<(meta|link)\b[^>]*>/gi, "")
    .trim();
}

export interface CollectedRefs {
  /** Distinct local files, in scan order (video, a, img, data-src passes). */
  files: Array<{ path: string; filename: string; refs: string[] }>;
  /** References whose file does not exist. */
  missing: LocalRef[];
}

/** Find every local file the report references (each path once). */
export function collectLocalRefs(html: string, baseDir: string): CollectedRefs {
  const byPath = new Map<string, { path: string; filename: string; refs: string[] }>();
  const missing: LocalRef[] = [];
  transformLocalRefs(html, baseDir, (ref) => {
    if (!ref.path) {
      missing.push(ref);
    } else {
      const entry = byPath.get(ref.path);
      if (entry) {
        if (!entry.refs.includes(ref.ref)) entry.refs.push(ref.ref);
      } else {
        byPath.set(ref.path, { path: ref.path, filename: path.basename(ref.path), refs: [ref.ref] });
      }
    }
    // Consume the element so nested references are not visited by later passes.
    return "";
  });
  return { files: [...byPath.values()], missing };
}

/** Rewrite local references to the uploaded attachments (keyed by absolute path). */
export function rewriteLocalRefs(html: string, baseDir: string, uploaded: Map<string, UploadedAttachment>): string {
  return transformLocalRefs(html, baseDir, (ref, original, attrs, tag, selfClosing) => {
    const file = ref.path ? uploaded.get(ref.path) : undefined;
    if (!file) return original;

    if (ref.element === "img" && file.type === "image") {
      let next = setAttr(attrs, "src", file.url);
      next = setAttr(next, "alt", file.filename, true);
      return serializeOpenTag("img", next, selfClosing ?? false);
    }
    if (ref.element === "data-src" && tag) {
      let next = setAttr(attrs, "data-src", file.url);
      next = setAttr(next, "data-filename", file.filename, true);
      if (file.type !== "video" && file.type !== "image") {
        next = setAttr(next, "data-file-size", String(file.bytes), true);
      }
      return serializeOpenTag(tag, next, selfClosing ?? false);
    }
    return renderAttachmentHtml(file);
  });
}

/** A piece of report HTML whose local references resolve against `baseDir`. */
export interface ReportFragment {
  html: string;
  baseDir: string;
}

/** collectLocalRefs over several fragments, de-duplicating files across them. */
export function collectFragmentRefs(fragments: ReportFragment[]): CollectedRefs {
  const byPath = new Map<string, CollectedRefs["files"][number]>();
  const missing: LocalRef[] = [];
  for (const fragment of fragments) {
    const collected = collectLocalRefs(fragment.html, fragment.baseDir);
    missing.push(...collected.missing);
    for (const file of collected.files) {
      const entry = byPath.get(file.path);
      if (!entry) byPath.set(file.path, file);
      else for (const ref of file.refs) if (!entry.refs.includes(ref)) entry.refs.push(ref);
    }
  }
  return { files: [...byPath.values()], missing };
}

/** rewriteLocalRefs over each fragment, joined in order. */
export function rewriteFragments(fragments: ReportFragment[], uploaded: Map<string, UploadedAttachment>): string {
  return fragments.map((f) => rewriteLocalRefs(f.html, f.baseDir, uploaded)).join("\n");
}

export function normalizeBlockId(raw: string): string {
  const id = raw.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return id.slice(0, 80) || "report";
}

function blockMarkers(blockId: string): { start: string; end: string } {
  return { start: `<!-- cawplan-report:${blockId} -->`, end: `<!-- /cawplan-report:${blockId} -->` };
}

/**
 * Merge a report into a ticket field. `replace` overwrites the whole field;
 * `append` replaces an earlier block with the same id in place, or appends.
 */
export function mergeReportBlock(current: string | null | undefined, report: string, mode: ReportMode, blockId: string): string {
  const { start, end } = blockMarkers(blockId);
  const block = `${start}${report}${end}`;
  const existing = (current ?? "").trim();
  if (mode === "replace" || existing === "") return block;

  const from = existing.indexOf(start);
  const to = from >= 0 ? existing.indexOf(end, from + start.length) : -1;
  if (from >= 0 && to >= 0) {
    return existing.slice(0, from) + block + existing.slice(to + end.length);
  }
  return existing + block;
}
