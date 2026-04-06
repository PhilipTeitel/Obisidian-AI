import {
  assembleSearchSnippet,
  DEFAULT_SEARCH_ASSEMBLY,
  validateSearchAssemblyOptions,
} from '../domain/contextAssembly.js';
import type {
  DocumentNode,
  NodeFilter,
  SearchAssemblyOptions,
  SearchRequest,
  SearchResponse,
  SearchResult,
  VectorMatch,
} from '../domain/types.js';
import type { IDocumentStore } from '../ports/IDocumentStore.js';
import type { IEmbeddingPort } from '../ports/IEmbeddingPort.js';

/** When `SearchRequest.k` is omitted (sidecar maps settings later). */
export const DEFAULT_SEARCH_K = 20;

/**
 * Maps final result cap `k` to ANN limits. Tested in `tests/core/workflows/SearchWorkflow.test.ts`.
 * Summary search uses a smaller top-K to bound coarse candidates; content uses full `k`.
 */
export function mapSearchK(k: number): { kSummary: number; kContent: number } {
  return {
    kSummary: Math.min(k, 8),
    kContent: k,
  };
}

export interface SearchWorkflowDeps {
  store: IDocumentStore;
  embedder: IEmbeddingPort;
}

function resolveAssembly(assembly?: SearchAssemblyOptions): SearchAssemblyOptions {
  const opts = assembly ?? DEFAULT_SEARCH_ASSEMBLY;
  validateSearchAssemblyOptions(opts);
  return opts;
}

async function buildSnippet(
  store: IDocumentStore,
  node: DocumentNode,
  vaultPath: string,
  assembly: SearchAssemblyOptions,
): Promise<string> {
  const siblings = await store.getSiblings(node.id);
  const siblingText = siblings.map((s) => s.content).join('\n');

  const ancestors = await store.getAncestors(node.id);
  const parentSummaries: string[] = [];
  for (const a of ancestors) {
    const sum = await store.getSummary(a.id);
    if (sum?.summary) parentSummaries.push(sum.summary);
  }

  return assembleSearchSnippet({
    vaultPath,
    headingTrail: node.headingTrail,
    matchedText: node.content,
    siblingText,
    parentSummaryText: parentSummaries.join('\n\n'),
    assembly,
  });
}

/**
 * Three-phase semantic search (ADR-003): summary ANN → content ANN within subtrees → assembly.
 */
export async function runSearch(
  deps: SearchWorkflowDeps,
  req: SearchRequest,
  assembly?: SearchAssemblyOptions,
): Promise<SearchResponse> {
  const resolvedAssembly = resolveAssembly(assembly);
  const k = req.k ?? DEFAULT_SEARCH_K;
  const { kSummary, kContent } = mapSearchK(k);
  const queryText = req.query.trim();
  if (!queryText) {
    return { results: [] };
  }

  const [qVec] = await deps.embedder.embed([queryText], req.apiKey);
  const summaryHits = await deps.store.searchSummaryVectors(qVec, kSummary);
  if (summaryHits.length === 0) {
    return { results: [] };
  }

  // RET-3: drop coarse regions whose note has no matching tag (tags often live on leaves).
  let coarseHits = summaryHits;
  if (req.tags?.length) {
    const kept: VectorMatch[] = [];
    for (const h of summaryHits) {
      const n = await deps.store.getNodeById(h.nodeId);
      if (!n) continue;
      if (await deps.store.noteMatchesTagFilter(n.noteId, req.tags)) {
        kept.push(h);
      }
    }
    coarseHits = kept;
  }
  if (coarseHits.length === 0) {
    return { results: [] };
  }

  const roots = coarseHits.map((h: VectorMatch) => h.nodeId);
  const contentFilter: NodeFilter = { subtreeRootNodeIds: roots };
  if (req.tags?.length) {
    contentFilter.tagsAny = req.tags;
  }
  const contentHits = await deps.store.searchContentVectors(qVec, kContent, contentFilter);

  const byNode = new Map<string, number>();
  for (const h of contentHits) {
    const prev = byNode.get(h.nodeId);
    if (prev === undefined || h.score < prev) {
      byNode.set(h.nodeId, h.score);
    }
  }
  const ranked = [...byNode.entries()]
    .map(([nodeId, score]) => ({ nodeId, score }))
    .sort((a, b) => a.score - b.score)
    .slice(0, k);

  const results: SearchResult[] = [];
  for (const { nodeId, score } of ranked) {
    const node = await deps.store.getNodeById(nodeId);
    if (!node) {
      console.warn('[SearchWorkflow] missing node for hit', { nodeId });
      continue;
    }
    const meta = await deps.store.getNoteMeta(node.noteId);
    if (!meta) {
      console.warn('[SearchWorkflow] missing note_meta', { noteId: node.noteId });
      continue;
    }
    const snippet = await buildSnippet(deps.store, node, meta.vaultPath, resolvedAssembly);
    results.push({
      nodeId,
      notePath: meta.vaultPath,
      score,
      snippet,
      headingTrail: node.headingTrail,
    });
  }

  return { results };
}
