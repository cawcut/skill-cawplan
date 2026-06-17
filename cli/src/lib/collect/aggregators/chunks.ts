/**
 * Chunk builder — splits session messages into AI-friendly text chunks.
 */

export const MSG_TRUNCATE = 100;  // max chars per message in a chunk
export const CHUNK_SIZE = 8000;   // max chars per chunk
export const MAX_CHUNKS_PER_SESSION = 2;

const CHUNK_HEADER_RE = /^# chunk \d+\/\d+  messages .+\n/;

export interface ChunkMessage {
  role: string;
  time?: string;
  text: string;
}

/**
 * Split messages into chunk text blocks.
 * Each message is truncated to `truncate` chars. Chunks split at CHUNK_SIZE boundaries.
 * Returns list of chunk strings, each prefixed with a header line.
 */
export function buildChunks(
  messages: ChunkMessage[],
  truncate: number | null = MSG_TRUNCATE
): string[] {
  const lines: string[] = [];
  for (const m of messages) {
    let text = m.text;
    if (truncate !== null && text.length > truncate) {
      text = text.slice(0, truncate) + "...";
    }
    const timePart = m.time ? ` ${m.time}` : "";
    lines.push(`[${m.role}${timePart}] ${text}`);
  }

  if (!lines.length) return [];

  const rawChunks: string[] = [];
  let current: string[] = [];
  let currentSize = 0;

  for (const line of lines) {
    const lineSize = line.length + 1; // +1 for newline
    if (currentSize + lineSize > CHUNK_SIZE && current.length) {
      rawChunks.push(current.join("\n"));
      current = [];
      currentSize = 0;
    }
    current.push(line);
    currentSize += lineSize;
  }
  if (current.length) rawChunks.push(current.join("\n"));

  // Attach headers: "# chunk N/total  messages start-end"
  let msgStart = 0;
  return rawChunks.map((body, i) => {
    const msgCount = body.split("\n").length;
    const header = `# chunk ${i + 1}/${rawChunks.length}  messages ${msgStart + 1}-${msgStart + msgCount}\n`;
    msgStart += msgCount;
    return header + body;
  });
}

/**
 * Keep the last N chunks; rewrite headers to chunk 1/N .. N/N.
 */
export function takeLastChunks(
  chunks: string[],
  maxChunks: number = MAX_CHUNKS_PER_SESSION
): string[] {
  if (!chunks.length || chunks.length <= maxChunks) return chunks;

  const selected = chunks.slice(-maxChunks);
  const total = selected.length;

  return selected.map((chunk, i) => {
    const body = chunk.replace(CHUNK_HEADER_RE, "");
    const msgCount =
      body.split("\n").filter((l) => l.startsWith("[")).length ||
      Math.max(1, body.split("\n").length);
    const header = `# chunk ${i + 1}/${total}  messages ${msgCount}\n`;
    return header + body;
  });
}
