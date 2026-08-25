# Session Summary Generation Rules

Source of truth: `uid.core-product/internal/pkg/genai/ai_session_session_insights.go`'s
`PromptAISessionInsightsSystem` (the `summary` instruction) and
`PromptAISessionInsightsConsolidateSystem` (the reduce-phase synthesis instruction). This doc
mirrors those so this skill's manual pass stays faithful to what production actually asks the LLM
to do. If this doc and that prompt ever disagree, treat the uid.core-product prompt as
authoritative and update this doc to match.

## Task

Given one session's full ordered conversation (user + assistant turns), write `summary`: a
narrative recap (prose paragraphs, NOT a bullet list) of the whole session covering:

- What the human was trying to accomplish.
- What actually happened across the turns: investigation done, defects found, decisions made,
  what got built or fixed.
- How it ended: resolved, still open, or blocked.

## Rules

- Up to about **800 words**, but be as concise as the session's actual content allows — a short
  session gets a short summary, not padding to reach the cap.
- If the session has no substantive content (pure chit-chat, process commands only — commit/push,
  running tests, etc.), say so briefly instead of inventing substance.
- Write it as continuous prose in chronological order, not a list of bullet points — that's what
  the separate decisions/direction/bugs/planning buckets are for; don't duplicate that format here.
- Name concrete artifacts when they matter to the story (function/file/error/config/API names) —
  copied verbatim from the turns, not paraphrased into vague terms.
- Do not invent anything not supported by the turns.
- Language: match the session's dominant language (if the conversation is mostly Chinese, write
  the summary in Chinese; otherwise English) — don't translate.

## Multi-session note (map-reduce, for reference only)

Production splits very long sessions (>20 turns) into slices, summarizes each slice
independently, then synthesizes ONE coherent overall summary from the partial summaries in a
separate reduce step (merging the throughline, dropping repeated setup, not concatenating). This
skill tests the single-shot summary generation on one session's full conversation — it does not
need to replicate the map-reduce slicing/synthesis step unless the session is unusually long.
