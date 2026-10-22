/**
 * Shared filters that keep agent/IDE-injected content out of human_inputs.
 *
 * Every collector reads user turns that may carry text the human never typed: harness blocks
 * embedded in the turn (Claude Code <system-reminder>, background <task-notification>), context
 * the IDE prepends (Cursor <user_info>/<rules>, Codex <environment_context>, AGENTS.md), and whole
 * prompts a tool sends as a "user" message (memory compressors, task-result follow-ups).
 *
 * Collectors call stripHarnessBlocks() on the extracted text first, so typed text around a block
 * survives, then drop the turn when nothing is left or isInjectedHumanInput() matches.
 */

// Harness-written blocks that can sit anywhere in a user turn (a <system-reminder> is often
// prepended, a queued notification can follow typed text), so they are stripped rather than
// matched at the start of the message. Desktop apps prepend the in-app browser's open tabs as
// <in-app-browser-context source="ambient-ui-state">, hence the optional attributes.
const HARNESS_BLOCK_RE =
  /<task-notification>[\s\S]*?<\/task-notification>|<system-reminder>[\s\S]*?<\/system-reminder>|<in-app-browser-context(?:\s[^>]*)?>[\s\S]*?<\/in-app-browser-context>/g;

export function stripHarnessBlocks(text: string): string {
  return text.replace(HARNESS_BLOCK_RE, "").trim();
}

// Context tags agents/IDEs inject as their own block. They must open a line so a user mentioning
// the tag inline ("what goes in <rules>?") is not dropped.
const INJECTED_CONTEXT_TAGS = [
  "user_info",
  "git_status",
  "agent_transcripts",
  "rules",
  "agent_skills",
  "environment_context",
  "INSTRUCTIONS",
  "command-message",
];
const INJECTED_CONTEXT_RE = new RegExp(`(?:^|\\n)[ \\t]*<(?:${INJECTED_CONTEXT_TAGS.join("|")})>`);

// Whole prompts written by a tool, matched at the start of the turn only so a user quoting one
// later in their own message is kept.
const INJECTED_PROMPT_RES = [
  /^# AGENTS\.md instructions/,
  /^Base directory for this skill:/,
  /^This session is being continued/,
  /^Continue from where you left off\.?$/i,
  // OpenViking memory plugin: recall compressor prompt sent through the agent as a user turn.
  /^You are a memory relevance compressor utility\./,
  // Cursor: follow-up prompt injected after a background task finishes.
  /^Briefly inform the user about the task result/,
];

export function isInjectedHumanInput(text: string): boolean {
  if (INJECTED_CONTEXT_RE.test(text)) return true;
  return INJECTED_PROMPT_RES.some((re) => re.test(text));
}
