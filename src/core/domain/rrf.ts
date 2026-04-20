/**
 * Reciprocal rank fusion (ADR-012): rank-only merge with fixed k = 60.
 *
 * Tie-break: when two documents have identical fused scores, the one with the
 * lexicographically smaller `id` appears first (stable, deterministic).
 */

export const RRF_K = 60;

export interface RankedId {
  id: string;
}

export interface FusedRankedId {
  id: string;
  /** Fused RRF score (higher is better). */
  score: number;
}

/**
 * @param lists — ordered rankings (rank 1 = index 0); ids may appear in multiple lists
 * @returns ids sorted by descending fused score, length ≤ union of input ids
 */
export function fuseRankings(lists: RankedId[][], k: number = RRF_K): FusedRankedId[] {
  const perDocScores = new Map<string, number>();
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i]!.id;
      const rank = i + 1;
      const add = 1 / (k + rank);
      perDocScores.set(id, (perDocScores.get(id) ?? 0) + add);
    }
  }
  const out: FusedRankedId[] = [...perDocScores.entries()].map(([id, score]) => ({ id, score }));
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  });
  return out;
}
