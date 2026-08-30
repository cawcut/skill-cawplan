/** Mirrors uid.core-product/internal/pkg/genai/ai_session_classify_context.go */

export const ASSISTANT_PARAGRAPHS = 3;
export const ASSISTANT_MAX_RUNES = 1200;
export const PREV_MAX_RUNES = 500;

const TABLE_SEP = /^[ \t]*\|?[ \t:|-]*-{3,}[ \t:|-]*\|?[ \t]*$/gm;
const HR_LINE = /^[ \t]*(-{3,}|\*{3,}|_{3,})[ \t]*$/gm;
const DECORATION = /[#*`>|]+/g;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F\u{2190}-\u{21FF}]/gu;
const REDACTED = /\[REDACTED\]/gi;

export function classifyNormalizeEscapes(s) {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

export function classifySanitizeParagraph(block) {
  if (!block) return "";
  let s = classifyNormalizeEscapes(block);
  s = s.replace(TABLE_SEP, " ");
  s = s.replace(HR_LINE, " ");
  s = s.replace(DECORATION, "");
  s = s.replace(EMOJI, "");
  s = s.replace(REDACTED, " ");
  s = s.replace(/\s+/g, " ");
  return s.trim();
}

export function classifySplitParagraphs(raw) {
  raw = classifyNormalizeEscapes(String(raw ?? "").trim());
  if (!raw) return [];
  const out = [];
  for (const block of raw.split(/\n\s*\n/)) {
    const p = classifySanitizeParagraph(block);
    if (p) out.push(p);
  }
  return out;
}

export function classifyPrevAssistantTail(raw) {
  const paras = classifySplitParagraphs(raw);
  if (!paras.length) return null;
  return truncateRunes(paras[paras.length - 1], PREV_MAX_RUNES);
}

export function classifyAssistantSnippet(raw, maxRunes = ASSISTANT_MAX_RUNES) {
  const paras = classifySplitParagraphs(raw);
  if (!paras.length) return null;
  const n = Math.min(ASSISTANT_PARAGRAPHS, paras.length);
  let joined = paras.slice(0, n).join("\n\n");
  joined = truncateRunes(joined, maxRunes);
  if ([...joined].length >= maxRunes) joined += " ...";
  return joined;
}

function truncateRunes(s, max) {
  const runes = [...s];
  if (runes.length <= max) return s;
  return runes.slice(0, max).join("");
}
