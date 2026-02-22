import { describe, expect, it } from "vitest";
import { chunkMarkdownNote, extractTagsFromMarkdown } from "../../utils/chunker";

describe("chunkMarkdownNote", () => {
  it("returns deterministic chunks with preserved heading trail", () => {
    const markdown = [
      "Intro paragraph before headings.",
      "",
      "# Project",
      "Top level paragraph.",
      "",
      "## Decisions",
      "Nested paragraph with #Architecture tag.",
      ""
    ].join("\n");

    const input = {
      notePath: "notes/roadmap.md",
      noteTitle: "Roadmap",
      markdown,
      updatedAt: 1700000000000
    };

    const firstRun = chunkMarkdownNote(input);
    const secondRun = chunkMarkdownNote(input);

    expect(firstRun).toEqual(secondRun);
    expect(firstRun).toHaveLength(3);
    expect(firstRun[0].source.headingTrail).toEqual([]);
    expect(firstRun[1].source.headingTrail).toEqual(["Project"]);
    expect(firstRun[2].source.headingTrail).toEqual(["Project", "Decisions"]);
    expect(firstRun[2].source.contextKind).toBe("paragraph");
    expect(firstRun[2].source.tags).toEqual(["architecture"]);
  });

  it("splits paragraph and bullet chunks distinctly in mixed sections", () => {
    const markdown = [
      "# Weekly Plan",
      "Paragraph context first.",
      "",
      "- Bullet one #Todo",
      "- Bullet two",
      "",
      "Paragraph after bullets."
    ].join("\n");

    const chunks = chunkMarkdownNote({
      notePath: "notes/weekly.md",
      noteTitle: "Weekly",
      markdown,
      updatedAt: 1700000000000
    });

    const contextKinds = chunks.map((chunk) => chunk.source.contextKind);
    expect(contextKinds).toEqual(["paragraph", "bullet", "bullet", "paragraph"]);
    expect(chunks[1].source.headingTrail).toEqual(["Weekly Plan"]);
    expect(chunks[3].source.headingTrail).toEqual(["Weekly Plan"]);
    expect(chunks.every((chunk) => chunk.source.tags.includes("todo"))).toBe(true);
  });

  it("extracts and normalizes frontmatter tags across common formats", () => {
    const arrayTags = extractTagsFromMarkdown(["---", "tags: [AI, \"MVP\"]", "---", "Body"].join("\n"));
    const scalarTag = extractTagsFromMarkdown(["---", "tags: Research", "---", "Body"].join("\n"));
    const blockTags = extractTagsFromMarkdown([
      "---",
      "tags:",
      "  - Focus",
      "  - '#DeepWork'",
      "  - ''",
      "---",
      "Body"
    ].join("\n"));

    expect(arrayTags).toEqual(["ai", "mvp"]);
    expect(scalarTag).toEqual(["research"]);
    expect(blockTags).toEqual(["deepwork", "focus"]);
  });

  it("merges frontmatter and inline tags with deterministic ordering", () => {
    const markdown = [
      "---",
      "tags: [AI, goals]",
      "---",
      "# Heading",
      "Paragraph uses #Goals and #roadmap.",
      "- Bullet with #AI mention"
    ].join("\n");

    const chunks = chunkMarkdownNote({
      notePath: "notes/tags.md",
      noteTitle: "Tags",
      markdown,
      updatedAt: 1700000000000
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0].source.tags).toEqual(["ai", "goals", "roadmap"]);
    expect(chunks[1].source.tags).toEqual(["ai", "goals", "roadmap"]);
  });

  it("handles blank lines and non-chunkable content without throwing", () => {
    expect(
      chunkMarkdownNote({
        notePath: "notes/blank.md",
        noteTitle: "Blank",
        markdown: "\n\n   \n",
        updatedAt: 1700000000000
      })
    ).toEqual([]);

    expect(() => extractTagsFromMarkdown(["---", "tags: []", "---", ""].join("\n"))).not.toThrow();
  });

  it("splits oversized chunks when maxChunkChars is configured", () => {
    const markdown = "A very long paragraph that should split into multiple deterministic chunks for testing.";
    const chunks = chunkMarkdownNote(
      {
        notePath: "notes/split.md",
        noteTitle: "Split",
        markdown,
        updatedAt: 1700000000000
      },
      { maxChunkChars: 24 }
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= 24)).toBe(true);
    expect(chunks.every((chunk) => chunk.source.contextKind === "paragraph")).toBe(true);
  });
});
