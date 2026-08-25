# Human-Input Category Taxonomy (v2, CWP-19829)

Source of truth: `uid.core-product/internal/pkg/genai/ai_session_prompts.go` (the classify
system prompt) and `internal/pkg/genai/ai_session_human_category_taxonomy.go` (the leaf/group
definitions). This doc mirrors that prompt so the classification step in this skill stays
faithful to what production actually asks the LLM to do. If this doc and that prompt ever
disagree, treat the uid.core-product prompt as authoritative and update this doc to match.

## Task

Given one human input's `content`, plus its paired `assistant_message` (the AI's reply to that
turn, when available) for domain context, pick the single most applicable category below. When
more than one category clearly applies, use the priority order at the bottom to pick the primary
one — this mirrors how production always emits categories with the highest-priority one first
and treats that as "the" category.

## Categories (15 leaves in 6 groups)

**Definition work**
- `requirement` — states a feature/goal to build, or a one-off concrete target — even when it
  references an existing pattern as soft guidance ("do it the way the existing X flow works",
  "follow the current design system"). That reference is descriptive detail, not a binding rule,
  as long as the core ask is still "build this".
- `direction` — sets a rule or constraint that governs implementation broadly, not just this one
  task: "use X across the board", "uniformly go through X", "don't use X", "must go through the
  middleware". The signal is scope ("uniformly", "across the board", "from now on") or an
  explicit prohibition/mandate, not just "build this using X" (that's `requirement` or `decision`
  instead). Distinguish from `decision`: `direction` is a standing rule with no menu of named
  options; `decision` is picking ONE named option.
- `planning` — asks for a design/plan/approach BEFORE implementation, with genuine "figure out
  how first" framing ("look into how to do this first", "give me an overall plan first", "do a
  technical comparison before we start"). "first + do this concrete task" is task sequencing, not
  planning — classify by what the task itself is (usually `requirement` or `direction`).

**Supplementary information**
- `context_supply` — pastes a fact the AI couldn't otherwise access (error stack, log line, API
  docs, a screenshot description) with no separate instruction attached. If the same message
  also gives an instruction/decision, that instruction is the primary category and
  `context_supply` is secondary (ignored here since we only pick one).

**Correction** (pick the ONE subtype that fits; only when the human says the AI's own output or
a prior result was wrong)
- `correction_defect` — the underlying behavior, data, or logic is factually wrong: wrong data,
  wrong trigger condition/timing, a crash, a broken display. The defect is in what happened.
- `correction_intent` — it runs without error but the RESULT or user-facing flow isn't what was
  wanted: wrong page, wrong order, wrong wording, an awkward flow. Behavior technically works;
  the outcome doesn't match intent.
- `correction_quality` — it works and the outcome is fine, but the CODE or architecture is
  over-engineered, too complex, or poorly organized: too many abstraction layers, scattered
  logic, an overly heavy implementation, overly complex parameter design. An engineering/design
  complaint, not a functional or UX one.
- `rejection` — a short, full negative judgment ("that's not going to work", "doesn't fit", "no
  good") or explicit rollback demand ("no, redo it", "revert this") with NO replacement direction
  in the same message. The instant a message also states a concrete replacement ("switch it to
  X"), classify the whole message as `direction` or `decision` instead — `rejection` only covers
  pure, unaccompanied negation.
- A question is NOT a correction unless it explicitly reports a defect.

**Judgment**
- `decision` — picked ONE option using an explicit choosing phrase ("use X", "go with option B",
  "decided on X") — including when only a single candidate was ever on the table ("just go with
  this one"). The act of choosing is what matters, not how many alternatives existed.
- `approval` — evaluated something positively with actual evaluative content stated ("no issues,
  approved", "looks good", "passed review"). Requires a stated judgment — a bare acknowledgement
  with no evaluative content is `process_control` instead, not `approval`.
- `verification` — asked for testing, validation, or a self-check ("add a unit test", "verify
  this works", "run the regression suite").

**Reverse acquisition**
- `question` — asks for an explanation, reasoning, or factual detail about something that
  ALREADY EXISTS or was already decided: "why is this written this way?", "why polling instead of
  a long connection?", "how was this default chosen?", "how does X trigger Y?", "does the current
  model support concurrent calls?". Seeking to understand the status quo, not proposing a change.
- `exploration` — proposes a hypothetical CHANGE or alternative and asks about its effect, with no
  existing thing being explained: "what would happen if we used microservices?", "would switching
  to async be faster?", "have we considered an event-driven approach?".

**Process control**
- `process_control` — a short reply that only advances or pauses the conversation, with no
  evaluative content and no new information: "continue", "stop", "pause", "hold off, wait for
  confirmation", "go ahead" — including bare one-word acknowledgements that aren't explicitly
  evaluative (contrast with `approval` above).
- `other` — acknowledgements, off-topic chat, or routine dev-tooling mechanics with no
  feature-level content: git/environment actions ("commit the code", "switch branches", "pull
  latest", "set up the dev environment") count here, not `direction` — they carry no information
  about what's being built. Also anything with no actionable intent that doesn't fit a category
  above ("thanks", "this bug is a pain").

## Priority order (highest → lowest)

```
rejection > correction_quality > correction_intent > correction_defect > direction > planning >
decision > requirement > verification > approval > question > exploration > context_supply >
process_control > other
```

## Legacy taxonomy note (pre-CWP-19829 rows)

Before CWP-19829 shipped, `category` only ever held one of 6 flat values:
`decision` / `direction` / `requirement` / `correction` / `planning` / `other`. A row classified
before the v2 prompt shipped will still show one of those 6 values. If your fresh classification
picks a v2 leaf that belongs to the same legacy bucket (e.g. fresh = `correction_defect`, cloud =
`correction`), that is a **taxonomy-version mismatch, not a real disagreement** — call it out
separately from genuine mismatches rather than counting it as the classifier being wrong. Legacy
bucket for each leaf:

| Leaf | Legacy bucket |
|---|---|
| `requirement` | `requirement` |
| `direction` | `direction` |
| `planning` | `planning` |
| `context_supply`, `question`, `exploration`, `process_control`, `other` | `other` |
| `correction_defect`, `correction_intent`, `correction_quality`, `rejection` | `correction` |
| `decision` | `decision` |
| `approval`, `verification` | `decision` |
