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
- `requirement` — states a feature/goal to build, or a one-off concrete target for THIS piece of
  work — including switching/replacing ONE named thing scoped to this task ("switch this to
  TypeScript", "for storage, use the existing warehouse"), even when it references an existing
  pattern as soft guidance ("do it the way the existing X flow works", "follow the current design
  system") describing the SAME feature. That reference is descriptive detail, not a binding rule,
  as long as it's elaborating HOW to build the one thing being asked for. The default for any
  single, scoped build/change/switch ask is `requirement` — `direction` requires an explicit
  breadth signal (see below), not just an instruction verb like "switch"/"change"/"use".
- `direction` — sets a rule or constraint with an explicit breadth/scope signal that governs
  implementation broadly, beyond just this one task ("uniformly go through X", "across the
  board", "from now on", "统一走", "所有地方都用X", or an explicit blanket prohibition like "never
  use X", "don't use X anywhere"); OR the message has a SEPARATE clause that imposes a constraint
  on a DIFFERENT aspect of the work than the main build ask — e.g. the main clause says "build
  feature A" and a second clause says "for notifications/permissions/storage, use/don't-use X"
  ("满意度评分功能补一个，存储这块用现有的数据仓库" [add a satisfaction-score feature; for storage,
  use the existing warehouse] — the storage clause is a separate constraint, not elaboration of
  the score feature itself, so `direction` is primary even though a `requirement` is also
  present). Contrast with `requirement`'s soft-guidance case above, which is a single reference
  describing HOW to build the SAME thing being asked for, not a second, differently-scoped
  instruction. Without a breadth word or a genuinely separate-aspect clause, a switch/change/use
  instruction for THIS task is `requirement` instead — do not default to `direction` just because
  the sentence contains an instruction verb. Distinguish from `decision`: `direction` is a
  standing rule with no menu of named options; `decision` is picking ONE named option the human
  explicitly chose (not delegated to the AI).
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
a prior result was wrong; a rhetorical "is this X?" complaint about existing output counts as a
correction judgment, not a question)
- `correction_defect` — the underlying behavior, data, or logic is factually wrong: wrong data,
  wrong trigger condition/timing, a crash, a broken display. The defect is in what happened.
- `correction_intent` — it runs without error but the RESULT, ORDER, or FLOW isn't what was
  wanted: wrong page/step order, wrong wording, an awkward or confusing interaction — including
  "this feels convoluted/complicated to use" when it's about the FEATURE's own flow, not the
  code. Behavior technically works; the outcome or experience doesn't match intent.
- `correction_quality` — it works, the outcome/flow is fine, but the CODE or architecture itself
  is over-engineered, too complex, or poorly organized: too many abstraction layers, scattered
  logic, an overly heavy implementation, overly complex parameter design, or an unnecessary
  wrapper/encapsulation. Strictly about code/architecture structure, not about the feature's
  user-facing flow (that's `correction_intent`).
- `rejection` — a short, full EVALUATIVE ADJECTIVE judgment that something doesn't work/fit
  ("that's not going to work", "doesn't fit", "no good", "isn't working out", "不合适", "不行") or
  an explicit rollback demand ("no, redo it", "revert this"), with NO replacement stated at all.
  This is an evaluative opinion about suitability, phrased as a judgment/assessment — NOT an
  imperative prohibition ("don't use X", "别用X了") and NOT a factual defect/symptom report (timed
  out, crashed, returned an error, ran out of memory). An imperative prohibition + replacement
  ("don't use sync calls, use a fallback instead", "别用同步调用，先用方案B兜底") is `direction` (a
  rule change), not `rejection` — it names what NOT to do as an instruction, it does not
  evaluate/judge the old approach. Likewise a bug/incident description followed by a fix
  instruction is `direction` or `correction_defect`, not `rejection`, even when the fix happens to
  swap out a component. When a message states ONLY a replacement with no separate
  evaluative-adjective judgment phrase ("switch it to X", "don't use X, use Y"), that is
  `direction` or `decision` instead, not `rejection`. But when a standalone evaluative-adjective
  judgment phrase IS present alongside the replacement ("X doesn't fit anymore, switch to Y" /
  "X isn't working out, redo it with Y" / "MongoDB这套不合适，换成PostgreSQL"), both `rejection`
  and `direction`/`decision` apply — `rejection` still wins by priority order.
- A question is NOT a correction unless it explicitly reports a defect or complaint.

**Judgment**
- `decision` — human EXPLICITLY picked ONE option themselves using a choosing phrase ("use X",
  "go with option B", "decided on X", "handle it with option A first") — including when only a
  single candidate was ever on the table ("just go with this one"). This requires the human
  stating the choice themselves, not delegating the choice to the AI ("you decide", "up to you"
  is NOT a decision by the human — classify by the rest of the sentence instead).
- `approval` — evaluated something positively, including a short affirmative acceptance ("no
  issues, approved", "looks good", "passed review", "that works, go ahead", "可以", "同意",
  "通过") — any accepting/evaluative word is enough. A truly bare acknowledgement with zero
  evaluative/accepting word ("continue", "next", "继续") is `process_control` instead.
- `verification` — asked for testing, validation, or a self-check ("add a unit test", "verify
  this works", "run the regression suite").

**Reverse acquisition**
- `question` — asks for an explanation, reasoning, or factual detail about something that
  ALREADY EXISTS or was already decided: "why is this written this way?", "how does X trigger
  Y?", "does the current model support concurrent calls?". Seeking to understand the status quo,
  not proposing a change. Does NOT cover a hypothetical-change probe even when phrased with a
  question mark (see `exploration` below).
- `exploration` — proposes a hypothetical CHANGE or alternative and asks about its effect, or asks
  "should we try X": "what would happen if we used microservices?", "would switching to async be
  faster?", "have we considered an event-driven approach?", "what would switching to X do",
  "should we try X instead", "would switching X be better". Any question that proposes a NAMED
  alternative/hypothetical change to something is `exploration`, not `question` — `question` is
  reserved for asking about the EXISTING, unchanged status quo.

**Process control**
- `process_control` — a bare reply that ONLY advances or pauses the CONVERSATION, with no
  evaluative content, no new information, and no concrete task named: "continue", "stop",
  "pause", "hold off, wait for confirmation", "go ahead", "继续" — including bare one-word
  acknowledgements that aren't explicitly evaluative (contrast with `approval` above). Does NOT
  cover a concrete dev-tooling action (see `other`) even if that action also "moves things
  forward".
- `other` — acknowledgements, off-topic chat, or a CONCRETE routine dev-tooling/git action with no
  feature-level content: "commit the code", "switch branches", "pull latest", "push", "set up the
  dev environment". These are concrete tool commands, not conversational flow control (contrast
  with `process_control` above) and not `direction` — they carry no information about what's
  being built. Also anything with no actionable intent that doesn't fit a category above
  ("thanks", "this bug is a pain").

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
