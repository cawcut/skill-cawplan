# Human-Input Category Taxonomy (v2, CWP-19829)

Source of truth: `uid.core-product/internal/pkg/genai/ai_session_human_category_taxonomy.go`.
This doc is a snapshot for quick reference only — if it disagrees with that file, trust the code.

## 15 leaf categories, grouped into 6 clusters

| Cluster | Leaves |
|---|---|
| Definition work | `requirement`, `direction`, `planning` |
| Supplementary information | `context_supply` |
| Correction | `correction_defect`, `correction_intent`, `correction_quality`, `rejection` |
| Judgment | `decision`, `approval`, `verification` |
| Reverse acquisition | `question`, `exploration` |
| Process control | `process_control`, `other` |

## Legacy group collapse (for backward-compatible / cross-taxonomy comparison)

Every leaf (and the old flat `correction` value from pre-v2 rows) collapses to one of the
original 6 buckets:

| Leaf | Legacy group |
|---|---|
| `requirement` | `requirement` |
| `direction` | `direction` |
| `planning` | `planning` |
| `context_supply` | `other` |
| `correction_defect`, `correction_intent`, `correction_quality`, `rejection`, `correction` (legacy) | `correction` |
| `decision` | `decision` |
| `approval`, `verification` | `decision` |
| `question`, `exploration`, `process_control`, `other` | `other` |

## Priority order (highest → lowest)

Used to pick the primary category (`categories[0]`) when a human input carries more than one
intent:

```
rejection > correction_quality > correction_intent > correction_defect > direction > planning >
decision > requirement > verification > approval > question > exploration > context_supply >
process_control > other
```

## Why this matters for the QA check

- `group_match` (this skill's headline accuracy number) compares **legacy groups**, so it's valid
  for every row regardless of whether the cloud value predates the v2 taxonomy.
- `primary_match` and `set_overlap` compare **exact v2 leaves**, so they're only meaningful once
  a row's `categories` array was itself produced under v2 (`cloud_categories_available == true`
  in the harness output). A pre-v2 row's cloud `category` is one of the old flat values
  (`decision`/`direction`/`requirement`/`correction`/`planning`/`other`) and can never leaf-match
  a new value like `correction_defect` even when the classification is actually correct.
