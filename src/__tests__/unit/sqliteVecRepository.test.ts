import { describe, expect, it } from "vitest";
import { SqliteVecRepository } from "../../storage/SqliteVecRepository";
import type {
  CrossReference,
  DocumentNode,
  DocumentTree,
  EmbeddingVector,
  RuntimeBootstrapContext,
  SummaryRecord
} from "../../types";

interface MemoryPluginLike {
  loadData: () => Promise<unknown>;
  saveData: (data: unknown) => Promise<void>;
}

const createMemoryPlugin = (initialData: unknown = null): MemoryPluginLike => {
  let data: unknown = initialData;
  return {
    loadData: async () => data,
    saveData: async (nextData) => {
      data = nextData;
    }
  };
};

const createNode = (overrides: Partial<DocumentNode> & { nodeId: string }): DocumentNode => ({
  nodeId: overrides.nodeId,
  parentId: overrides.parentId ?? null,
  childIds: overrides.childIds ?? [],
  notePath: overrides.notePath ?? "notes/test.md",
  noteTitle: overrides.noteTitle ?? "Test Note",
  headingTrail: overrides.headingTrail ?? [],
  depth: overrides.depth ?? 0,
  nodeType: overrides.nodeType ?? "note",
  content: overrides.content ?? "Test content",
  sequenceIndex: overrides.sequenceIndex ?? 0,
  tags: overrides.tags ?? [],
  contentHash: overrides.contentHash ?? "abc123",
  updatedAt: overrides.updatedAt ?? 1000
});

const createTree = (
  rootOverrides: Partial<DocumentNode> & { nodeId: string },
  childNodes: DocumentNode[] = []
): DocumentTree => {
  const root = createNode({
    ...rootOverrides,
    childIds: childNodes.map((c) => c.nodeId)
  });
  const nodes = new Map<string, DocumentNode>();
  nodes.set(root.nodeId, root);
  for (const child of childNodes) {
    nodes.set(child.nodeId, child);
  }
  return { root, nodes };
};

const createRepo = (initialData: unknown = null) => {
  const plugin = createMemoryPlugin(initialData);
  return new SqliteVecRepository({
    plugin: plugin as unknown as RuntimeBootstrapContext["plugin"],
    pluginId: "obsidian-ai-mvp"
  });
};

const vec = (values: number[]): EmbeddingVector => ({
  values,
  dimensions: values.length
});

