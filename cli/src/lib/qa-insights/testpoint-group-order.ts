import type { TestPointDraft } from "./types.js";
import { normalizeField } from "./normalize.js";

/** Rebase the batch's Review ordering onto the requirement's current BE ordering.
 * Existing groups keep their persisted numbers (including historical zeroes).
 * Only new groups consume numbers, in the final Review's relative group order.
 */
export function resolveTestPointGroupOrders(points: TestPointDraft[], data: unknown): TestPointDraft[] {
  const rows = (data as {test_points?: unknown} | null)?.test_points;
  if (!Array.isArray(rows)) throw new Error("testpoints list requires a test_points array; cannot resolve group_order");
  const existing = new Map<string, number>();
  let maxOrder = 0;
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== "object" || (row.group != null && typeof row.group !== "string") ||
        !Number.isSafeInteger(row.group_order) || row.group_order < 0) {
      throw new Error(`existing test_points[${index}] has invalid group/group_order; cannot resolve group_order`);
    }
    const group = normalizeField(row.group);
    if (existing.has(group) && existing.get(group) !== row.group_order) {
      throw new Error(`existing group ${JSON.stringify(group)} has conflicting group_order values`);
    }
    existing.set(group, row.group_order);
    maxOrder = Math.max(maxOrder, row.group_order);
  }

  const batchOrders = new Map(points.map((point) => [point.group, point.group_order]));
  const newGroups = [...batchOrders].filter(([group]) => !existing.has(group))
    .sort((a, b) => a[1] - b[1]);
  for (const [group] of newGroups) {
    maxOrder += 1;
    if (!Number.isSafeInteger(maxOrder)) throw new Error("group_order exceeds the safe integer range");
    existing.set(group, maxOrder);
  }
  return points.map((point) => ({...point, group_order: existing.get(point.group)!}));
}
