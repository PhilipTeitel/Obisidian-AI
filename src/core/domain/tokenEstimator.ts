/**
 * Heuristic token estimate for embedding budget checks (CHK-2).
 * ~4 chars per token is a common rough guide for Latin text; real tokenizers differ.
 */
export const DEFAULT_MAX_EMBEDDING_TOKENS = 8000;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}