describe("STOR-2: SqliteVecRepository", () => {
  describe("Phase A: Repository Structure and Lifecycle", () => {
    it("A1 — implements HierarchicalStoreContract", async () => {
      const repo = createRepo();
      await repo.init();

      expect(typeof repo.upsertNodeTree).toBe("function");
      expect(typeof repo.deleteByNotePath).toBe("function");
      expect(typeof repo.getNode).toBe("function");
      expect(typeof repo.getChildren).toBe("function");
      expect(typeof repo.getAncestorChain).toBe("function");
      expect(typeof repo.getSiblings).toBe("function");
      expect(typeof repo.getNodesByNotePath).toBe("function");
      expect(typeof repo.searchSummaryEmbeddings).toBe("function");
      expect(typeof repo.searchContentEmbeddings).toBe("function");
      expect(typeof repo.upsertSummary).toBe("function");
      expect(typeof repo.getSummary).toBe("function");
      expect(typeof repo.upsertEmbedding).toBe("function");
      expect(typeof repo.upsertTags).toBe("function");
      expect(typeof repo.upsertCrossReferences).toBe("function");
      expect(typeof repo.getCrossReferences).toBe("function");
    });

    it("A2 — init and dispose lifecycle", async () => {
      const repo = createRepo();
      await expect(repo.init()).resolves.toBeUndefined();
      await expect(repo.dispose()).resolves.toBeUndefined();
    });
  });

  describe("Phase B: Node Tree Operations", () => {
    it("B1 — upsertNodeTree stores all nodes and they are retrievable", async () => {
      const repo = createRepo();
      await repo.init();

      const child1 = createNode({
        nodeId: "child-1",
        parentId: "root-1",
        nodeType: "topic",
        depth: 1,
        content: "Topic 1"
      });
      const child2 = createNode({
        nodeId: "child-2",
        parentId: "root-1",
        nodeType: "topic",
        depth: 1,
        content: "Topic 2"
      });
      const tree = createTree(
        { nodeId: "root-1", notePath: "notes/test.md" },
        [child1, child2]
      );

      await repo.upsertNodeTree(tree);

      const root = await repo.getNode("root-1");
      expect(root).not.toBeNull();
      expect(root!.nodeId).toBe("root-1");

      const c1 = await repo.getNode("child-1");
      expect(c1).not.toBeNull();
      expect(c1!.content).toBe("Topic 1");

      const allNodes = await repo.getNodesByNotePath("notes/test.md");
      expect(allNodes).toHaveLength(3);
    });

    it("B2 — upsertNodeTree replaces existing nodes for the same note path", async () => {
      const repo = createRepo();
      await repo.init();

      const tree1 = createTree(
        { nodeId: "root-1", notePath: "notes/test.md", content: "Original" },
        [createNode({ nodeId: "old-child", parentId: "root-1", content: "Old" })]
      );
      await repo.upsertNodeTree(tree1);

      const tree2 = createTree(
        { nodeId: "root-2", notePath: "notes/test.md", content: "Replaced" },
        [createNode({ nodeId: "new-child", parentId: "root-2", content: "New" })]
      );
      await repo.upsertNodeTree(tree2);

      expect(await repo.getNode("root-1")).toBeNull();
      expect(await repo.getNode("old-child")).toBeNull();

      const root2 = await repo.getNode("root-2");
      expect(root2).not.toBeNull();
      expect(root2!.content).toBe("Replaced");

      const allNodes = await repo.getNodesByNotePath("notes/test.md");
      expect(allNodes).toHaveLength(2);
    });

    it("B3 — deleteByNotePath removes all associated data", async () => {
      const repo = createRepo();
      await repo.init();

      const child = createNode({ nodeId: "child-1", parentId: "root-1" });
      const tree = createTree({ nodeId: "root-1", notePath: "notes/test.md" }, [child]);
      await repo.upsertNodeTree(tree);

      await repo.upsertSummary("root-1", {
        nodeId: "root-1",
        summary: "Test summary",
        modelUsed: "gpt-4o-mini",
        promptVersion: "v1",
        generatedAt: 1000
      });
      await repo.upsertEmbedding("root-1", "content", vec([1, 0, 0]));
      await repo.upsertTags("root-1", ["tag1"]);
      await repo.upsertCrossReferences([
        { sourceNodeId: "root-1", targetPath: "notes/other.md", targetDisplay: null }
      ]);

      await repo.deleteByNotePath("notes/test.md");

      expect(await repo.getNode("root-1")).toBeNull();
      expect(await repo.getNode("child-1")).toBeNull();
      expect(await repo.getNodesByNotePath("notes/test.md")).toHaveLength(0);
      expect(await repo.getSummary("root-1")).toBeNull();
      expect(await repo.getCrossReferences("root-1")).toHaveLength(0);

      const searchResults = await repo.searchContentEmbeddings(vec([1, 0, 0]), 10);
      expect(searchResults).toHaveLength(0);
    });
  });

  describe("Phase C: Tree Traversal", () => {
    const setupTraversalTree = async () => {
      const repo = createRepo();
      await repo.init();

      const grandchild = createNode({
        nodeId: "gc-1",
        parentId: "child-1",
        nodeType: "paragraph",
        depth: 2,
        sequenceIndex: 0
      });
      const child1 = createNode({
        nodeId: "child-1",
        parentId: "root-1",
        nodeType: "topic",
        depth: 1,
        sequenceIndex: 0,
        childIds: ["gc-1"]
      });
      const child2 = createNode({
        nodeId: "child-2",
        parentId: "root-1",
        nodeType: "topic",
        depth: 1,
        sequenceIndex: 1
      });
      const child3 = createNode({
        nodeId: "child-3",
        parentId: "root-1",
        nodeType: "topic",
        depth: 1,
        sequenceIndex: 2
      });

      const root = createNode({
        nodeId: "root-1",
        nodeType: "note",
        depth: 0,
        childIds: ["child-1", "child-2", "child-3"]
      });

      const nodes = new Map<string, DocumentNode>();
      nodes.set(root.nodeId, root);
      nodes.set(child1.nodeId, child1);
      nodes.set(child2.nodeId, child2);
      nodes.set(child3.nodeId, child3);
      nodes.set(grandchild.nodeId, grandchild);

      await repo.upsertNodeTree({ root, nodes });
      return repo;
    };

    it("C1 — getChildren returns ordered children", async () => {
      const repo = await setupTraversalTree();

      const children = await repo.getChildren("root-1");
      expect(children).toHaveLength(3);
      expect(children.map((c) => c.nodeId)).toEqual(["child-1", "child-2", "child-3"]);

      const grandchildren = await repo.getChildren("child-1");
      expect(grandchildren).toHaveLength(1);
      expect(grandchildren[0].nodeId).toBe("gc-1");

      const leafChildren = await repo.getChildren("gc-1");
      expect(leafChildren).toHaveLength(0);
    });

    it("C2 — getAncestorChain walks from node to root", async () => {
      const repo = await setupTraversalTree();

      const chain = await repo.getAncestorChain("gc-1");
      expect(chain).toHaveLength(2);
      expect(chain[0].nodeId).toBe("child-1");
      expect(chain[1].nodeId).toBe("root-1");

      const rootChain = await repo.getAncestorChain("root-1");
      expect(rootChain).toHaveLength(0);

      const childChain = await repo.getAncestorChain("child-2");
      expect(childChain).toHaveLength(1);
      expect(childChain[0].nodeId).toBe("root-1");
    });

    it("C3 — getSiblings returns all children of the same parent", async () => {
      const repo = await setupTraversalTree();

      const siblings = await repo.getSiblings("child-2");
      expect(siblings).toHaveLength(3);
      expect(siblings.map((s) => s.nodeId)).toEqual(["child-1", "child-2", "child-3"]);

      const rootSiblings = await repo.getSiblings("root-1");
      expect(rootSiblings).toHaveLength(1);
      expect(rootSiblings[0].nodeId).toBe("root-1");

      const gcSiblings = await repo.getSiblings("gc-1");
      expect(gcSiblings).toHaveLength(1);
      expect(gcSiblings[0].nodeId).toBe("gc-1");
    });
  });

  describe("Phase D: Embedding Search", () => {
    const setupEmbeddings = async () => {
      const repo = createRepo();
      await repo.init();

      const child1 = createNode({
        nodeId: "child-1",
        parentId: "root-1",
        nodeType: "paragraph",
        depth: 1
      });
      const child2 = createNode({
        nodeId: "child-2",
        parentId: "root-1",
        nodeType: "paragraph",
        depth: 1
      });
      const child3 = createNode({
        nodeId: "child-3",
        parentId: "other-root",
        nodeType: "paragraph",
        depth: 1,
        notePath: "notes/other.md"
      });

      const tree1 = createTree({ nodeId: "root-1" }, [child1, child2]);
      await repo.upsertNodeTree(tree1);

      const otherRoot = createNode({
        nodeId: "other-root",
        notePath: "notes/other.md",
        childIds: ["child-3"]
      });
      const tree2: DocumentTree = {
        root: otherRoot,
        nodes: new Map([
          [otherRoot.nodeId, otherRoot],
          [child3.nodeId, child3]
        ])
      };
      await repo.upsertNodeTree(tree2);

      await repo.upsertEmbedding("root-1", "summary", vec([1, 0]));
      await repo.upsertEmbedding("child-1", "content", vec([0.9, 0.1]));
      await repo.upsertEmbedding("child-2", "content", vec([0.1, 0.9]));
      await repo.upsertEmbedding("child-3", "content", vec([0.5, 0.5]));
      await repo.upsertEmbedding("other-root", "summary", vec([0, 1]));

      return repo;
    };

    it("D1 — searchSummaryEmbeddings returns only summary type matches", async () => {
      const repo = await setupEmbeddings();

      const results = await repo.searchSummaryEmbeddings(vec([1, 0]), 10);
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.embeddingType).toBe("summary");
      }
      expect(results[0].nodeId).toBe("root-1");
    });

    it("D2 — searchContentEmbeddings returns only content type matches", async () => {
      const repo = await setupEmbeddings();

      const results = await repo.searchContentEmbeddings(vec([1, 0]), 10);
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.embeddingType).toBe("content");
      }
      expect(results[0].nodeId).toBe("child-1");
    });

    it("D3 — searchContentEmbeddings with parentId scopes to children", async () => {
      const repo = await setupEmbeddings();

      const scoped = await repo.searchContentEmbeddings(vec([0.5, 0.5]), 10, "root-1");
      expect(scoped).toHaveLength(2);
      const scopedIds = scoped.map((r) => r.nodeId);
      expect(scopedIds).toContain("child-1");
      expect(scopedIds).toContain("child-2");
      expect(scopedIds).not.toContain("child-3");

      const otherScoped = await repo.searchContentEmbeddings(vec([0.5, 0.5]), 10, "other-root");
      expect(otherScoped).toHaveLength(1);
      expect(otherScoped[0].nodeId).toBe("child-3");
    });
  });

  describe("Phase E: Summary Operations", () => {
    it("E1 — upsertSummary stores and getSummary retrieves", async () => {
      const repo = createRepo();
      await repo.init();

      const tree = createTree({ nodeId: "root-1" });
      await repo.upsertNodeTree(tree);

      const summary: SummaryRecord = {
        nodeId: "root-1",
        summary: "A test summary",
        modelUsed: "gpt-4o-mini",
        promptVersion: "v1",
        generatedAt: 1000
      };
      await repo.upsertSummary("root-1", summary);

      const retrieved = await repo.getSummary("root-1");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.summary).toBe("A test summary");
      expect(retrieved!.modelUsed).toBe("gpt-4o-mini");
      expect(retrieved!.promptVersion).toBe("v1");
      expect(retrieved!.generatedAt).toBe(1000);
    });

    it("E2 — upsertSummary replaces existing summary", async () => {
      const repo = createRepo();
      await repo.init();

      const tree = createTree({ nodeId: "root-1" });
      await repo.upsertNodeTree(tree);

      await repo.upsertSummary("root-1", {
        nodeId: "root-1",
        summary: "First",
        modelUsed: "gpt-4o-mini",
        promptVersion: "v1",
        generatedAt: 1000
      });

      await repo.upsertSummary("root-1", {
        nodeId: "root-1",
        summary: "Second",
        modelUsed: "gpt-4o-mini",
        promptVersion: "v2",
        generatedAt: 2000
      });

      const retrieved = await repo.getSummary("root-1");
      expect(retrieved!.summary).toBe("Second");
      expect(retrieved!.promptVersion).toBe("v2");
      expect(retrieved!.generatedAt).toBe(2000);
    });
  });

  describe("Phase F: Tag and Cross-Reference Operations", () => {
    it("F1 — upsertTags stores tags for a node", async () => {
      const repo = createRepo();
      await repo.init();

      const tree = createTree({ nodeId: "root-1" });
      await repo.upsertNodeTree(tree);

      await repo.upsertTags("root-1", ["ai", "mvp", "test"]);

      const node = await repo.getNode("root-1");
      expect(node).not.toBeNull();
    });

    it("F2 — upsertCrossReferences stores and getCrossReferences retrieves", async () => {
      const repo = createRepo();
      await repo.init();

      const tree = createTree({ nodeId: "root-1" });
      await repo.upsertNodeTree(tree);

      const refs: CrossReference[] = [
        { sourceNodeId: "root-1", targetPath: "notes/other.md", targetDisplay: "Other Note" },
        { sourceNodeId: "root-1", targetPath: "notes/third.md", targetDisplay: null }
      ];
      await repo.upsertCrossReferences(refs);

      const retrieved = await repo.getCrossReferences("root-1");
      expect(retrieved).toHaveLength(2);
      expect(retrieved[0].targetPath).toBe("notes/other.md");
      expect(retrieved[0].targetDisplay).toBe("Other Note");
      expect(retrieved[1].targetPath).toBe("notes/third.md");
      expect(retrieved[1].targetDisplay).toBeNull();

      const empty = await repo.getCrossReferences("nonexistent");
      expect(empty).toHaveLength(0);
    });
  });

  describe("Phase G: Structured Logging and Persistence", () => {
    it("G1 — operations complete without errors (logging verified by no throws)", async () => {
      const repo = createRepo();
      await repo.init();

      const tree = createTree({ nodeId: "root-1" });
      await repo.upsertNodeTree(tree);
      await repo.upsertSummary("root-1", {
        nodeId: "root-1",
        summary: "s",
        modelUsed: "m",
        promptVersion: "v1",
        generatedAt: 1
      });
      await repo.upsertEmbedding("root-1", "content", vec([1, 0]));
      await repo.upsertTags("root-1", ["tag"]);
      await repo.upsertCrossReferences([
        { sourceNodeId: "root-1", targetPath: "p", targetDisplay: null }
      ]);

      await repo.getNode("root-1");
      await repo.getChildren("root-1");
      await repo.getAncestorChain("root-1");
      await repo.getSiblings("root-1");
      await repo.getNodesByNotePath("notes/test.md");
      await repo.searchSummaryEmbeddings(vec([1, 0]), 5);
      await repo.searchContentEmbeddings(vec([1, 0]), 5);
      await repo.getSummary("root-1");
      await repo.getCrossReferences("root-1");
      await repo.deleteByNotePath("notes/test.md");

      await repo.dispose();
    });

    it("persists state across init cycles", async () => {
      const plugin = createMemoryPlugin();
      const repo1 = new SqliteVecRepository({
        plugin: plugin as unknown as RuntimeBootstrapContext["plugin"],
        pluginId: "obsidian-ai-mvp"
      });
      await repo1.init();

      const tree = createTree({ nodeId: "root-1" });
      await repo1.upsertNodeTree(tree);
      await repo1.upsertSummary("root-1", {
        nodeId: "root-1",
        summary: "persisted",
        modelUsed: "m",
        promptVersion: "v1",
        generatedAt: 1
      });

      const repo2 = new SqliteVecRepository({
        plugin: plugin as unknown as RuntimeBootstrapContext["plugin"],
        pluginId: "obsidian-ai-mvp"
      });
      await repo2.init();

      const node = await repo2.getNode("root-1");
      expect(node).not.toBeNull();
      expect(node!.nodeId).toBe("root-1");

      const summary = await repo2.getSummary("root-1");
      expect(summary).not.toBeNull();
      expect(summary!.summary).toBe("persisted");
    });
  });
});
