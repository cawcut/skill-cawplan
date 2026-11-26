import { buildScopedCacheKey } from "../cache.js";
import { deleteDocumentEntry, readDocumentEntry, writeDocumentEntry } from "./document-store.js";
import { cawplanRequest } from "../http.js";

/**
 * Local cache of a knowledge document's content, kept in step with the cloud:
 * - on by default (the user's `cawplan config cache off` still turns it off);
 * - a copy younger than the fresh window is used as is;
 * - an older copy is validated with one request carrying its updated_at (if_updated_at): when the
 *   cloud still has that version it answers not_modified without content, else it sends the new one;
 * - an entry past the cache TTL, or one without an updated_at (older cloud), is fetched in full.
 */

const DEFAULT_FRESH_MS = 5 * 60 * 1000;

const DOCUMENT_KEY_MARKER = "knowledge:document-content:";

export function documentFreshMs(): number {
  const raw = Number(process.env.CAWPLAN_KNOWLEDGE_FRESH_SECONDS);
  return Number.isFinite(raw) && raw >= 0 && process.env.CAWPLAN_KNOWLEDGE_FRESH_SECONDS !== undefined
    ? raw * 1000
    : DEFAULT_FRESH_MS;
}

export async function documentCacheKey(datasetId: string, documentId: string): Promise<string> {
  return buildScopedCacheKey(`${DOCUMENT_KEY_MARKER}${datasetId}:${documentId}`, undefined);
}

type ContentData = { content?: string; updated_at?: number; not_modified?: boolean };

function contentData(result: unknown): ContentData | undefined {
  return result && typeof result === "object" && "data" in result
    ? ((result as { data?: ContentData }).data ?? undefined)
    : undefined;
}

export function contentUpdatedAt(result: unknown): number | undefined {
  const v = contentData(result)?.updated_at;
  return typeof v === "number" && v > 0 ? v : undefined;
}

export type DocumentFetcher = (ifUpdatedAt?: number) => Promise<unknown>;

function defaultFetcher(datasetId: string, documentId: string): DocumentFetcher {
  return (ifUpdatedAt) =>
    cawplanRequest({
      method: "GET",
      path: `/api/v1/public/openapi/knowledge/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/content`,
      ...(ifUpdatedAt ? { query: { if_updated_at: String(ifUpdatedAt) } } : {}),
    });
}

/** Returns the document content result, from the cache when it is current. */
export async function fetchDocumentContent(
  datasetId: string,
  documentId: string,
  refresh = false,
  fetcher: DocumentFetcher = defaultFetcher(datasetId, documentId),
): Promise<unknown> {
  const key = await documentCacheKey(datasetId, documentId);
  const entry = refresh ? undefined : readDocumentEntry(key);
  if (entry) {
    if (Date.now() - entry.fetched_at <= documentFreshMs()) return entry.data;
    const version = contentUpdatedAt(entry.data);
    if (version !== undefined) {
      const answer = await fetcher(version);
      if (contentData(answer)?.not_modified === true) {
        writeDocumentEntry(key, entry.data); // still current: restart its fresh window
        return entry.data;
      }
      storeIfContent(key, answer);
      return answer;
    }
  }
  const result = await fetcher();
  storeIfContent(key, result);
  return result;
}

function storeIfContent(key: string, result: unknown): void {
  // Only a real content answer is cached, never a not_found / failed-generation status.
  if (typeof contentData(result)?.content === "string") writeDocumentEntry(key, result);
}

/** Drops the cached content of a document, e.g. after it was updated from here. */
export async function invalidateDocumentContent(datasetId: string, documentId: string): Promise<void> {
  deleteDocumentEntry(await documentCacheKey(datasetId, documentId));
}
