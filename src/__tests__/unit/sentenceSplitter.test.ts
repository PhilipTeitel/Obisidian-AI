import { describe, expect, it } from "vitest";
import { splitBySentence } from "../../utils/sentenceSplitter";

describe("splitBySentence", () => {
  it("A1_splits_at_sentence_boundaries", () => {
    const input = "First sentence. Second sentence. Third sentence.";
    const result = splitBySentence(input, 1000);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(input);
    expect(result[0].sequenceIndex).toBe(0);
  });

  it("A2_respects_max_chunk_chars", () => {
    const input =
      "First sentence here. Second sentence here. Third sentence here. Fourth sentence here.";
    const result = splitBySentence(input, 45);

    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      if (chunk.text.indexOf(".") === chunk.text.lastIndexOf(".")) {
        continue;
      }
      expect(chunk.text.length).toBeLessThanOrEqual(45);
    }
  });

  it("A3_sequential_index_ordering", () => {
    const input =
      "Alpha sentence. Beta sentence. Gamma sentence. Delta sentence. Epsilon sentence.";
    const result = splitBySentence(input, 35);

    expect(result.length).toBeGreaterThan(1);
    for (let i = 0; i < result.length; i++) {
      expect(result[i].sequenceIndex).toBe(i);
    }

    const reassembled = result.map((s) => s.text).join(" ");
    expect(reassembled).toBe(input);
  });

  it("B1_abbreviations_not_split", () => {
    const input = "Dr. Smith met Mr. Jones at 3 p.m. today.";
    const result = splitBySentence(input, 1000);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(input);
  });

  it("B1_abbreviations_not_split_extended", () => {
    const inputs = [
      "Mrs. Johnson called Prof. Adams about the meeting.",
      "The company, Corp. Inc. Ltd., was founded by Jr. Smith.",
      "See e.g. the appendix and i.e. the summary for details.",
      "He arrived at approx. 3 p.m. and left at 5 a.m. today.",
      "St. Patrick and Mt. Everest are famous landmarks.",
      "The Dept. of Defense issued a statement.",
    ];

    for (const input of inputs) {
      const result = splitBySentence(input, 1000);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe(input);
    }
  });

  it("B2_decimals_not_split", () => {
    const input = "The value is 3.14 and costs $1.50.";
    const result = splitBySentence(input, 1000);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(input);
  });

  it("B2_decimals_extended", () => {
    const input = "Version v2.0 has 0.001 error rate.";
    const result = splitBySentence(input, 1000);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(input);
  });

  it("B3_urls_not_split", () => {
    const input = "Visit https://example.com/path.html for details.";
    const result = splitBySentence(input, 1000);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(input);
  });

  it("B3_urls_ftp_not_split", () => {
    const input = "Download from ftp://files.server.org/data.zip today.";
    const result = splitBySentence(input, 1000);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(input);
  });

  it("B4_ellipses_handled", () => {
    const input = "He paused... then continued.";
    const result = splitBySentence(input, 1000);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(input);
  });

  it("B4_ellipses_not_four_pieces", () => {
    const input = "He paused... then continued.";
    const result = splitBySentence(input, 15);

    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("C1_empty_input_returns_empty", () => {
    expect(splitBySentence("", 500)).toEqual([]);
    expect(splitBySentence("   \n  ", 500)).toEqual([]);
  });

  it("C2_short_content_single_chunk", () => {
    const input = "A short paragraph.";
    const result = splitBySentence(input, 500);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ text: input, sequenceIndex: 0 });
  });

  it("C3_long_sentence_not_split", () => {
    const longSentence = "This is a very long sentence that " +
      "goes on and on with many words and phrases and clauses " +
      "and it never seems to end because there is no period " +
      "until the very end of this extremely verbose sentence.";

    const result = splitBySentence(longSentence, 20);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(longSentence);
    expect(result[0].sequenceIndex).toBe(0);
  });

  it("C4_deterministic_output", () => {
    const input =
      "First sentence. Second sentence. Third sentence. Fourth sentence.";

    const run1 = splitBySentence(input, 40);
    const run2 = splitBySentence(input, 40);
    const run3 = splitBySentence(input, 40);

    expect(run1).toEqual(run2);
    expect(run2).toEqual(run3);
  });

  it("handles mixed punctuation terminators", () => {
    const input = "Is this a question? Yes it is! And a statement.";
    const result = splitBySentence(input, 25);

    expect(result.length).toBeGreaterThan(1);
    const reassembled = result.map((s) => s.text).join(" ");
    expect(reassembled).toBe(input);
  });

  it("handles content with only whitespace between sentences", () => {
    const input = "Sentence one.  Sentence two.  Sentence three.";
    const result = splitBySentence(input, 1000);

    expect(result).toHaveLength(1);
    expect(result[0].sequenceIndex).toBe(0);
  });
});
