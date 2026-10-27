import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { sensitivePathMessage, sensitivePathReason } from "./attachment-path-policy.js";
import { cawplanRequest } from "./http.js";
import type { TicketAttachmentType } from "./ticket-attachments.js";

/** BE `TicketAttachmentUploadUrl`. */
export interface TicketAttachmentUploadUrl {
  key: string;
  upload_url: string;
  url: string;
  filename: string;
  type: TicketAttachmentType;
  expires_at: number;
  /**
   * Content-Type signed into upload_url (CWP-24597); the PUT must send exactly
   * this. Older backends omit it and do not sign the type.
   */
  content_type?: string;
}

/** A version ticket whose `ticketId` is already the unique_id (UUID). */
export interface ResolvedVersionTicket {
  productId: string;
  versionId: string;
  ticketId: string;
}

export interface UploadedAttachment {
  /** Absolute local path. */
  path: string;
  filename: string;
  type: TicketAttachmentType;
  bytes: number;
  key: string;
  /** Permanent URL to embed in ticket HTML. */
  url: string;
  /** Editor-shaped HTML snippet for this file. */
  html: string;
}

export interface FailedAttachment {
  path: string;
  filename: string;
  error: string;
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".heic": "image/heic",
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".har": "application/json",
};

export function mimeTypeForFilename(filename: string): string {
  return MIME_BY_EXT[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

/** Same thresholds as the web editor's formatAttachmentFileSize. */
export function formatAttachmentFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render an uploaded file the way the web rich-text editor stores it
 * (example-web-service RichEditor/Full Image/Video/Pdf/ZipAttachment nodes),
 * so it previews and lists exactly like a file dropped into the editor.
 */
export function renderAttachmentHtml(file: { url: string; filename: string; type: TicketAttachmentType; bytes: number }): string {
  const src = escapeHtml(file.url);
  const name = escapeHtml(file.filename);
  const size = escapeHtml(formatAttachmentFileSize(file.bytes));
  switch (file.type) {
    case "image":
      return `<img src="${src}" alt="${name}">`;
    case "video":
      return (
        `<div data-type="video-attachment" class="video-attachment" data-src="${src}" data-filename="${name}" ` +
        `data-mime="${escapeHtml(mimeTypeForFilename(file.filename))}"><span class="video-filename">${name}</span></div>`
      );
    case "pdf":
      return (
        `<span data-type="pdf-attachment" class="pdf-attachment" data-src="${src}" data-filename="${name}" data-file-size="${file.bytes}">` +
        `<span class="attachment-file-info"><span class="pdf-filename attachment-filename">${name}</span>` +
        `<span class="attachment-file-size">${size}</span></span></span>`
      );
    default:
      return (
        `<span data-type="zip-attachment" class="zip-attachment" data-src="${src}" data-filename="${name}" data-file-size="${file.bytes}">` +
        `<span class="attachment-file-info"><span class="zip-filename attachment-filename">${name}</span>` +
        `<span class="attachment-file-size">${size}</span></span></span>`
      );
  }
}

/** Ask the BE for a presigned PUT for one file on a version ticket. */
export async function requestTicketAttachmentUploadUrl(
  ticket: ResolvedVersionTicket,
  file: { filename: string; contentLength: number; expiresIn?: number },
): Promise<TicketAttachmentUploadUrl> {
  const body: Record<string, unknown> = { filename: file.filename, content_length: file.contentLength };
  if (file.expiresIn !== undefined) body.expires_in = file.expiresIn;
  const payload = (await cawplanRequest({
    method: "POST",
    path: `/api/v1/public/openapi/product/${ticket.productId}/versions/${ticket.versionId}/tickets/${ticket.ticketId}/attachments/upload-url`,
    body,
  })) as { code?: string; msg?: string; data?: TicketAttachmentUploadUrl };
  if (payload?.code && payload.code !== "SUCCESS") {
    throw new Error(payload.msg || payload.code);
  }
  const data = payload?.data;
  if (!data?.upload_url || !data.url || !data.key) {
    throw new Error("unexpected upload-url response shape");
  }
  return data;
}

/**
 * Stream a local file to a presigned S3 PUT URL. No Authorization header: S3
 * rejects a second auth mechanism and the CawPlan token must not leak to S3.
 */
export async function putFileToSignedUrl(
  uploadUrl: string,
  filePath: string,
  bytes: number,
  contentType: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(uploadUrl, {
    method: "PUT",
    headers: { "content-type": contentType, "content-length": String(bytes) },
    body: Readable.toWeb(createReadStream(filePath)) as unknown as BodyInit,
    duplex: "half",
  } as RequestInit);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    throw new Error(`upload failed: HTTP ${res.status}${code ? ` ${code}` : ""}`);
  }
}

export interface LocalUploadFile {
  /** Absolute local path. */
  path: string;
  /** Display filename (defaults to the basename). */
  filename?: string;
}

export interface UploadOptions {
  concurrency?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (msg: string) => void;
}

/** Size of a local file that may be uploaded; throws for credential files, non-regular and empty files. */
export async function checkUploadFile(filePath: string): Promise<number> {
  const sensitive = sensitivePathReason(filePath);
  if (sensitive) throw new Error(sensitivePathMessage(sensitive));
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("not a regular file");
  if (info.size === 0) throw new Error("file is empty");
  return info.size;
}

/** Upload files to a version ticket's attachment storage, a few at a time. */
export async function uploadTicketAttachmentFiles(
  ticket: ResolvedVersionTicket,
  files: LocalUploadFile[],
  options: UploadOptions = {},
): Promise<{ uploaded: UploadedAttachment[]; failed: FailedAttachment[] }> {
  const results: Array<UploadedAttachment | FailedAttachment> = new Array(files.length);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, files.length || 1));
  let next = 0;
  let done = 0;

  const worker = async () => {
    for (let i = next++; i < files.length; i = next++) {
      const file = files[i]!;
      const filename = file.filename ?? path.basename(file.path);
      try {
        const bytes = await checkUploadFile(file.path);
        const target = await requestTicketAttachmentUploadUrl(ticket, { filename, contentLength: bytes });
        const contentType = target.content_type || mimeTypeForFilename(filename);
        await putFileToSignedUrl(target.upload_url, file.path, bytes, contentType, options.fetchImpl);
        const uploaded = {
          path: file.path,
          filename: target.filename || filename,
          type: target.type,
          bytes,
          key: target.key,
          url: target.url,
        };
        results[i] = { ...uploaded, html: renderAttachmentHtml(uploaded) };
        options.onProgress?.(`Uploaded ${++done}/${files.length}: ${filename}`);
      } catch (err) {
        results[i] = { path: file.path, filename, error: err instanceof Error ? err.message : String(err) };
        options.onProgress?.(`Failed ${++done}/${files.length}: ${filename}`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const uploaded: UploadedAttachment[] = [];
  const failed: FailedAttachment[] = [];
  for (const r of results) {
    if ("error" in r) failed.push(r);
    else uploaded.push(r);
  }
  return { uploaded, failed };
}
