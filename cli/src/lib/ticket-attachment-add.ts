import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isInsideBase, sensitivePathReason } from "./attachment-path-policy.js";
import { ApiError, cawplanRequest } from "./http.js";
import {
  uploadTicketAttachmentFiles,
  type FailedAttachment,
  type ResolvedVersionTicket,
  type UploadOptions,
  type UploadedAttachment,
} from "./ticket-attachment-upload.js";
import {
  collectFragmentRefs,
  collectLocalRefs,
  mergeReportBlock,
  normalizeBlockId,
  rewriteFragments,
  type ReportField,
  type ReportFragment,
  type ReportMode,
} from "./ticket-html-report.js";
import { buildContent, renderMarkdown, type ContentSource } from "./ticket-attachment-source.js";

export interface AddAttachmentsOptions extends UploadOptions {
  source: ContentSource;
  /** Markdown shown before the content; local references resolve against the current directory. */
  note?: string;
  field: ReportField;
  mode: ReportMode;
  blockId?: string;
  /** Override the directory local references resolve against (html / md sources only). */
  baseDir?: string;
  /**
   * Let document and note references point outside their base directory
   * (the --dir root, the --md-file/--html-file directory or --base-dir, or the
   * current directory for --note). Credential files stay refused.
   */
  allowOutsideBase?: boolean;
  dryRun?: boolean;
  htmlOut?: string;
  /** Re-read + re-merge attempts when the ticket changed concurrently (409). */
  maxAttempts?: number;
}

export interface AddAttachmentsSummary {
  ticket_id: string;
  display_id?: string;
  source: ContentSource;
  field: ReportField;
  mode: ReportMode;
  block_id: string;
  dry_run: boolean;
  /** Ticket optimistic-lock version after the update (absent on dry run). */
  version?: number;
  html_bytes: number;
  html_out?: string;
  /** `outside_base` marks a file outside its base directory that --allow-outside-base let through. */
  files: Array<{ path: string; filename: string; bytes: number; refs: string[]; outside_base?: true }>;
  uploaded: Array<Omit<UploadedAttachment, "html">>;
  failed: FailedAttachment[];
  missing: Array<{ ref: string; element: string }>;
  /** Referenced files that are refused; nothing is uploaded while any are listed. */
  blocked: BlockedFile[];
}

export interface BlockedFile {
  path: string;
  refs: string[];
  /** outside_base: outside the base directory without --allow-outside-base; sensitive: a credential file. */
  reason: "outside_base" | "sensitive";
  /** For sensitive: the matched location, e.g. `~/.ssh`. */
  detail?: string;
}

/** A fragment plus the directory its references must stay in (unset for explicit --file paths). */
interface ScopedFragment extends ReportFragment {
  root?: string;
}

/** Absolute paths of files a fragment references from outside its root. */
function outsideBaseFiles(fragments: ScopedFragment[]): Set<string> {
  const outside = new Set<string>();
  for (const fragment of fragments) {
    if (!fragment.root) continue;
    for (const file of collectLocalRefs(fragment.html, fragment.baseDir).files) {
      if (!isInsideBase(file.path, fragment.root)) outside.add(file.path);
    }
  }
  return outside;
}

interface TicketSnapshot {
  version?: number;
  display_id?: string;
  value: string;
}

async function readTicketField(ticket: ResolvedVersionTicket, field: ReportField): Promise<TicketSnapshot> {
  const payload = (await cawplanRequest({
    method: "GET",
    path: `/api/v1/public/openapi/product/${ticket.productId}/versions/${ticket.versionId}/tickets/${ticket.ticketId}`,
    query: { fields: "labels" },
  })) as { code?: string; msg?: string; data?: Record<string, unknown> };
  if (payload?.code && payload.code !== "SUCCESS") {
    throw new Error(`read ticket failed: ${payload.msg || payload.code}`);
  }
  const data = payload?.data ?? {};
  const value = data[field];
  return {
    version: typeof data.version === "number" ? data.version : undefined,
    display_id: typeof data.display_id === "string" ? data.display_id : undefined,
    value: typeof value === "string" ? value : "",
  };
}

/**
 * Build the content (HTML file, Markdown file, directory, or plain files),
 * upload every local file it references, rewrite the references to editor
 * attachments, and save the result into one ticket field with an
 * optimistic-lock PUT. Nothing is written to the ticket if any upload fails.
 */
