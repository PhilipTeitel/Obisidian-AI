import { describe, expect, it } from "vitest";
import { extractWikilinks } from "../../utils/wikilinkParser";

describe("extractWikilinks", () => {
  const SOURCE = "node-42";

  it("A1_simple_wikilink_extracted", () => {
    const result = extractWikilinks("See [[My Note]] for details.", SOURCE);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      sourceNodeId: SOURCE,
      targetPath: "My Note",
      targetDisplay: null,
    });
  });

  it("A2_aliased_wikilink_extracted", () => {
    const result = extractWikilinks(
      "Refer to [[projects/roadmap|the roadmap]].",
      SOURCE,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      sourceNodeId: SOURCE,
      targetPath: "projects/roadmap",
      targetDisplay: "the roadmap",
    });
  });

  it("A3_multiple_wikilinks_same_line", () => {
    const result = extractWikilinks(
      "Compare [[Note A]] with [[Note B|B]].",
      SOURCE,
    );

    expect(result).toHaveLength(2);
    expect(result[0].targetPath).toBe("Note A");
    expect(result[0].targetDisplay).toBeNull();
    expect(result[1].targetPath).toBe("Note B");
    expect(result[1].targetDisplay).toBe("B");
  });

  it("A4_multiple_wikilinks_across_lines", () => {
    const input = [
      "First line with [[Alpha]].",
      "Second line has [[Beta|display]].",
      "Third line mentions [[Gamma]].",
    ].join("\n");

    const result = extractWikilinks(input, SOURCE);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.targetPath)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(result[1].targetDisplay).toBe("display");
  });

  it("B1_heading_anchor_preserved", () => {
    const result = extractWikilinks("See [[My Note#Section One]].", SOURCE);

    expect(result).toHaveLength(1);
    expect(result[0].targetPath).toBe("My Note#Section One");
    expect(result[0].targetDisplay).toBeNull();
  });

  it("B2_code_fence_wikilinks_ignored", () => {
    const input = [
      "Before [[Valid]].",
      "```",
      "Inside code [[Ignored]].",
      "```",
      "After [[Also Valid]].",
    ].join("\n");

    const result = extractWikilinks(input, SOURCE);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.targetPath)).toEqual(["Valid", "Also Valid"]);
  });

  it("B3_inline_code_wikilinks_ignored", () => {
    const result = extractWikilinks(
      "See `[[Ignored]]` and [[Kept]].",
      SOURCE,
    );

    expect(result).toHaveLength(1);
    expect(result[0].targetPath).toBe("Kept");
  });

  it("B4_duplicates_deduplicated", () => {
    const input = "Link to [[Target]] and again [[Target]].";
    const result = extractWikilinks(input, SOURCE);

    expect(result).toHaveLength(1);
    expect(result[0].targetPath).toBe("Target");
  });

  it("C1_empty_content_returns_empty", () => {
    expect(extractWikilinks("", SOURCE)).toEqual([]);
    expect(extractWikilinks("   ", SOURCE)).toEqual([]);
  });

  it("C2_no_wikilinks_returns_empty", () => {
    const result = extractWikilinks(
      "Just some plain text without any links.",
      SOURCE,
    );
    expect(result).toEqual([]);
  });

  it("C3_malformed_wikilinks_ignored", () => {
    const result = extractWikilinks("Empty [[]] and unclosed [[target.", SOURCE);
    expect(result).toEqual([]);
  });

  it("C4_source_node_id_set", () => {
    const customId = "custom-source-99";
    const result = extractWikilinks(
      "Link to [[A]] and [[B|display]].",
      customId,
    );

    expect(result).toHaveLength(2);
    for (const ref of result) {
      expect(ref.sourceNodeId).toBe(customId);
    }
  });

  it("C5_deterministic_output", () => {
    const input = "See [[Alpha]] and [[Beta|b]] and [[Gamma]].";

    const run1 = extractWikilinks(input, SOURCE);
    const run2 = extractWikilinks(input, SOURCE);
    const run3 = extractWikilinks(input, SOURCE);

    expect(run1).toEqual(run2);
    expect(run2).toEqual(run3);
  });
});
