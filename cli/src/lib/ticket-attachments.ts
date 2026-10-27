import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { cawplanRequest } from "./http.js";
import { resolveTicketIdArg } from "./resolve-ticket-id.js";

export const TICKET_ATTACHMENT_TYPES = ["image", "video", "pdf", "zip", "file"] as const;
export type TicketAttachmentType = (typeof TICKET_ATTACHMENT_TYPES)[number];

/** One file embedded in a ticket's rich-text fields (BE `TicketAttachment`). */
export interface TicketAttachment {
  key: string;
  filename: string;
  type: TicketAttachmentType;
  size?: number;
  source_field: string;
  signed_url: string;
  expires_at: number;
}

/** BE `TicketAttachmentList`. */
export interface TicketAttachmentList {
  ticket_id: string;
  display_id?: string;
  attachments: TicketAttachment[];
}

export interface TicketAttachmentScope {
  productId: string;
  /** Omit for a product backlog ticket. */
  versionId?: string;
  ticketId: string;
  expiresIn?: string;
}

/** Raw Open API envelope for the ticket attachments endpoints. */
export async function requestTicketAttachments(scope: TicketAttachmentScope): Promise<unknown> {
  const uniqueTicketId = await resolveTicketIdArg(scope.ticketId, {
    productId: scope.productId,
    versionId: scope.versionId,
  });
  const ticketPath = scope.versionId
    ? `/api/v1/public/openapi/product/${scope.productId}/versions/${scope.versionId}/tickets/${uniqueTicketId}`
    : `/api/v1/public/openapi/product/${scope.productId}/tickets/${uniqueTicketId}`;
  const query: Record<string, string> = {};
  if (scope.expiresIn !== undefined) query.expires_in = scope.expiresIn;

  return cawplanRequest({ method: "GET", path: `${ticketPath}/attachments`, query });
}

/** Unwrap the envelope; a non-SUCCESS code (HTTP 200 with failure) becomes an Error. */
export function unwrapTicketAttachmentList(payload: unknown): TicketAttachmentList {
  const body = (payload ?? {}) as { code?: string; msg?: string; data?: TicketAttachmentList };
  if (body.code && body.code !== "SUCCESS") {
    throw new Error(`list ticket attachments failed: ${body.msg || body.code}`);
  }
  const data = body.data;
  if (!data || !Array.isArray(data.attachments)) {
    throw new Error("list ticket attachments failed: unexpected response shape");
  }
  return data;
}

export interface AttachmentFilter {
  keys?: string[];
  types?: string[];
}

export function filterTicketAttachments(
  attachments: TicketAttachment[],
  filter: AttachmentFilter,
): TicketAttachment[] {
  const keys = filter.keys?.length ? new Set(filter.keys) : undefined;
  const types = filter.types?.length ? new Set(filter.types) : undefined;
  return attachments.filter((a) => (!keys || keys.has(a.key)) && (!types || types.has(a.type)));
}

export function parseAttachmentTypesCsv(csv: string): string[] {
  const types = csv
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set<string>(TICKET_ATTACHMENT_TYPES);
  const invalid = types.filter((t) => !allowed.has(t));
  if (types.length === 0 || invalid.length > 0) {
    throw new Error(
      `invalid --type: ${invalid.join(", ") || "(empty)"} (allowed: ${TICKET_ATTACHMENT_TYPES.join(", ")})`,
    );
  }
  return types;
}

const MAX_FILENAME_BYTES = 200;

/**
 * Turn an editor-supplied display name into a safe single path segment.
 * `filename` comes from ticket HTML (`data-filename` / `alt`) and is fully
 * user-controlled, so separators, traversal and control characters are removed.
 */
export function sanitizeAttachmentFilename(name: string, fallback: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  const candidate = base || (fallback.split("/").pop() ?? "").trim() || "attachment";
  return truncateFilename(candidate, MAX_FILENAME_BYTES);
}

