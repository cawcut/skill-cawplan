import stringWidth from "string-width";

const FENCE_PATTERN = /^(```|~~~)/;

/* eslint-disable no-control-regex */
// OSC / DCS / SOS / PM / APC strings run until BEL or ST (ESC \); an unterminated one runs to the end.
const ESC_STRING_SEQUENCE = /\x1b[\]PX^_][\s\S]*?(?:\x07|\x1b\\|$)/g;
const CSI_SEQUENCE = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g;
const OTHER_ESC_SEQUENCE = /\x1b[ -/]*[0-~]/g;
// Every remaining C0 control except tab and newline, plus DEL and the C1 range.
const CONTROL_CHARACTERS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
/* eslint-enable no-control-regex */

/**
 * Removes terminal escape sequences and control characters from knowledge-base text before it
 * reaches the terminal. Document content and names are written by other users, and both the
 * `select` previews and `less -R` pass raw escapes through, so an embedded sequence could rewrite
 * the screen, retitle the window, plant OSC 8 links or clipboard writes, or hide text. Whole
 * sequences are dropped (not just the ESC byte) so their parameters do not leak as visible noise;
 * tabs and newlines survive, and CRLF line endings are normalized rather than discarded.
 */
export function stripTerminalControls(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(ESC_STRING_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(OTHER_ESC_SEQUENCE, "")
    .replace(CONTROL_CHARACTERS, "");
}

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
  const excerpt = excerptLines(stripTerminalControls(body), maxLines);
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

/** JSON.stringify escapes C0 but leaves C1 controls literal. Escape those too
 * when printing JSON; JSON.parse still recovers the exact original data.
 */
export function stringifyKnowledgeOutput(value: unknown, replacer: null = null, space: number = 2): string {
  return JSON.stringify(value, replacer, space).replace(/[\u007f-\u009f]/g, (char) =>
    "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"));
}

/** Keep stable IDs as values; strip controls only from the visible label. */
export function knowledgeChoiceLabel(name: string | undefined, fallback = ""): string {
  return stripTerminalControls(name ?? fallback);
}
