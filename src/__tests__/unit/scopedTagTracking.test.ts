import { describe, it, expect, beforeEach } from "vitest";
import { buildDocumentTree } from "../../utils/chunker";
import { SqliteVecRepository } from "../../storage/SqliteVecRepository";
import type { ChunkerInput, DocumentNode, HierarchicalStoreContract } from "../../types";

const createMockPlugin = () => {
  let stored: Record<string, unknown> = {};
  return {
    loadData: async () => stored,
    saveData: async (data: Record<string, unknown>) => {
      stored = data;
    }
  };
};

const buildInput = (markdown: string, notePath = "test.md", noteTitle = "Test"): ChunkerInput => ({
  notePath,
  noteTitle,
  markdown,
  updatedAt: Date.now()
});

describe("META-1: Scoped Tag Tracking", () => {
  let store: SqliteVecRepository;

  beforeEach(async () => {
    const plugin = createMockPlugin();
    store = new SqliteVecRepository({ plugin: plugin as never, pluginId: "test" });
    await store.init();
  });

  describe("A1: getNodesByTag in contract", () => {
    it("A1_getNodesByTag_in_contract — HierarchicalStoreContract includes getNodesByTag", () => {
      const contract: HierarchicalStoreContract = store;
      expect(typeof contract.getNodesByTag).toBe("function");
    });
  });

  describe("B: getNodesByTag implementation", () => {
    const MARKDOWN_WITH_TAGS = `---
tags: [project, important]
---

# Topic A

Some paragraph with #inline-tag content.

## Subtopic B

- Bullet one
- Bullet two with #bullet-tag

# Topic C

Another paragraph here.
`;

    let allNodes: DocumentNode[];

    beforeEach(async () => {
      const input = buildInput(MARKDOWN_WITH_TAGS, "tagged.md", "Tagged Note");
      const result = buildDocumentTree(input);
      await store.upsertNodeTree(result.tree);
      for (const node of result.tree.nodes.values()) {
        if (node.tags.length > 0) {
          await store.upsertTags(node.nodeId, node.tags);
        }
      }
      allNodes = [...result.tree.nodes.values()];
    });

    it("B1_getNodesByTag_all — returns all nodes with the given tag (no parentId)", async () => {
      const projectNodes = await store.getNodesByTag("project");
      expect(projectNodes.length).toBeGreaterThan(0);
      for (const node of projectNodes) {
        expect(node.tags).toContain("project");
      }
    });

    it("B2_getNodesByTag_scoped — returns only descendants of parentId with the tag", async () => {
      const topicA = allNodes.find((n) => n.nodeType === "topic" && n.content === "Topic A");
      expect(topicA).toBeDefined();

      const scopedNodes = await store.getNodesByTag("project", topicA!.nodeId);
      for (const node of scopedNodes) {
        expect(node.tags).toContain("project");
      }

      const topicC = allNodes.find((n) => n.nodeType === "topic" && n.content === "Topic C");
      expect(topicC).toBeDefined();
      const topicCId = topicC!.nodeId;
      const isDescendantOfA = scopedNodes.every((n) => n.nodeId !== topicCId);
      expect(isDescendantOfA).toBe(true);
    });

    it("B3_getNodesByTag_no_match — returns empty array when no nodes match", async () => {
      const result = await store.getNodesByTag("nonexistent-tag");
      expect(result).toEqual([]);
    });

    it("B4_getNodesByTag_invalid_parent — returns empty array when parentId does not exist", async () => {
      const result = await store.getNodesByTag("project", "nonexistent-parent-id");
      expect(result).toEqual([]);
    });
  });

  describe("C: Tag inheritance verification", () => {
    const MARKDOWN_FRONTMATTER_AND_INLINE = `---
tags: [global-tag]
---

# Heading One

Paragraph with #local-tag content.

- Bullet without inline tags
`;

    let treeNodes: DocumentNode[];

    beforeEach(async () => {
      const input = buildInput(MARKDOWN_FRONTMATTER_AND_INLINE, "inherit.md", "Inherit Note");
      const result = buildDocumentTree(input);
      await store.upsertNodeTree(result.tree);
      for (const node of result.tree.nodes.values()) {
        if (node.tags.length > 0) {
          await store.upsertTags(node.nodeId, node.tags);
        }
      }
      treeNodes = [...result.tree.nodes.values()];
    });

    it("C1_frontmatter_tags_on_root — root note node has frontmatter tags", () => {
      const root = treeNodes.find((n) => n.nodeType === "note");
      expect(root).toBeDefined();
      expect(root!.tags).toContain("global-tag");
    });

    it("C2_frontmatter_tags_inherited — all descendants inherit frontmatter tags", () => {
      const nonRootNodes = treeNodes.filter((n) => n.nodeType !== "note");
      expect(nonRootNodes.length).toBeGreaterThan(0);
      for (const node of nonRootNodes) {
        expect(node.tags).toContain("global-tag");
      }
    });

    it("C3_inline_tags_scoped — inline tags appear only on the containing node", () => {
      const nodesWithLocalTag = treeNodes.filter((n) => n.tags.includes("local-tag"));
      expect(nodesWithLocalTag.length).toBeGreaterThan(0);
      for (const node of nodesWithLocalTag) {
        expect(node.content).toContain("#local-tag");
      }

      const bulletNodes = treeNodes.filter((n) => n.nodeType === "bullet");
      for (const bullet of bulletNodes) {
        if (!bullet.content.includes("#local-tag")) {
          expect(bullet.tags).not.toContain("local-tag");
        }
      }
    });

    it("C4_merged_tags — node with both frontmatter and inline tags has merged set", () => {
      const paragraphWithInline = treeNodes.find(
        (n) => n.nodeType === "paragraph" && n.content.includes("#local-tag")
      );
      expect(paragraphWithInline).toBeDefined();
      expect(paragraphWithInline!.tags).toContain("global-tag");
      expect(paragraphWithInline!.tags).toContain("local-tag");
    });
  });
});