export async function addTicketAttachments(
  ticket: ResolvedVersionTicket,
  options: AddAttachmentsOptions,
): Promise<AddAttachmentsSummary> {
  const source: ContentSource =
    options.source.kind === "files"
      ? { kind: "files", paths: options.source.paths.map((p) => path.resolve(p)) }
      : { kind: options.source.kind, path: path.resolve(options.source.path) };
  const built = await buildContent(source);
  const singleFile = source.kind === "html" || source.kind === "md";
  const baseDir = options.baseDir && singleFile ? path.resolve(options.baseDir) : undefined;
  // --dir sections resolve against their own folder but may reference anything under the --dir root.
  const root =
    source.kind === "files" ? undefined : source.kind === "dir" ? source.path : (baseDir ?? path.dirname(source.path));
  const note: ScopedFragment[] = options.note?.trim()
    ? [{ html: renderMarkdown(options.note), baseDir: process.cwd(), root: process.cwd() }]
    : [];
  const content: ScopedFragment[] = built.fragments
    .filter((f) => f.html.trim() !== "")
    .map((f) => ({ ...f, baseDir: baseDir ?? f.baseDir, root }));
  if (content.length === 0) {
    throw new Error(`nothing to add: ${source.kind === "files" ? "no --file given" : `${source.path} is empty`}`);
  }
  const fragments = [...note, ...content];

  const blockId = normalizeBlockId(options.blockId ?? built.defaultBlockId);
  const collected = collectFragmentRefs(fragments);
  const outside = outsideBaseFiles(fragments);
  const blocked: BlockedFile[] = [];
  const allowed: typeof collected.files = [];
  for (const f of collected.files) {
    const sensitive = sensitivePathReason(f.path);
    if (sensitive) blocked.push({ path: f.path, refs: f.refs, reason: "sensitive", detail: sensitive });
    else if (outside.has(f.path) && !options.allowOutsideBase) blocked.push({ path: f.path, refs: f.refs, reason: "outside_base" });
    else allowed.push(f);
  }
  const files = await Promise.all(
    allowed.map(async (f) => ({
      ...f,
      bytes: (await stat(f.path)).size,
      ...(outside.has(f.path) ? { outside_base: true as const } : {}),
    })),
  );

  const summary: AddAttachmentsSummary = {
    ticket_id: ticket.ticketId,
    source,
    field: options.field,
    mode: options.mode,
    block_id: blockId,
    dry_run: Boolean(options.dryRun),
    html_bytes: Buffer.byteLength(fragments.map((f) => f.html).join("\n")),
    files,
    uploaded: [],
    failed: [],
    missing: collected.missing.map((m) => ({ ref: m.ref, element: m.element })),
    blocked,
  };
  if (summary.missing.length > 0 || summary.blocked.length > 0 || options.dryRun) return summary;

  const { uploaded, failed } = await uploadTicketAttachmentFiles(ticket, files, options);
  summary.uploaded = uploaded.map(({ html: _html, ...rest }) => rest);
  summary.failed = failed;
  if (failed.length > 0) return summary;

  const rewritten = rewriteFragments(fragments, new Map(uploaded.map((u) => [u.path, u])));
  summary.html_bytes = Buffer.byteLength(rewritten);
  if (options.htmlOut) {
    summary.html_out = path.resolve(options.htmlOut);
    await writeFile(summary.html_out, rewritten, "utf8");
  }

  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  for (let attempt = 1; ; attempt++) {
    const snapshot = await readTicketField(ticket, options.field);
    summary.display_id = snapshot.display_id;
    const body: Record<string, unknown> = {
      [options.field]: mergeReportBlock(snapshot.value, rewritten, options.mode, blockId),
    };
    if (snapshot.version !== undefined) body.version = snapshot.version;
    try {
      const result = (await cawplanRequest({
        method: "PUT",
        path: `/api/v1/public/openapi/product/${ticket.productId}/versions/${ticket.versionId}/tickets/${ticket.ticketId}`,
        body,
      })) as { code?: string; msg?: string; data?: { version?: number } };
      if (result?.code && result.code !== "SUCCESS") {
        throw new Error(`update ticket failed: ${result.msg || result.code}`);
      }
      summary.version = result?.data?.version;
      return summary;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && attempt < maxAttempts) {
        options.onProgress?.(`Ticket changed concurrently; re-reading and retrying (${attempt + 1}/${maxAttempts})`);
        continue;
      }
      throw err;
    }
  }
}