function truncateFilename(name: string, maxBytes: number): string {
  if (Buffer.byteLength(name) <= maxBytes) return name;
  const ext = path.extname(name);
  let stem = name.slice(0, name.length - ext.length);
  while (stem.length > 0 && Buffer.byteLength(stem + ext) > maxBytes) {
    stem = Array.from(stem).slice(0, -1).join("");
  }
  return stem + ext;
}

/** Pick `name`, or `name (n).ext`, not in `taken` and not already on disk. */
export function uniqueAttachmentFilename(dir: string, name: string, taken: Set<string>): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let n = 1; taken.has(candidate.toLowerCase()) || existsSync(path.join(dir, candidate)); n++) {
    candidate = `${stem} (${n})${ext}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** Default output directory: ./cawplan-attachments/<display_id or ticket_id>/ */
export function defaultAttachmentOutDir(list: TicketAttachmentList, cwd = process.cwd()): string {
  const label = sanitizeAttachmentFilename(list.display_id || list.ticket_id, "ticket");
  return path.resolve(cwd, "cawplan-attachments", label);
}

export interface DownloadedFile {
  bytes: number;
  sha256: string;
}

/**
 * Stream a presigned URL to `destPath` (via `<dest>.part` + rename).
 * The request deliberately carries no Authorization header: S3 rejects a
 * second auth mechanism and the CawPlan token must not leak to S3.
 */
export async function downloadSignedUrl(
  signedUrl: string,
  destPath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DownloadedFile> {
  const res = await fetchImpl(signedUrl, { method: "GET", redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status}`);
  }

  const hash = createHash("sha256");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      bytes += chunk.length;
      cb(null, chunk);
    },
  });

  const partPath = `${destPath}.part`;
  try {
    await pipeline(
      Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
      meter,
      createWriteStream(partPath, { mode: 0o644 }),
    );
    await rename(partPath, destPath);
  } catch (err) {
    await rm(partPath, { force: true });
    throw err;
  }
  return { bytes, sha256: hash.digest("hex") };
}

export interface DownloadResultItem {
  key: string;
  filename: string;
  type: TicketAttachmentType;
  source_field: string;
  path?: string;
  bytes?: number;
  sha256?: string;
  error?: string;
}

export interface DownloadSummary {
  ticket_id: string;
  display_id?: string;
  out_dir: string;
  downloaded: DownloadResultItem[];
  failed: DownloadResultItem[];
}

export async function downloadTicketAttachments(
  list: TicketAttachmentList,
  attachments: TicketAttachment[],
  outDir: string,
  options: { fetchImpl?: typeof fetch; onProgress?: (msg: string) => void } = {},
): Promise<DownloadSummary> {
  const root = path.resolve(outDir);
  await mkdir(root, { recursive: true });

  const summary: DownloadSummary = {
    ticket_id: list.ticket_id,
    display_id: list.display_id,
    out_dir: root,
    downloaded: [],
    failed: [],
  };
  const taken = new Set<string>();

  for (const [i, attachment] of attachments.entries()) {
    const base: DownloadResultItem = {
      key: attachment.key,
      filename: attachment.filename,
      type: attachment.type,
      source_field: attachment.source_field,
    };
    const name = uniqueAttachmentFilename(
      root,
      sanitizeAttachmentFilename(attachment.filename, attachment.key),
      taken,
    );
    const dest = path.join(root, name);
    // Defense in depth: sanitizeAttachmentFilename already yields a single segment.
    if (path.dirname(dest) !== root) {
      summary.failed.push({ ...base, error: "refusing to write outside the output directory" });
      continue;
    }

    options.onProgress?.(`Downloading ${i + 1}/${attachments.length}: ${name}`);
    try {
      const file = await downloadSignedUrl(attachment.signed_url, dest, options.fetchImpl);
      summary.downloaded.push({ ...base, path: dest, ...file });
    } catch (err) {
      summary.failed.push({ ...base, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}
