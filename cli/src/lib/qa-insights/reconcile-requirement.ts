/**
 * Table A — Reconcile (A1 SKILL.md step 11).
 *
 * Pure decision logic: given a probe and the rows fetched from the server,
 * decide what the skill should do. This module NEVER issues requests and never
 * decides to write — reconcile exists precisely because a prior write outcome
 * was UNKNOWN, and blindly re-POSTing would create duplicates.
 *
 * Table A rows implemented here:
 *   1. strong match (one row)      → bind id, do NOT POST          → RECONCILED
 *   2. multiple strong matches     → list ids, SQA picks           → FAILURE
 *   3. PATCH pending, new values   → treat as applied              → RECONCILED
 *   4. PATCH pending, old values   → retry the PATCH               → FAILURE
 *   5. no match                    → retry the SAME write          → FAILURE
 *
 * Rows 2/4/5 are FAILURE rather than a softer outcome because each requires the
 * skill (and SQA) to take a decision the CLI must not take on its own. In
 * particular there is deliberately no --bind-id: when several rows match, the
 * caller lists every id and lets SQA choose.
 */

import { normalizeField, normalizeFieldByKey } from "./normalize.js";
import { strongMatchIds } from "./strong-match.js";
import { FIVE_FIELD_KEYS } from "./types.js";
import type {
  QAInsightsOutcome,
  QAInsightsReconcileInfo,
  RequirementRow,
} from "./types.js";

export interface ReconcileRequirementInput {
  /** Five fields from pending_write or the current draft. `summary` is ignored. */
  probe: unknown;
  /** Rows returned by GET .../qa/requirements?module_tree_node_id=… */
  rows: readonly RequirementRow[];
  /** Set for a pending PATCH: the row being updated. */
  targetRequirementId?: string;
  /**
   * The changed keys the PATCH intended to write. Only these are compared
   * (OQ#5) — comparing the full five fields + summary would report
   * "still old" whenever any unrelated field had drifted.
   */
  intendedPatch?: Record<string, unknown>;
  operation?: "POST" | "PATCH";
}

export interface ReconcileRequirementResult {
  outcome: QAInsightsOutcome;
  reconcile: QAInsightsReconcileInfo;
  /** Human-readable rationale for stdout / skill read-back. */
  message: string;
}

const STRATEGY = "five_field_strong_match" as const;

/** Compare only the keys the PATCH intended to change (Table A row 3/4). */
function patchAlreadyApplied(
  row: RequirementRow,
  intendedPatch: Record<string, unknown>,
): boolean {
  const keys = Object.keys(intendedPatch);
  if (keys.length === 0) return false;

  return keys.every((key) => {
    const intended = intendedPatch[key];
    if (key === "summary") {
      return normalizeField(intended) === normalizeField(row.summary);
    }
    if ((FIVE_FIELD_KEYS as readonly string[]).includes(key)) {
      const fieldKey = key as (typeof FIVE_FIELD_KEYS)[number];
      return normalizeFieldByKey(fieldKey, intended) === normalizeFieldByKey(fieldKey, row[fieldKey]);
    }
    return normalizeField(intended) === normalizeField(row[key]);
  });
}

export function reconcileRequirement(
  input: ReconcileRequirementInput,
): ReconcileRequirementResult {
  const rows = Array.isArray(input.rows) ? input.rows : [];

  // ---- PATCH pending (Table A rows 3 and 4) ----
  if (input.targetRequirementId) {
    const target = rows.find((row) => row.id === input.targetRequirementId);

    if (!target) {
      return {
        outcome: "FAILURE",
        reconcile: { strategy: STRATEGY, decision: "no_match" },
        message:
          `target requirement ${input.targetRequirementId} was not found among the fetched rows — ` +
          `retry the same PATCH after read-back (do not create a second requirement)`,
      };
    }

    const intended = input.intendedPatch ?? {};
    if (Object.keys(intended).length === 0) {
      return {
        outcome: "FAILURE",
        reconcile: {
          strategy: STRATEGY,
          decision: "patch_still_old",
          matched_requirement_ids: [target.id],
        },
        message:
          "no intended patch keys supplied — cannot determine whether the PATCH landed; " +
          "pass --intended-patch-file with the changed keys",
      };
    }

    if (patchAlreadyApplied(target, intended)) {
      return {
        outcome: "RECONCILED",
        reconcile: {
          strategy: STRATEGY,
          decision: "patch_already_applied",
          matched_requirement_ids: [target.id],
        },
        message:
          `server already holds the intended values for ${Object.keys(intended).join(", ")} — ` +
          "the previous PATCH likely succeeded; refresh snapshots and clear pending_write",
      };
    }

    return {
      outcome: "FAILURE",
      reconcile: {
        strategy: STRATEGY,
        decision: "patch_still_old",
        matched_requirement_ids: [target.id],
      },
      message:
        `server still holds the old values for ${Object.keys(intended).join(", ")} — ` +
        "read back and retry the same PATCH (not a POST)",
    };
  }

  // ---- POST pending (Table A rows 1, 2 and 5) ----
  const matchedIds = strongMatchIds(input.probe, rows);

  if (matchedIds.length === 1) {
    return {
      outcome: "RECONCILED",
      reconcile: {
        strategy: STRATEGY,
        decision: "strong_match_single",
        matched_requirement_ids: matchedIds,
      },
      message:
        `found one requirement whose five fields match exactly (${matchedIds[0]}) — ` +
        "the previous archive likely succeeded; bind this id and do NOT create another",
    };
  }

  if (matchedIds.length > 1) {
    return {
      outcome: "FAILURE",
      reconcile: {
        strategy: STRATEGY,
        decision: "strong_match_multiple",
        matched_requirement_ids: matchedIds,
      },
      message:
        `found ${matchedIds.length} requirements with identical five fields — ` +
        "ask SQA which id to bind; the CLI does not choose (no --bind-id by design)",
    };
  }

  return {
    outcome: "FAILURE",
    reconcile: {
      strategy: STRATEGY,
      decision: "no_match",
      matched_requirement_ids: [],
    },
    message:
      "no requirement on the server matches the five fields — " +
      "retry the SAME write after read-back (this is a retry, not a second requirement)",
  };
}
