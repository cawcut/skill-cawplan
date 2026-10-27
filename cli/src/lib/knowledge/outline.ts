import { markdownToPlainText } from "./plaintext.js";

export interface OutlineNode {
  level: number;
  title: string;
  line: number;
  children: OutlineNode[];
}

export interface FlatOutlineNode extends OutlineNode {
  depth: number;
}

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/;
const FENCE_PATTERN = /^(```|~~~)/;
const SETEXT_UNDERLINE_PATTERN = /^ {0,3}(=+|-+)[ \t]*$/;
// A setext underline only promotes a plain paragraph line. Anything that already opens a block of
// its own — list item, blockquote, table row, ATX heading, indented code — stays what it is.
const NON_PARAGRAPH_PATTERN = /^(\s{4,}|\s*([-*+>|]|\d+[.)])(\s|$)|#{1,6}\s)/;

function setextLevel(textLine: string, underline: string | undefined): 1 | 2 | undefined {
  if (underline === undefined || !SETEXT_UNDERLINE_PATTERN.test(underline)) return undefined;
  if (textLine.trim() === "" || NON_PARAGRAPH_PATTERN.test(textLine)) return undefined;
  return underline.trim().startsWith("=") ? 1 : 2;
}

/**
 * Builds a nested heading tree from a document's ATX (`#`..`######`) and setext (`===`/`---`
 * underline) headings, ignoring everything else. Lines inside fenced code blocks (```/~~~) are
 * skipped, so a `#`-prefixed shell comment in a curl example (e.g. "# fetch users through
 * keyword") is never mistaken for a real heading. A setext node's `line` points at its text line,
 * not its underline.
 */
export function parseMarkdownOutline(content: string): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  const lines = content.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_PATTERN.test(lines[i].trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const atx = HEADING_PATTERN.exec(lines[i]);
    const setext = atx ? undefined : setextLevel(lines[i], lines[i + 1]);
    if (!atx && setext === undefined) continue;

    const level = atx ? atx[1].length : setext!;
    const title = atx ? atx[2] : lines[i].trim();
    const node: OutlineNode = { level, title, line: i + 1, children: [] };
    if (setext !== undefined) i++;
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop();

    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }

  return roots;
}

/** Flattens a heading tree into document order, each node annotated with its nesting depth. */
export function flattenOutline(nodes: OutlineNode[], depth = 0): FlatOutlineNode[] {
  const flat: FlatOutlineNode[] = [];
  for (const node of nodes) {
    flat.push({ ...node, depth });
    flat.push(...flattenOutline(node.children, depth + 1));
  }
  return flat;
}

/** Extracts a heading's own section text: from its line up to (not including) the next heading at the same or a shallower level. */
export function extractSection(content: string, flat: FlatOutlineNode[], chosen: FlatOutlineNode): string {
  const lines = content.split("\n");
  const idx = flat.indexOf(chosen);
  let endLine = lines.length;
  for (let i = idx + 1; i < flat.length; i++) {
    if (flat[i].level <= chosen.level) {
      endLine = flat[i].line - 1;
      break;
    }
  }
  return lines.slice(chosen.line - 1, endLine).join("\n");
}

/**
 * A section's text with its own heading removed, so callers can preview the body alone. A setext
 * heading occupies two lines (text plus underline) and both have to go, or the underline is left
 * to render as a stray paragraph at the top of the body.
 */
export function extractSectionBody(content: string, flat: FlatOutlineNode[], chosen: FlatOutlineNode): string {
  const lines = extractSection(content, flat, chosen).split("\n");
  return lines.slice(HEADING_PATTERN.test(lines[0]) ? 1 : 2).join("\n");
}

/** Finds headings whose title contains the query (case-insensitive substring match), in document order. */
export function findHeadings(flat: FlatOutlineNode[], query: string): FlatOutlineNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return flat.filter((node) => node.title.toLowerCase().includes(needle));
}

/** Joins the first `maxLines` non-blank lines of `content`, trimmed — used to build short previews. */
export function firstNonBlankLines(content: string, maxLines: number): string {
  return content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(0, maxLines)
    .join("\n")
    .trim();
}

export interface OutlineNodeWithPreview extends OutlineNode {
  preview: string;
  children: OutlineNodeWithPreview[];
}

/**
 * Same nested tree as `parseMarkdownOutline`, with each node annotated with a short `preview` of
 * its own section body — so a single `--outline` call carries enough to render a browsing menu
 * without a follow-up fetch per heading just to preview it. Use `extractSection`/`--section`
 * afterward for the full content.
 *
 * The preview is converted to plain text rather than left as Markdown source: its consumers
 * display it verbatim (a chat client's preview panel, a terminal picker's description line), so
 * raw `###` / `**` / `|` syntax would leak through as visible noise.
 */
export function buildOutlineWithPreview(content: string, maxLines = 4): OutlineNodeWithPreview[] {
  const tree = parseMarkdownOutline(content);
  const flat = flattenOutline(tree);

  const annotate = (nodes: OutlineNode[]): OutlineNodeWithPreview[] =>
    nodes.map((node) => {
      const flatNode = flat.find((f) => f.line === node.line);
      const body = flatNode ? extractSectionBody(content, flat, flatNode) : "";
      const preview = markdownToPlainText(body, { maxLines, compact: true });
      return { ...node, preview, children: annotate(node.children) };
    });

  return annotate(tree);
}
