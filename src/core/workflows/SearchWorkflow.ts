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

/** Default Phase-1 summary ANN limit (ADR-012, RET-4). */
export const DEFAULT_COARSE_K = 32;

const COARSE_K_MIN = 1;
const COARSE_K_MAX = 256;

export function clampCoarseK(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_COARSE_K;
  const n = Math.floor(raw);
  if (!Number.isFinite(n)) return DEFAULT_COARSE_K;
  return Math.min(COARSE_K_MAX, Math.max(COARSE_K_MIN, n));
}

export function fallbackFloorForCoarseK(coarseK: number): number {
  return Math.max(4, Math.floor(coarseK / 4));
}

/**
 * Maps final result cap `k` to ANN limits. `kSummary` is the configurable coarse-K (RET-4), not `min(k, 8)`.
 */
export function mapSearchK(k: number, coarseK: number): { kSummary: number; kContent: number } {
  return {
    kSummary: coarseK,
    kContent: k,
  };
}

export interface SearchWorkflowDeps {
  store: IDocumentStore;
  embedder: IEmbeddingPort;
  log?: { debug: (obj: Record<string, unknown>, msg?: string) => void };
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

function mergeHitsByNode(a: VectorMatch[], b: VectorMatch[]): Map<string, number> {
  const byNode = new Map<string, number>();
  for (const h of a) {
    const prev = byNode.get(h.nodeId);
    if (prev === undefined || h.score < prev) {
      byNode.set(h.nodeId, h.score);
    }
  }
  for (const h of b) {
    const prev = byNode.get(h.nodeId);
    if (prev === undefined || h.score < prev) {
      byNode.set(h.nodeId, h.score);
    }
  }
  return byNode;
}

/**
 * Three-phase semantic search (ADR-003): summary ANN → content ANN within subtrees → assembly;
 * optional unrestricted content ANN when Phase 1 under-delivers (RET-4 / ADR-012).
 */
export async function runSearch(
  deps: SearchWorkflowDeps,
  req: SearchRequest,
  assembly?: SearchAssemblyOptions,
): Promise<SearchResponse> {
  void req.enableHybridSearch;

  const resolvedAssembly = resolveAssembly(assembly ?? req.search);
  const coarseK = clampCoarseK(req.coarseK);
  const k = req.k ?? DEFAULT_SEARCH_K;
  const { kSummary, kContent } = mapSearchK(k, coarseK);
  const queryText = req.query.trim();
  if (!queryText) {
    return { results: [] };
  }

  const [qVec] = await deps.embedder.embed([queryText], req.apiKey);
  const summaryHits = await deps.store.searchSummaryVectors(qVec, kSummary);

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

  const floor = fallbackFloorForCoarseK(coarseK);
  const fallbackFired = coarseHits.length < floor;

  let phase2Hits: VectorMatch[] = [];
  if (coarseHits.length > 0) {
    const roots = coarseHits.map((h: VectorMatch) => h.nodeId);
    const contentFilter: NodeFilter = { subtreeRootNodeIds: roots };
    if (req.tags?.length) {
      contentFilter.tagsAny = req.tags;
    }
    phase2Hits = await deps.store.searchContentVectors(qVec, kContent, contentFilter);
  }

  let fallbackHits: VectorMatch[] = [];
  if (fallbackFired) {
    const fbFilter: NodeFilter = {};
    if (req.tags?.length) {
      fbFilter.tagsAny = req.tags;
    }
    fallbackHits = await deps.store.searchContentVectors(qVec, coarseK, fbFilter);
  }

  const byNode = mergeHitsByNode(phase2Hits, fallbackHits);

  deps.log?.debug(
    {
      coarseK,
      fallback_fired: fallbackFired,
      merged_candidates: byNode.size,
    },
    'searchworkflow.retrieval',
  );

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
