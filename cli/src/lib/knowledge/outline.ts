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

/**
 * Builds a nested heading tree from markdown `#`..`######` lines, ignoring everything else.
 * Lines inside fenced code blocks (```/~~~) are skipped, so a `#`-prefixed shell comment in a
 * curl example (e.g. "# fetch users through keyword") is never mistaken for a real heading.
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

    const match = HEADING_PATTERN.exec(lines[i]);
    if (!match) continue;

    const node: OutlineNode = { level: match[1].length, title: match[2], line: i + 1, children: [] };
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
 * its own section body (the first `maxLines` non-blank lines below the heading, trimmed) — so a
 * single `--outline` call carries enough to render a browsing menu without a follow-up fetch per
 * heading just to preview it. Use `extractSection`/`--section` afterward for the full content.
 */
export function buildOutlineWithPreview(content: string, maxLines = 4): OutlineNodeWithPreview[] {
  const tree = parseMarkdownOutline(content);
  const flat = flattenOutline(tree);

  const annotate = (nodes: OutlineNode[]): OutlineNodeWithPreview[] =>
    nodes.map((node) => {
      const flatNode = flat.find((f) => f.line === node.line);
      const body = flatNode ? extractSection(content, flat, flatNode).split("\n").slice(1).join("\n") : "";
      const preview = firstNonBlankLines(body, maxLines);
      return { ...node, preview, children: annotate(node.children) };
    });

  return annotate(tree);
}
