import type {
  DocumentNode,
  NodeFilter,
  NoteMeta,
  ParsedCrossRef,
  ParsedTag,
  VectorMatch,
} from '@src/core/domain/types.js';
import type { IDocumentStore } from '@src/core/ports/IDocumentStore.js';

function seedNode(p: Partial<DocumentNode> & Pick<DocumentNode, 'id' | 'noteId'>): DocumentNode {
  return {
    parentId: null,
    type: 'note',
    headingTrail: [],
    depth: 0,
    siblingOrder: 0,
    content: '',
    contentHash: 'h',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...p,
  };
}

/** Test double for `SearchWorkflow` / `ChatWorkflow` port-driven tests. */
export class SearchTestStore implements IDocumentStore {
  callLog: string[] = [];
  summaryHits: VectorMatch[] = [{ nodeId: 'root', score: 0.1 }];
  contentHits: VectorMatch[] = [{ nodeId: 'leaf', score: 0.05 }];
  nodes = new Map<string, DocumentNode>();
  meta = new Map<string, NoteMeta>();
  lastContentFilter: NodeFilter | undefined;

  constructor() {
    this.nodes.set(
      'leaf',
      seedNode({
        id: 'leaf',
        noteId: 'n1',
        parentId: 'root',
        type: 'paragraph',
        depth: 1,
        headingTrail: ['Goals'],
        content: 'Launch beta by March',
      }),
    );
    this.nodes.set('root', seedNode({ id: 'root', noteId: 'n1', content: 'root' }));
    this.meta.set('n1', {
      noteId: 'n1',
      vaultPath: 'proj/plan.md',
      contentHash: 'x',
      indexedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 2,
    });
  }

  async upsertNodes(): Promise<void> {}
  async replaceNoteTags(_noteId: string, _tags: ParsedTag[]): Promise<void> {}
  async replaceNoteCrossRefs(_noteId: string, _refs: ParsedCrossRef[]): Promise<void> {}
  async getNodesByNote(): Promise<DocumentNode[]> {
    return [];
  }
  async getNodeById(id: string): Promise<DocumentNode | null> {
    return this.nodes.get(id) ?? null;
  }
  async deleteNote(): Promise<void> {}
  async upsertSummary(
    _nodeId: string,
    _summary: string,
    _model: string,
    _promptVersion: string,
  ): Promise<void> {}
  async getSummary(): Promise<null> {
    return null;
  }
  async getEmbeddingMeta(): Promise<null> {
    return null;
  }
  async upsertEmbedding(): Promise<void> {}

  async searchSummaryVectors(_q: Float32Array, _k: number): Promise<VectorMatch[]> {
    this.callLog.push('searchSummaryVectors');
    return this.summaryHits;
  }

  async searchContentVectors(
    _q: Float32Array,
    _k: number,
    filter?: NodeFilter,
  ): Promise<VectorMatch[]> {
    this.callLog.push('searchContentVectors');
    this.lastContentFilter = filter;
    return this.contentHits;
  }

  async getAncestors(): Promise<DocumentNode[]> {
    return [];
  }

  async getSiblings(): Promise<DocumentNode[]> {
    return [];
  }

  async getNoteMeta(noteId: string): Promise<NoteMeta | null> {
    return this.meta.get(noteId) ?? null;
  }

  async upsertNoteMeta(): Promise<void> {}

  async noteMatchesTagFilter(): Promise<boolean> {
    return true;
  }
}
