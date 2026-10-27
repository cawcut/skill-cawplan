/**
 * Markdown → readable plain text.
 *
 * Both consumers of document content render Markdown *source* badly when it isn't converted:
 * an agent putting an excerpt into a chat preview panel (which shows the text verbatim, so
 * `### Heading` / `**bold**` / `| a | b |` leak through as syntax), and the CLI's own document
 * pickers. ANSI-based renderers (marked-terminal) only help the second case, and only when the
 * terminal reports color support — so this deliberately produces plain characters, no escape
 * codes, and is safe to embed anywhere.
 *
 * This is a pragmatic subset, not a CommonMark implementation: it targets the constructs that
 * actually appear in knowledge-base documents (headings, emphasis, inline code, fenced code,
 * GFM tables, lists, blockquotes) and leaves anything else as-is.
 */

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^(```|~~~)/;
const TABLE_DIVIDER = /^\|[\s:|-]+\|?$/;

export interface PlainTextOptions {
  /** Stop after this many output lines (0 / omitted = no limit). */
  maxLines?: number;
  /** Drop fenced code blocks entirely instead of keeping them indented. */
  stripCodeBlocks?: boolean;
  /**
   * Drop blank lines entirely. For a short fixed-height preview, paragraph spacing wastes the
   * line budget — every line should carry content. Full-section rendering leaves this off so
   * paragraph breaks survive.
   */
  compact?: boolean;
}

/** Splits a GFM table row into trimmed cells, tolerating a missing leading/trailing pipe. */
function splitRow(line: string): string[] {
  return line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

/** Renders collected table rows as space-aligned columns, padded to the widest cell per column. */
function formatTable(rows: string[][], indent: string): string[] {
  const columns = Math.max(...rows.map((row) => row.length));
  const widths: number[] = [];
  for (let col = 0; col < columns; col++) {
    widths[col] = Math.max(...rows.map((row) => (row[col] ?? "").length));
  }
  return rows.map((row) => {
    const cells = [];
    for (let col = 0; col < columns; col++) {
      const cell = row[col] ?? "";
      // Don't pad the final column — trailing whitespace serves nothing and widens the block.
      cells.push(col === columns - 1 ? cell : cell.padEnd(widths[col]));
    }
    return (indent + cells.join("  ")).trimEnd();
  });
}

/** Strips inline emphasis/code/link syntax, keeping the visible text. */
function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, "$1 ($2)")
    .replace(/(\*\*\*|___)(.+?)\1/g, "$2")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

/** Converts Markdown to plain text: no ANSI codes, no leftover `#`/`**`/`|` syntax. */
export function markdownToPlainText(markdown: string, options: PlainTextOptions = {}): string {
  const { maxLines = 0, stripCodeBlocks = false, compact = false } = options;
  const out: string[] = [];
  let pendingTable: string[][] = [];
  let inFence = false;

  const flushTable = () => {
    if (pendingTable.length > 0) {
      out.push(...formatTable(pendingTable, "  "));
      pendingTable = [];
    }
  };

  for (const raw of markdown.split("\n")) {
    if (maxLines > 0 && out.length >= maxLines) break;
    const line = raw.replace(/\s+$/, "");

    if (FENCE.test(line.trim())) {
      flushTable();
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      if (!stripCodeBlocks) out.push(`  ${line.trim()}`);
      continue;
    }

    if (TABLE_DIVIDER.test(line.trim())) continue;
    if (line.trim().startsWith("|")) {
      pendingTable.push(splitRow(line.trim()));
      continue;
    }
    flushTable();

    if (line.trim() === "") {
      // Collapse runs of blank lines; never lead with one.
      if (!compact && out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      if (!compact && out.length > 0 && out[out.length - 1] !== "") out.push("");
      out.push(stripInline(heading[2].trim()));
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push("---");
      continue;
    }

    out.push(
      stripInline(
        line
          .replace(/^(\s*)>\s?/, "$1")
          .replace(/^(\s*)[-*+]\s+/, "$1- "),
      ),
    );
  }
  flushTable();

  const limited = maxLines > 0 ? out.slice(0, maxLines) : out;
  // Drop leading/trailing blank lines only — a plain `.trim()` would also eat the first line's
  // own indentation, which misaligns a block (e.g. a table) that starts the output.
  while (limited.length > 0 && limited[0].trim() === "") limited.shift();
  while (limited.length > 0 && limited[limited.length - 1].trim() === "") limited.pop();
  return limited.join("\n").replace(/\n{3,}/g, "\n\n");
}
