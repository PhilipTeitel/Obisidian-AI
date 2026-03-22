import { describe, expect, it } from "vitest";
import { formatHierarchicalContext } from "../../utils/contextFormatter";
import type { HierarchicalContextBlock } from "../../types";

const createBlock = (overrides?: Partial<HierarchicalContextBlock>): HierarchicalContextBlock => ({
  notePath: "notes/test.md",
  noteTitle: "Test Note",
  headingTrail: ["Topic A", "Subtopic B"],
  matchedContent: "This is the matched paragraph content.",
  siblingContent: "This is sibling content.",
  parentSummary: "This is the parent summary.",
  score: 0.9,
  ...overrides
});

describe("formatHierarchicalContext", () => {
  describe("Phase A: Formatting Logic", () => {
    it("A1 — produces structured output with source path", () => {
      const result = formatHierarchicalContext([createBlock()]);
      expect(result).toContain("Source: notes/test.md");
    });

    it("A2 — heading trail entries are rendered as markdown headings", () => {
      const result = formatHierarchicalContext([createBlock()]);
      expect(result).toContain("# Topic A");
      expect(result).toContain("## Subtopic B");
    });

    it("A3 — parent summary is rendered as Summary line", () => {
      const result = formatHierarchicalContext([createBlock()]);
      expect(result).toContain("Summary: This is the parent summary.");
    });

    it("A4 — matched content is included as the main body", () => {
      const result = formatHierarchicalContext([createBlock()]);
      expect(result).toContain("This is the matched paragraph content.");
    });

    it("A5 — sibling content is included as additional context", () => {
      const result = formatHierarchicalContext([createBlock()]);
      expect(result).toContain("This is sibling content.");
    });

    it("A6 — multiple blocks are separated by double newlines", () => {
      const block1 = createBlock({ notePath: "notes/a.md" });
      const block2 = createBlock({ notePath: "notes/b.md" });
      const result = formatHierarchicalContext([block1, block2]);

      expect(result).toContain("Source: notes/a.md");
      expect(result).toContain("Source: notes/b.md");

      const parts = result.split("\n\n");
      expect(parts.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Phase B: Edge Cases", () => {
    it("B1 — empty blocks array returns empty string", () => {
      const result = formatHierarchicalContext([]);
      expect(result).toBe("");
    });

    it("B2 — blocks with empty heading trail omit heading lines", () => {
      const result = formatHierarchicalContext([createBlock({ headingTrail: [] })]);
      expect(result).not.toContain("# ");
      expect(result).toContain("Source: notes/test.md");
      expect(result).toContain("This is the matched paragraph content.");
    });

    it("B3 — blocks with empty parent summary omit summary line", () => {
      const result = formatHierarchicalContext([createBlock({ parentSummary: "" })]);
      expect(result).not.toContain("Summary:");
      expect(result).toContain("This is the matched paragraph content.");
    });
  });
});
