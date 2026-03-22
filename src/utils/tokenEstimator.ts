/**
 * Token estimation utility using a chars/4 heuristic.
 * Approximates GPT-family tokenizer counts for English text.
 * Designed for fast, synchronous budget enforcement — not exact counting.
 */

export const estimateTokens = (text: string): number => {
  if (text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / 4);
};

export const fitsWithinBudget = (text: string, budget: number): boolean => {
  return estimateTokens(text) <= budget;
};

export const truncateToTokenBudget = (text: string, budget: number): string => {
  if (text.length === 0) {
    return "";
  }
  if (fitsWithinBudget(text, budget)) {
    return text;
  }

  const ellipsis = "...";
  const ellipsisTokens = estimateTokens(ellipsis);
  const availableBudget = budget - ellipsisTokens;

  if (availableBudget <= 0) {
    return ellipsis;
  }

  const maxChars = availableBudget * 4;
  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");

  if (lastSpace <= 0) {
    return slice + ellipsis;
  }

  return slice.slice(0, lastSpace) + ellipsis;
};
