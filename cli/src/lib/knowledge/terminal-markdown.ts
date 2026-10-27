import stringWidth from "string-width";

const FENCE_PATTERN = /^(```|~~~)/;

/**
 * Takes the leading `maxLines` non-blank lines of `body` while keeping the blank lines between
 * them. Dropping the blanks (as a plain non-blank filter does) merges adjacent markdown blocks —
 * a paragraph and a table following a numbered list get absorbed into the list as continuation
 * lines — so the excerpt must stay blank-line faithful to render as the source does.
 */
function excerptLines(body: string, maxLines: number): string[] {
  const excerpt: string[] = [];
  let kept = 0;
  for (const line of body.split("\n")) {
    if (line.trim() === "") {
      if (excerpt.length > 0) excerpt.push(line);
      continue;
    }
    if (kept === maxLines) break;
    excerpt.push(line);
    kept++;
  }
  while (excerpt.length > 0 && excerpt[excerpt.length - 1].trim() === "") excerpt.pop();
  return excerpt;
}

/**
 * Renders the start of `body` as ANSI markdown for use as a `select` choice description, bounded
 * to `maxRenderedLines` so a tall preview cannot push the prompt's own list off screen. An
 * excerpt can end inside a fenced code block, which would make marked swallow the rest as code,
 * so an unbalanced fence is closed before parsing.
 */
export async function renderMarkdownPreview(body: string, maxLines: number, maxRenderedLines: number): Promise<string> {
  const excerpt = excerptLines(body, maxLines);
  if (excerpt.length === 0) return "";
  if (excerpt.filter((line) => FENCE_PATTERN.test(line.trim())).length % 2 === 1) excerpt.push("```");

  const marked = await getMarkedForTerminal();
  const rendered = ((await marked.parse(excerpt.join("\n"))) as string).trimEnd().split("\n");
  if (rendered.length <= maxRenderedLines) return rendered.join("\n");
  return [...rendered.slice(0, maxRenderedLines), "  …"].join("\n");
}

export interface MarkdownTableToken {
  header: { text: string }[];
  rows: { text: string }[][];
}

const CELL_PADDING = 2;
const MIN_COLUMN_WIDTH = 5;

/**
 * Caps a table's total rendered width at `terminalWidth`, shrinking over-wide columns
 * proportionally so cli-table3 word-wraps the cells instead of letting the terminal soft-wrap the
 * box-drawing borders into unreadable fragments. Returns undefined when the table already fits, so
 * cli-table3 keeps its natural auto-sizing.
 */
export function fitTableColumns(token: MarkdownTableToken, terminalWidth: number): number[] | undefined {
  const columnCount = token.header.length;
  if (columnCount === 0) return undefined;

  const natural = token.header.map(
    (cell, i) =>
      CELL_PADDING + Math.max(stringWidth(cell.text), ...token.rows.map((row) => stringWidth(row[i]?.text ?? ""))),
  );

  const available = terminalWidth - (columnCount + 1);
  const total = natural.reduce((sum, width) => sum + width, 0);
  if (total <= available || available < columnCount * MIN_COLUMN_WIDTH) return undefined;

  const scaled = natural.map((width) => Math.max(MIN_COLUMN_WIDTH, Math.floor((width * available) / total)));
  let overflow = scaled.reduce((sum, width) => sum + width, 0) - available;
  for (let i = scaled.length - 1; overflow > 0 && i >= 0; i--) {
    const shrink = Math.min(overflow, scaled[i] - MIN_COLUMN_WIDTH);
    scaled[i] -= shrink;
    overflow -= shrink;
  }
  return scaled;
}

let markedForTerminal: typeof import("marked").marked | undefined;

/**
 * Lazily imports and configures `marked` for terminal rendering, only once this function is
 * actually reached — which only happens from a verified-real-TTY code path. `chalk` (used by
 * `marked-terminal` for heading/bold/etc. styling — table borders go through a separately forced
 * instance, which is why tables alone would render in color even without this) freezes its color
 * support level the moment it's first imported, so importing `marked`/`marked-terminal`
 * statically at module load — before we know whether stdout is a real terminal — would leave
 * `chalk` auto-detecting against a possibly-non-TTY stream and silently disable heading/bold
 * styling. `FORCE_COLOR` must be set before that first import, not just before use.
 */
export async function getMarkedForTerminal(): Promise<typeof import("marked").marked> {
  if (!markedForTerminal) {
    process.env.FORCE_COLOR ??= "1";
    const [{ marked }, { markedTerminal }] = await Promise.all([import("marked"), import("marked-terminal")]);
    // Mutated in place before each table render; `marked-terminal` holds this exact object and
    // reads it when constructing the cli-table3 instance, so per-table column widths land here.
    const tableOptions: { wordWrap: boolean; colWidths?: number[] } = { wordWrap: true };
    const extension = markedTerminal({ showSectionPrefix: false, tableOptions }) as {
      renderer: Record<string, (...args: unknown[]) => string>;
    };
    const renderTable = extension.renderer.table;
    extension.renderer.table = function (this: unknown, ...args: unknown[]) {
      const colWidths = fitTableColumns(args[0] as MarkdownTableToken, process.stdout.columns || 80);
      // cli-table3 dereferences a present-but-undefined `colWidths`, so the key must be absent.
      if (colWidths) tableOptions.colWidths = colWidths;
      else delete tableOptions.colWidths;
      return renderTable.apply(this, args);
    };
    marked.use(extension as object);
    markedForTerminal = marked;
  }
  return markedForTerminal;
}
