import { describe, expect, it } from "vitest";
import { buildDocumentTree } from "../../utils/chunker";
import type { ChunkerInput, DocumentNode } from "../../types";

const makeInput = (markdown: string, overrides: Partial<ChunkerInput> = {}): ChunkerInput => ({
  notePath: "notes/test.md",
  noteTitle: "Test Note",
  markdown,
  updatedAt: 1700000000000,
  ...overrides,
});

const getNodesByType = (nodes: Map<string, DocumentNode>, type: DocumentNode["nodeType"]): DocumentNode[] =>
  [...nodes.values()].filter((n) => n.nodeType === type);

describe("buildDocumentTree", () => {
  // ── Phase A: Tree Structure ───────────────────────────────────────

  describe("Phase A: Tree Structure", () => {
    it("A1_root_note_node", () => {
      const { tree } = buildDocumentTree(makeInput("Some content."));

      expect(tree.root.nodeType).toBe("note");
      expect(tree.root.depth).toBe(0);
      expect(tree.root.parentId).toBeNull();
      expect(tree.root.content).toBe("Test Note");
      expect(tree.nodes.has(tree.root.nodeId)).toBe(true);

      for (const node of tree.nodes.values()) {
        expect(tree.nodes.has(node.nodeId)).toBe(true);
      }
    });

    it("A2_topic_nodes_from_h1", () => {
      const md = "# My Topic\n\nSome text.";
      const { tree } = buildDocumentTree(makeInput(md));

      const topics = getNodesByType(tree.nodes, "topic");
      expect(topics).toHaveLength(1);
      expect(topics[0].depth).toBe(1);
      expect(topics[0].headingTrail).toEqual(["My Topic"]);
      expect(topics[0].parentId).toBe(tree.root.nodeId);
    });

    it("A3_subtopic_nodes_from_h2_through_h6", () => {
      const md = [
        "# Main",
        "## Sub",
        "### SubSub",
        "#### Level4",
        "##### Level5",
        "###### Level6",
      ].join("\n");

      const { tree } = buildDocumentTree(makeInput(md));

      const topics = getNodesByType(tree.nodes, "topic");
      expect(topics).toHaveLength(1);
      expect(topics[0].headingTrail).toEqual(["Main"]);

      const subtopics = getNodesByType(tree.nodes, "subtopic");
      expect(subtopics).toHaveLength(5);

      const sub = subtopics.find((n) => n.content === "Sub");
      expect(sub).toBeDefined();
      expect(sub!.depth).toBe(2);
      expect(sub!.headingTrail).toEqual(["Main", "Sub"]);
      expect(sub!.parentId).toBe(topics[0].nodeId);

      const subSub = subtopics.find((n) => n.content === "SubSub");
      expect(subSub).toBeDefined();
      expect(subSub!.depth).toBe(3);
      expect(subSub!.headingTrail).toEqual(["Main", "Sub", "SubSub"]);
      expect(subSub!.parentId).toBe(sub!.nodeId);

      const level6 = subtopics.find((n) => n.content === "Level6");
      expect(level6).toBeDefined();
      expect(level6!.depth).toBe(6);
    });

    it("A4_content_before_first_heading", () => {
      const md = "Intro paragraph.\n\n# Heading\n\nAfter heading.";
      const { tree } = buildDocumentTree(makeInput(md));

      const paragraphs = getNodesByType(tree.nodes, "paragraph");
      const introPara = paragraphs.find((n) => n.content === "Intro paragraph.");
      expect(introPara).toBeDefined();
      expect(introPara!.parentId).toBe(tree.root.nodeId);
    });

    it("A5_stable_deterministic_node_ids", () => {
      const input = makeInput("# Topic\n\nParagraph text.\n\n- Bullet one");
      const first = buildDocumentTree(input);
      const second = buildDocumentTree(input);

      const firstIds = [...first.tree.nodes.keys()].sort();
      const secondIds = [...second.tree.nodes.keys()].sort();
      expect(firstIds).toEqual(secondIds);
    });

    it("A6_bidirectional_parent_child", () => {
      const md = [
        "# Topic",
        "## Subtopic",
        "Paragraph.",
        "",
        "- Bullet one",
        "  - Sub bullet",
      ].join("\n");

      const { tree } = buildDocumentTree(makeInput(md));

      for (const node of tree.nodes.values()) {
        if (node.parentId === null) {
          expect(node.nodeId).toBe(tree.root.nodeId);
        } else {
          expect(tree.nodes.has(node.parentId)).toBe(true);
          const parent = tree.nodes.get(node.parentId)!;
          expect(parent.childIds).toContain(node.nodeId);
        }

        for (const childId of node.childIds) {
          expect(tree.nodes.has(childId)).toBe(true);
          const child = tree.nodes.get(childId)!;
          expect(child.parentId).toBe(node.nodeId);
        }
      }
    });
  });

  // ── Phase B: Paragraphs ───────────────────────────────────────────

  describe("Phase B: Paragraphs", () => {
    it("B1_paragraph_node_from_text_block", () => {
      const md = "This is a paragraph.\nWith multiple lines.";
      const { tree } = buildDocumentTree(makeInput(md));

      const paragraphs = getNodesByType(tree.nodes, "paragraph");
      expect(paragraphs).toHaveLength(1);
      expect(paragraphs[0].content).toBe("This is a paragraph.\nWith multiple lines.");
      expect(paragraphs[0].nodeType).toBe("paragraph");
    });

    it("B2_long_paragraph_sentence_split", () => {
      const longText = "First sentence is here. Second sentence follows. Third sentence comes next. Fourth sentence appears. Fifth sentence concludes.";
      const { tree } = buildDocumentTree(makeInput(longText), { maxParagraphChars: 50 });

      const paragraphs = getNodesByType(tree.nodes, "paragraph");
      expect(paragraphs.length).toBeGreaterThan(1);
      for (const p of paragraphs) {
        expect(p.nodeType).toBe("paragraph");
        expect(p.parentId).toBe(tree.root.nodeId);
      }
    });

    it("B3_split_paragraph_reassembly", () => {
      const longText = "First sentence is here. Second sentence follows. Third sentence comes next. Fourth sentence appears. Fifth sentence concludes.";
      const { tree } = buildDocumentTree(makeInput(longText), { maxParagraphChars: 50 });

      const paragraphs = getNodesByType(tree.nodes, "paragraph")
        .filter((n) => n.parentId === tree.root.nodeId)
        .sort((a, b) => a.sequenceIndex - b.sequenceIndex);

      expect(paragraphs.length).toBeGreaterThan(1);

      const reassembled = paragraphs.map((p) => p.content).join(" ");
      expect(reassembled).toBe(longText);
    });

    it("B3_split_paragraph_sequential_indices", () => {
      const longText = "First sentence is here. Second sentence follows. Third sentence comes next. Fourth sentence appears. Fifth sentence concludes.";
      const { tree } = buildDocumentTree(makeInput(longText), { maxParagraphChars: 50 });

      const paragraphs = getNodesByType(tree.nodes, "paragraph")
        .filter((n) => n.parentId === tree.root.nodeId)
        .sort((a, b) => a.sequenceIndex - b.sequenceIndex);

      for (let i = 0; i < paragraphs.length; i++) {
        expect(paragraphs[i].sequenceIndex).toBe(i);
      }
    });
  });

  // ── Phase C: Bullets ──────────────────────────────────────────────

  describe("Phase C: Bullets", () => {
    it("C1_bullet_group_from_consecutive_bullets", () => {
      const md = "- Item one\n- Item two\n- Item three";
      const { tree } = buildDocumentTree(makeInput(md));

      const groups = getNodesByType(tree.nodes, "bullet_group");
      expect(groups).toHaveLength(1);

      const bullets = getNodesByType(tree.nodes, "bullet");
      expect(bullets).toHaveLength(3);

      for (const bullet of bullets) {
        expect(bullet.parentId).toBe(groups[0].nodeId);
      }
    });

    it("C2_blank_line_separates_bullet_groups", () => {
      const md = "- First group item\n\n- Second group item";
      const { tree } = buildDocumentTree(makeInput(md));

      const groups = getNodesByType(tree.nodes, "bullet_group");
      expect(groups).toHaveLength(2);
    });

    it("C3_sub_bullets_nested", () => {
      const md = "- Parent bullet\n  - Child bullet\n  - Another child";
      const { tree } = buildDocumentTree(makeInput(md));

      const bullets = getNodesByType(tree.nodes, "bullet");
      expect(bullets).toHaveLength(3);

      const parentBullet = bullets.find((b) => b.content === "Parent bullet");
      expect(parentBullet).toBeDefined();
      expect(parentBullet!.childIds).toHaveLength(2);

      const childBullet = bullets.find((b) => b.content === "Child bullet");
      expect(childBullet).toBeDefined();
      expect(childBullet!.parentId).toBe(parentBullet!.nodeId);
    });

    it("C4_all_bullet_markers_recognized", () => {
      const md = "- Dash item\n* Star item\n+ Plus item\n1. Ordered item";
      const { tree } = buildDocumentTree(makeInput(md));

      const bullets = getNodesByType(tree.nodes, "bullet");
      expect(bullets).toHaveLength(4);

      const contents = bullets.map((b) => b.content).sort();
      expect(contents).toEqual(["Dash item", "Ordered item", "Plus item", "Star item"]);
    });

    it("C5_bullet_group_content_concatenation", () => {
      const md = "- Alpha\n- Beta\n- Gamma";
      const { tree } = buildDocumentTree(makeInput(md));

      const groups = getNodesByType(tree.nodes, "bullet_group");
      expect(groups).toHaveLength(1);
      expect(groups[0].content).toBe("Alpha\nBeta\nGamma");
    });
  });

  // ── Phase D: Tags ─────────────────────────────────────────────────

  describe("Phase D: Tags", () => {
    it("D1_frontmatter_tags_inherited", () => {
      const md = "---\ntags: [project, important]\n---\n# Topic\n\nParagraph text.";
      const { tree } = buildDocumentTree(makeInput(md));

      for (const node of tree.nodes.values()) {
        expect(node.tags).toContain("project");
        expect(node.tags).toContain("important");
      }
    });

    it("D2_inline_tags_scoped", () => {
      const md = "# Topic\n\nParagraph with #special tag.\n\nAnother paragraph without it.";
      const { tree } = buildDocumentTree(makeInput(md));

      const paragraphs = getNodesByType(tree.nodes, "paragraph");
      const withTag = paragraphs.find((p) => p.content.includes("#special"));
      const withoutTag = paragraphs.find((p) => !p.content.includes("#special"));

      expect(withTag).toBeDefined();
      expect(withTag!.tags).toContain("special");

      expect(withoutTag).toBeDefined();
      expect(withoutTag!.tags).not.toContain("special");
    });

    it("D3_tags_normalized_deduped_sorted", () => {
      const md = "---\ntags: [Zebra, alpha]\n---\nParagraph with #Alpha and #ZEBRA and #beta.";
      const { tree } = buildDocumentTree(makeInput(md));

      const paragraphs = getNodesByType(tree.nodes, "paragraph");
      expect(paragraphs).toHaveLength(1);
      expect(paragraphs[0].tags).toEqual(["alpha", "beta", "zebra"]);
    });
  });

  // ── Phase E: Cross-References ─────────────────────────────────────

  describe("Phase E: Cross-References", () => {
    it("E1_wikilinks_extracted", () => {
      const md = "Paragraph with [[Target Note]] and [[Other|Display]].";
      const { crossReferences } = buildDocumentTree(makeInput(md));

      expect(crossReferences.length).toBeGreaterThanOrEqual(2);

      const targetRef = crossReferences.find((r) => r.targetPath === "Target Note");
      expect(targetRef).toBeDefined();

      const otherRef = crossReferences.find((r) => r.targetPath === "Other");
      expect(otherRef).toBeDefined();
      expect(otherRef!.targetDisplay).toBe("Display");
    });
  });

  // ── Phase F: Metadata ─────────────────────────────────────────────

  describe("Phase F: Metadata", () => {
    it("F1_content_hash_change_detection", () => {
      const md1 = "Content version one.";
      const md2 = "Content version two.";

      const { tree: tree1 } = buildDocumentTree(makeInput(md1));
      const { tree: tree2 } = buildDocumentTree(makeInput(md2));

      const para1 = getNodesByType(tree1.nodes, "paragraph")[0];
      const para2 = getNodesByType(tree2.nodes, "paragraph")[0];

      expect(para1.contentHash).not.toBe(para2.contentHash);

      const { tree: tree1Again } = buildDocumentTree(makeInput(md1));
      const para1Again = getNodesByType(tree1Again.nodes, "paragraph")[0];
      expect(para1.contentHash).toBe(para1Again.contentHash);
    });

    it("F2_sequence_index_ordering", () => {
      const md = "# Topic\n\nFirst para.\n\nSecond para.\n\nThird para.";
      const { tree } = buildDocumentTree(makeInput(md));

      const topic = getNodesByType(tree.nodes, "topic")[0];
      const children = topic.childIds.map((id) => tree.nodes.get(id)!);

      for (let i = 0; i < children.length; i++) {
        expect(children[i].sequenceIndex).toBe(i);
      }
    });

    it("F3_updated_at_propagated", () => {
      const md = "# Topic\n\nParagraph.\n\n- Bullet";
      const updatedAt = 1700000000000;
      const { tree } = buildDocumentTree(makeInput(md, { updatedAt }));

      for (const node of tree.nodes.values()) {
        expect(node.updatedAt).toBe(updatedAt);
      }
    });
  });

  // ── Phase H: Edge Cases ───────────────────────────────────────────

  describe("Phase H: Edge Cases", () => {
    it("H1_empty_markdown_root_only", () => {
      const { tree } = buildDocumentTree(makeInput(""));
      expect(tree.nodes.size).toBe(1);
      expect(tree.root.childIds).toHaveLength(0);
      expect(tree.root.nodeType).toBe("note");
    });

    it("H1_whitespace_only_root_only", () => {
      const { tree } = buildDocumentTree(makeInput("   \n\n  \n"));
      expect(tree.nodes.size).toBe(1);
      expect(tree.root.childIds).toHaveLength(0);
    });

    it("H2_no_headings_flat_under_root", () => {
      const md = "First paragraph.\n\nSecond paragraph.\n\n- A bullet";
      const { tree } = buildDocumentTree(makeInput(md));

      const nonRoot = [...tree.nodes.values()].filter((n) => n.nodeId !== tree.root.nodeId);
      for (const node of nonRoot) {
        if (node.nodeType === "paragraph" || node.nodeType === "bullet_group") {
          expect(node.parentId).toBe(tree.root.nodeId);
        }
      }
    });

    it("H3_code_fences_as_paragraph", () => {
      const md = [
        "```javascript",
        "# Not a heading",
        "- Not a bullet",
        "const x = 1;",
        "```",
      ].join("\n");

      const { tree } = buildDocumentTree(makeInput(md));

      const topics = getNodesByType(tree.nodes, "topic");
      expect(topics).toHaveLength(0);

      const bullets = getNodesByType(tree.nodes, "bullet");
      expect(bullets).toHaveLength(0);

      const paragraphs = getNodesByType(tree.nodes, "paragraph");
      expect(paragraphs).toHaveLength(1);
      expect(paragraphs[0].content).toContain("# Not a heading");
      expect(paragraphs[0].content).toContain("const x = 1;");
    });

    it("H4_mixed_content_correct_tree", () => {
      const md = [
        "Intro text.",
        "",
        "# First Topic",
        "Topic paragraph.",
        "",
        "- Bullet A",
        "- Bullet B",
        "",
        "## Subtopic",
        "Subtopic text.",
        "",
        "# Second Topic",
        "Second topic text.",
      ].join("\n");

      const { tree } = buildDocumentTree(makeInput(md));

      expect(tree.root.nodeType).toBe("note");

      const topics = getNodesByType(tree.nodes, "topic");
      expect(topics).toHaveLength(2);
      expect(topics[0].content).toBe("First Topic");
      expect(topics[1].content).toBe("Second Topic");

      const subtopics = getNodesByType(tree.nodes, "subtopic");
      expect(subtopics).toHaveLength(1);
      expect(subtopics[0].parentId).toBe(topics[0].nodeId);

      const bulletGroups = getNodesByType(tree.nodes, "bullet_group");
      expect(bulletGroups).toHaveLength(1);
      expect(bulletGroups[0].parentId).toBe(topics[0].nodeId);

      const introPara = getNodesByType(tree.nodes, "paragraph").find(
        (p) => p.content === "Intro text.",
      );
      expect(introPara).toBeDefined();
      expect(introPara!.parentId).toBe(tree.root.nodeId);

      for (const node of tree.nodes.values()) {
        if (node.parentId !== null) {
          const parent = tree.nodes.get(node.parentId);
          expect(parent).toBeDefined();
          expect(parent!.childIds).toContain(node.nodeId);
        }
      }
    });
  });
});
