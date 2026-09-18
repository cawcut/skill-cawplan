export function formatTestPointId(seq: number): string {
  return `tp_${String(seq).padStart(3, "0")}`;
}
