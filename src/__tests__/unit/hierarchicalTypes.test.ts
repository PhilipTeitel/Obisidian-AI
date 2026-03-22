import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AssembledContext,
  ChatContextChunk,
  ChunkRecord,
  ChunkReference,
  ContextTierUsage,
  CrossReference,
  DocumentNode,
  DocumentTree,
  EmbeddingType,
  EmbeddingVector,
  HierarchicalContextBlock,
  HierarchicalSearchResult,
  HierarchicalStoreContract,
  IndexingStage,
  LeafMatch,
  NodeMatch,
  NodeType,
  RuntimeServices,
  SearchResult,
  SummaryRecord,
  VectorStoreMatch,
  VectorStoreRepositoryContract,
  VectorStoreRow
} from "../../types";

const createDocumentNode = (overrides: Partial<DocumentNode> = {}): DocumentNode => ({
  nodeId: "node-1",
  parentId: null,
  childIds: [],
  notePath: "notes/example.md",
  noteTitle: "Example",
  headingTrail: [],
  depth: 0,
  nodeType: "note",
  content: "Root content",
  sequenceIndex: 0,
  tags: [],
  contentHash: "abc123",
  updatedAt: 1700000000000,
  ...overrides
});

describe("hierarchical types compile-time contract tests", () => {
  it("A1 — NodeType union accepts all six values", () => {
    const values: NodeType[] = ["note", "topic", "subtopic", "paragraph", "bullet_group", "bullet"];
    expect(values).toHaveLength(6);

    const note: NodeType = "note";
    const topic: NodeType = "topic";
    const subtopic: NodeType = "subtopic";
    const paragraph: NodeType = "paragraph";
    const bulletGroup: NodeType = "bullet_group";
    const bullet: NodeType = "bullet";

    expectTypeOf(note).toMatchTypeOf<NodeType>();
    expectTypeOf(topic).toMatchTypeOf<NodeType>();
    expectTypeOf(subtopic).toMatchTypeOf<NodeType>();
    expectTypeOf(paragraph).toMatchTypeOf<NodeType>();
    expectTypeOf(bulletGroup).toMatchTypeOf<NodeType>();
    expectTypeOf(bullet).toMatchTypeOf<NodeType>();
  });

  it("A2 — DocumentNode has all required fields", () => {
    const node = createDocumentNode();

    expectTypeOf(node.nodeId).toEqualTypeOf<string>();
    expectTypeOf(node.parentId).toEqualTypeOf<string | null>();
    expectTypeOf(node.childIds).toEqualTypeOf<string[]>();
    expectTypeOf(node.notePath).toEqualTypeOf<string>();
    expectTypeOf(node.noteTitle).toEqualTypeOf<string>();
    expectTypeOf(node.headingTrail).toEqualTypeOf<string[]>();
    expectTypeOf(node.depth).toEqualTypeOf<number>();
    expectTypeOf(node.nodeType).toEqualTypeOf<NodeType>();
    expectTypeOf(node.content).toEqualTypeOf<string>();
    expectTypeOf(node.sequenceIndex).toEqualTypeOf<number>();
    expectTypeOf(node.tags).toEqualTypeOf<string[]>();
    expectTypeOf(node.contentHash).toEqualTypeOf<string>();
    expectTypeOf(node.updatedAt).toEqualTypeOf<number>();

    expect(node.nodeId).toBe("node-1");
    expect(node.parentId).toBeNull();
    expect(node.childIds).toEqual([]);
  });

  it("A3 — DocumentTree can be constructed with root and Map", () => {
    const root = createDocumentNode();
    const child = createDocumentNode({
      nodeId: "node-2",
      parentId: "node-1",
      depth: 1,
      nodeType: "topic",
      headingTrail: ["Project"],
      content: "Topic content",
      sequenceIndex: 0
    });

    const nodes = new Map<string, DocumentNode>();
    nodes.set(root.nodeId, root);
    nodes.set(child.nodeId, child);

    const tree: DocumentTree = { root, nodes };

    expectTypeOf(tree.root).toEqualTypeOf<DocumentNode>();
    expectTypeOf(tree.nodes).toEqualTypeOf<Map<string, DocumentNode>>();

    expect(tree.nodes.size).toBe(2);
    expect(tree.nodes.get("node-1")).toBe(root);
    expect(tree.nodes.get("node-2")).toBe(child);
  });

  it("B1 — SummaryRecord has all provenance fields", () => {
    const record: SummaryRecord = {
      nodeId: "node-1",
      summary: "A concise summary.",
      modelUsed: "gpt-4o-mini",
      promptVersion: "v1.0",
      generatedAt: 1700000000000
    };

    expectTypeOf(record.nodeId).toEqualTypeOf<string>();
    expectTypeOf(record.summary).toEqualTypeOf<string>();
    expectTypeOf(record.modelUsed).toEqualTypeOf<string>();
    expectTypeOf(record.promptVersion).toEqualTypeOf<string>();
    expectTypeOf(record.generatedAt).toEqualTypeOf<number>();

    expect(record.modelUsed).toBe("gpt-4o-mini");
  });

  it("B2 — EmbeddingType and NodeMatch are defined correctly", () => {
    const contentType: EmbeddingType = "content";
    const summaryType: EmbeddingType = "summary";

    expectTypeOf(contentType).toMatchTypeOf<EmbeddingType>();
    expectTypeOf(summaryType).toMatchTypeOf<EmbeddingType>();

    const match: NodeMatch = {
      nodeId: "node-1",
      score: 0.95,
      embeddingType: "content"
    };

    expectTypeOf(match.nodeId).toEqualTypeOf<string>();
    expectTypeOf(match.score).toEqualTypeOf<number>();
    expectTypeOf(match.embeddingType).toEqualTypeOf<EmbeddingType>();

    expect(match.score).toBe(0.95);
  });

  it("B3 — CrossReference has all fields", () => {
    const ref: CrossReference = {
      sourceNodeId: "node-1",
      targetPath: "notes/other.md",
      targetDisplay: "Other Note"
    };

    expectTypeOf(ref.sourceNodeId).toEqualTypeOf<string>();
    expectTypeOf(ref.targetPath).toEqualTypeOf<string>();
    expectTypeOf(ref.targetDisplay).toEqualTypeOf<string | null>();

    const refWithNull: CrossReference = {
      sourceNodeId: "node-2",
      targetPath: "notes/target.md",
      targetDisplay: null
    };

    expect(refWithNull.targetDisplay).toBeNull();
  });

  it("C1 — LeafMatch carries node, score, and ancestorChain", () => {
    const root = createDocumentNode();
    const child = createDocumentNode({
      nodeId: "node-2",
      parentId: "node-1",
      depth: 1,
      nodeType: "paragraph"
    });

    const leafMatch: LeafMatch = {
      node: child,
      score: 0.88,
      ancestorChain: [root]
    };

    expectTypeOf(leafMatch.node).toEqualTypeOf<DocumentNode>();
    expectTypeOf(leafMatch.score).toEqualTypeOf<number>();
    expectTypeOf(leafMatch.ancestorChain).toEqualTypeOf<DocumentNode[]>();

    expect(leafMatch.ancestorChain).toHaveLength(1);
  });

  it("C2 — HierarchicalContextBlock and AssembledContext are defined", () => {
    const block: HierarchicalContextBlock = {
      notePath: "notes/example.md",
      noteTitle: "Example",
      headingTrail: ["Project", "Decisions"],
      matchedContent: "Matched paragraph text.",
      siblingContent: "Sibling paragraph text.",
      parentSummary: "Summary of the parent topic.",
      score: 0.92
    };

    expectTypeOf(block.notePath).toEqualTypeOf<string>();
    expectTypeOf(block.noteTitle).toEqualTypeOf<string>();
    expectTypeOf(block.headingTrail).toEqualTypeOf<string[]>();
    expectTypeOf(block.matchedContent).toEqualTypeOf<string>();
    expectTypeOf(block.siblingContent).toEqualTypeOf<string>();
    expectTypeOf(block.parentSummary).toEqualTypeOf<string>();
    expectTypeOf(block.score).toEqualTypeOf<number>();

    const tierUsage: ContextTierUsage = {
      matchedContentTokens: 500,
      siblingContextTokens: 200,
      parentSummaryTokens: 100
    };

    expectTypeOf(tierUsage.matchedContentTokens).toEqualTypeOf<number>();
    expectTypeOf(tierUsage.siblingContextTokens).toEqualTypeOf<number>();
    expectTypeOf(tierUsage.parentSummaryTokens).toEqualTypeOf<number>();

    const assembled: AssembledContext = {
      blocks: [block],
      tierUsage
    };

    expectTypeOf(assembled.blocks).toEqualTypeOf<HierarchicalContextBlock[]>();
    expectTypeOf(assembled.tierUsage).toEqualTypeOf<ContextTierUsage>();

    expect(assembled.blocks).toHaveLength(1);
  });

  it("C3 — HierarchicalSearchResult has all fields", () => {
    const result: HierarchicalSearchResult = {
      nodeId: "node-3",
      score: 0.91,
      notePath: "notes/example.md",
      noteTitle: "Example",
      headingTrail: ["Project"],
      matchedContent: "Matched text.",
      parentSummary: "Parent summary.",
      siblingSnippet: "Sibling snippet.",
      tags: ["architecture"]
    };

    expectTypeOf(result.nodeId).toEqualTypeOf<string>();
    expectTypeOf(result.score).toEqualTypeOf<number>();
    expectTypeOf(result.notePath).toEqualTypeOf<string>();
    expectTypeOf(result.noteTitle).toEqualTypeOf<string>();
    expectTypeOf(result.headingTrail).toEqualTypeOf<string[]>();
    expectTypeOf(result.matchedContent).toEqualTypeOf<string>();
    expectTypeOf(result.parentSummary).toEqualTypeOf<string>();
    expectTypeOf(result.siblingSnippet).toEqualTypeOf<string>();
    expectTypeOf(result.tags).toEqualTypeOf<string[]>();

    expect(result.tags).toContain("architecture");
  });

  it("D1 — HierarchicalStoreContract declares all required methods", () => {
    const mockVector: EmbeddingVector = { values: [0.1, 0.2], dimensions: 2 };
    const mockNode = createDocumentNode();
    const mockTree: DocumentTree = {
      root: mockNode,
      nodes: new Map([["node-1", mockNode]])
    };
    const mockSummary: SummaryRecord = {
      nodeId: "node-1",
      summary: "Summary text.",
      modelUsed: "gpt-4o-mini",
      promptVersion: "v1.0",
      generatedAt: Date.now()
    };

    const store: HierarchicalStoreContract = {
      upsertNodeTree: async () => undefined,
      deleteByNotePath: async () => undefined,
      getNode: async () => null,
      getChildren: async () => [],
      getAncestorChain: async () => [],
      getSiblings: async () => [],
      getNodesByNotePath: async () => [],
      searchSummaryEmbeddings: async () => [],
      searchContentEmbeddings: async () => [],
      upsertSummary: async () => undefined,
      getSummary: async () => null,
      upsertEmbedding: async () => undefined,
      upsertTags: async () => undefined,
      upsertCrossReferences: async () => undefined,
      getCrossReferences: async () => []
    };

    expectTypeOf(store.upsertNodeTree).toBeFunction();
    expectTypeOf(store.deleteByNotePath).toBeFunction();
    expectTypeOf(store.getNode).toBeFunction();
    expectTypeOf(store.getChildren).toBeFunction();
    expectTypeOf(store.getAncestorChain).toBeFunction();
    expectTypeOf(store.getSiblings).toBeFunction();
    expectTypeOf(store.getNodesByNotePath).toBeFunction();
    expectTypeOf(store.searchSummaryEmbeddings).toBeFunction();
    expectTypeOf(store.searchContentEmbeddings).toBeFunction();
    expectTypeOf(store.upsertSummary).toBeFunction();
    expectTypeOf(store.getSummary).toBeFunction();
    expectTypeOf(store.upsertEmbedding).toBeFunction();
    expectTypeOf(store.upsertTags).toBeFunction();
    expectTypeOf(store.upsertCrossReferences).toBeFunction();
    expectTypeOf(store.getCrossReferences).toBeFunction();

    expect(store.upsertNodeTree(mockTree)).resolves.toBeUndefined();
    expect(store.getNode("node-1")).resolves.toBeNull();
    expect(store.getChildren("node-1")).resolves.toEqual([]);
    expect(store.searchSummaryEmbeddings(mockVector, 5)).resolves.toEqual([]);
    expect(store.upsertSummary("node-1", mockSummary)).resolves.toBeUndefined();
    expect(store.upsertEmbedding("node-1", "content", mockVector)).resolves.toBeUndefined();
    expect(store.upsertCrossReferences([])).resolves.toBeUndefined();
    expect(store.getCrossReferences("node-1")).resolves.toEqual([]);
  });

  it("D2 — searchContentEmbeddings accepts optional parentId", async () => {
    const mockVector: EmbeddingVector = { values: [0.1], dimensions: 1 };

    const store: HierarchicalStoreContract = {
      upsertNodeTree: async () => undefined,
      deleteByNotePath: async () => undefined,
      getNode: async () => null,
      getChildren: async () => [],
      getAncestorChain: async () => [],
      getSiblings: async () => [],
      getNodesByNotePath: async () => [],
      searchSummaryEmbeddings: async () => [],
      searchContentEmbeddings: async () => [],
      upsertSummary: async () => undefined,
      getSummary: async () => null,
      upsertEmbedding: async () => undefined,
      upsertTags: async () => undefined,
      upsertCrossReferences: async () => undefined,
      getCrossReferences: async () => []
    };

    const withoutParent = await store.searchContentEmbeddings(mockVector, 10);
    const withParent = await store.searchContentEmbeddings(mockVector, 10, "parent-node-1");

    expect(withoutParent).toEqual([]);
    expect(withParent).toEqual([]);
  });

  it("E1 — IndexingStage includes 'summarize'", () => {
    const stages: IndexingStage[] = ["queued", "crawl", "chunk", "summarize", "embed", "finalize"];
    expect(stages).toContain("summarize");
    expect(stages).toHaveLength(6);

    const summarizeStage: IndexingStage = "summarize";
    expectTypeOf(summarizeStage).toMatchTypeOf<IndexingStage>();
  });

  it("E2 — RuntimeServices includes optional hierarchicalStore", () => {
    expectTypeOf<RuntimeServices>().toHaveProperty("hierarchicalStore");

    const servicesWithStore = {} as RuntimeServices;
    expectTypeOf(servicesWithStore.hierarchicalStore).toEqualTypeOf<HierarchicalStoreContract | undefined>();
  });

  it("E3 — existing flat types remain unchanged and compile", () => {
    const chunkRef: ChunkReference = {
      notePath: "notes/example.md",
      noteTitle: "Example",
      headingTrail: ["Top"],
      tags: ["ai"]
    };

    const chunk: ChunkRecord = {
      id: "chunk-1",
      source: chunkRef,
      content: "Chunk body",
      hash: "abc123",
      updatedAt: Date.now()
    };

    const row: VectorStoreRow = {
      chunkId: "chunk-1",
      notePath: "notes/example.md",
      noteTitle: "Example",
      snippet: "Snippet text",
      tags: [],
      embedding: { values: [0.1], dimensions: 1 },
      updatedAt: Date.now()
    };

    const match: VectorStoreMatch = {
      ...row,
      score: 0.9
    };

    const contextChunk: ChatContextChunk = {
      chunkId: "chunk-1",
      notePath: "notes/example.md",
      snippet: "Snippet"
    };

    const searchResult: SearchResult = {
      chunkId: "chunk-1",
      score: 0.9,
      notePath: "notes/example.md",
      noteTitle: "Example",
      snippet: "Snippet text",
      tags: []
    };

    expectTypeOf<VectorStoreRepositoryContract>().toHaveProperty("replaceAllFromChunks");
    expectTypeOf<VectorStoreRepositoryContract>().toHaveProperty("upsertFromChunks");
    expectTypeOf<VectorStoreRepositoryContract>().toHaveProperty("deleteByNotePaths");
    expectTypeOf<VectorStoreRepositoryContract>().toHaveProperty("queryNearestNeighbors");

    expect(chunk.id).toBe("chunk-1");
    expect(match.score).toBe(0.9);
    expect(contextChunk.chunkId).toBe("chunk-1");
    expect(searchResult.notePath).toBe("notes/example.md");
  });
});
