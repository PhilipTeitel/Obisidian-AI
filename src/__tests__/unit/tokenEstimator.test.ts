import { describe, expect, it } from "vitest";
import { estimateTokens, fitsWithinBudget, truncateToTokenBudget } from "../../utils/tokenEstimator";

describe("estimateTokens", () => {
  it("A1_chars_divided_by_four", () => {
    const fourHundredChars = "a".repeat(400);
    expect(estimateTokens(fourHundredChars)).toBe(100);

    const fourHundredOneChars = "a".repeat(401);
    expect(estimateTokens(fourHundredOneChars)).toBe(101);
  });

  it("A2_empty_and_whitespace_input", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   ")).toBe(1);
  });

  it("A3_reasonable_accuracy_english_text", () => {
    const paragraph =
      "The quick brown fox jumps over the lazy dog. " +
      "This sentence is used to test the token estimation utility. " +
      "It contains a mix of short and long words that represent " +
      "typical English prose. The estimator should produce a count " +
      "that is within a reasonable range of the actual GPT-4 token " +
      "count for this paragraph. We expect roughly one token per " +
      "four characters on average, which is a well-established " +
      "heuristic for English text processed by GPT-family tokenizers. " +
      "Adding a few more sentences to reach approximately one hundred " +
      "words so the test is representative of real-world content.";

    const estimate = estimateTokens(paragraph);
    expect(estimate).toBeGreaterThan(80);
    expect(estimate).toBeLessThan(200);
  });
});

describe("fitsWithinBudget", () => {
  it("B1_fits_within_budget_true", () => {
    const twoHundredChars = "x".repeat(200);
    expect(fitsWithinBudget(twoHundredChars, 100)).toBe(true);
  });

  it("B2_exceeds_budget_false", () => {
    const thousandChars = "x".repeat(1000);
    expect(fitsWithinBudget(thousandChars, 100)).toBe(false);
  });

  it("B3_budget_edge_cases", () => {
    expect(fitsWithinBudget("", 0)).toBe(true);
    expect(fitsWithinBudget("a", 0)).toBe(false);
  });
});

describe("truncateToTokenBudget", () => {
  it("C1_truncates_at_word_boundary", () => {
    const longText = "The quick brown fox jumps over the lazy dog and keeps running through the forest";
    const result = truncateToTokenBudget(longText, 5);

    expect(result.endsWith("...")).toBe(true);
    const withoutEllipsis = result.slice(0, -3);
    expect(longText.startsWith(withoutEllipsis)).toBe(true);
    const nextChar = longText[withoutEllipsis.length];
    expect(nextChar).toBe(" ");
  });

  it("C2_returns_full_text_when_fits", () => {
    const shortText = "Hello world";
    expect(truncateToTokenBudget(shortText, 1000)).toBe(shortText);
  });

  it("C3_ellipsis_on_truncation", () => {
    const longText = "a]".repeat(500);
    const result = truncateToTokenBudget(longText, 10);

    expect(result.endsWith("...")).toBe(true);
    const totalEstimate = estimateTokens(result);
    expect(totalEstimate).toBeLessThanOrEqual(10);
  });

  it("C4_empty_input_truncation", () => {
    expect(truncateToTokenBudget("", 100)).toBe("");
  });
});

describe("determinism", () => {
  it("D1_deterministic_output", () => {
    const text = "Deterministic test input with several words for thorough checking.";
    const budget = 5;

    const estimates = Array.from({ length: 10 }, () => estimateTokens(text));
    expect(new Set(estimates).size).toBe(1);

    const budgetChecks = Array.from({ length: 10 }, () => fitsWithinBudget(text, budget));
    expect(new Set(budgetChecks).size).toBe(1);

    const truncations = Array.from({ length: 10 }, () => truncateToTokenBudget(text, budget));
    expect(new Set(truncations).size).toBe(1);
  });
});
