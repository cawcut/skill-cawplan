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
- `requirement` — states a constraint, rule, or non-negotiable need the solution MUST satisfy
  ("must", "should always", "cannot exceed", "needs to support"), not a one-off instruction.
- `direction` — instructs what to build/do, OR asks a question / requests information (DEFAULT:
  "add", "update", "change", "how does X work", "where is X", "is X the case"). Exploratory or
  diagnostic questions inside a debugging session are `direction`, not `exploration`/`question`,
  unless genuinely open-ended (see Reverse acquisition below).
- `planning` — asks for a design/plan before implementation ("plan", "roadmap", "next step";
  skill slash commands like `/cawplan-commit`; NOT API paths like `/model-providers`).

**Supplementary information**
- `context_supply` — pastes a fact the AI couldn't otherwise access (error stack, log line, API
  docs, a screenshot description) with no separate instruction attached. If the same message
  also gives an instruction/decision, that instruction is the primary category and
  `context_supply` is secondary (ignored here since we only pick one).

**Correction** (pick the ONE subtype that fits; only when the human says the AI's own output or
a prior result was wrong)
- `correction_defect` — functionality is broken, wrong, or not as expected ("that's out of
  bounds", "it crashes", "not working").
- `correction_intent` — it runs but isn't what was wanted ("works, but the interaction logic is
  wrong").
- `correction_quality` — it works but is over-engineered / unnecessarily complex ("too complex,
  no need for this many layers").
- `rejection` — a full rejection with no replacement direction given ("no, redo it").
- A question is NOT a correction unless it explicitly reports a defect.

**Judgment**
- `decision` — chose between concrete options ("agreed", "use X instead of Y", "use option B").
- `approval` — approved/accepted with no new information ("ok, continue", "looks good").
- `verification` — asked for testing, validation, or self-check ("add a unit test", "verify this
  works").

**Reverse acquisition**
- `question` — asks the AI to explain/clarify something, with no correction or instruction
  attached ("why is this written this way?").
- `exploration` — open-ended "what if" probing with no fixed target ("what would happen if we
  used microservices?").

**Process control**
- `process_control` — pure flow control, ~zero information ("continue", "stop", "next").
- `other` — acknowledgements, confirmations, off-topic chat, environment/tooling chatter, or
  anything with no actionable intent that doesn't fit a category above ("ok", "got it", "thanks",
  "sounds good").

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
