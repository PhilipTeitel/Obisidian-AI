# SUM-1: Implement SummaryService with bottom-up generation

**Story**: Implement `SummaryService` in `src/services/SummaryService.ts` that traverses a document tree bottom-up, generating LLM summaries for non-leaf nodes and skipping short leaf nodes, storing results via `HierarchicalStoreContract`.
**Epic**: Epic 13 — LLM Summary Generation Service
**Size**: Large
**Status**: Complete

---

## 1. Summary

This story delivers the core summary generation pipeline described in requirement R2 of the hierarchical indexing specification. The `SummaryService` traverses a `DocumentTree` bottom-up, generating concise LLM summaries at every non-leaf level of the document hierarchy. Short leaf nodes (below ~200 tokens) use their content as-is without an LLM call. Long leaf content and all non-leaf nodes (bullet_group, subtopic, topic, note) receive LLM-generated summaries.

The service uses the user's configured **chat provider** (via `ProviderRegistryContract`) with `max_tokens` capped at ~100 tokens per summary call. The prompt instructs the LLM to faithfully represent content without editorializing, preserving key terms, entities, and relationships. Each summary is stored as a `SummaryRecord` in the `HierarchicalStoreContract` with provenance metadata (`modelUsed`, `promptVersion`, `generatedAt`).

The service follows the project's dependency injection pattern with a `SummaryServiceDeps` interface, `RuntimeServiceLifecycle` implementation, and structured logging for all summary generation events (`summary.generate.started`, `summary.generate.completed`, `summary.generate.skipped`).

Key design decisions:
- **Bottom-up traversal**: Leaf nodes are processed first, then their parents use child summaries as input, up to the note root.
- **Short leaf skip threshold**: Leaf nodes with content below ~200 estimated tokens skip LLM generation; their content IS the summary.
- **Prompt versioning**: A `SUMMARY_PROMPT_VERSION` constant enables staleness detection when prompts change.
- **Error resilience**: Individual node summary failures are logged and skipped rather than failing the entire tree.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed. This is an Obsidian plugin with internal service interfaces only.

The `SummaryService` class signature:

```ts
import type {
  ChatProvider,
  ChatStreamEvent,
  DocumentNode,
  DocumentTree,
  HierarchicalStoreContract,
  ObsidianAISettings,
  ProviderRegistryContract,
  RuntimeServiceLifecycle,
  SummaryRecord
} from "../types";

export const SUMMARY_PROMPT_VERSION = "v1";
export const SHORT_LEAF_TOKEN_THRESHOLD = 200;
export const SUMMARY_MAX_TOKENS_DEFAULT = 100;

export interface SummaryServiceDeps {
  providerRegistry: ProviderRegistryContract;
  hierarchicalStore: HierarchicalStoreContract;
  getSettings: () => ObsidianAISettings;
}

export interface SummaryGenerationResult {
  nodeId: string;
  skipped: boolean;
  error?: string;
}

export class SummaryService implements RuntimeServiceLifecycle {
  constructor(deps: SummaryServiceDeps);
  init(): Promise<void>;
  dispose(): Promise<void>;
  generateSummaries(tree: DocumentTree): Promise<SummaryGenerationResult[]>;
  regenerateFromNode(nodeId: string): Promise<SummaryGenerationResult[]>;
}
```

The `generateSummaries` method processes an entire tree bottom-up. The `regenerateFromNode` method regenerates summaries from a specific changed node up through all ancestors to the root (used by SUM-2 for incremental updates).

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

No frontend components are created or modified in this story. The service is consumed by the indexing pipeline:

```
src/services/SummaryService.ts (new)
├── INTG-2: IndexingService calls generateSummaries() after chunking
├── SUM-2: regenerateFromNode() used for incremental summary propagation
├── SUM-3: Progress events emitted during summary generation
└── Uses:
    ├── ProviderRegistryContract.getChatProvider() for LLM calls
    ├── HierarchicalStoreContract.upsertSummary() for persistence
    ├── HierarchicalStoreContract.getNode() for tree traversal
    ├── HierarchicalStoreContract.getChildren() for child lookup
    ├── HierarchicalStoreContract.getAncestorChain() for propagation
    └── estimateTokens() from tokenEstimator for threshold checks
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `SummaryService` | `SummaryServiceDeps` | `disposed` flag | Implements `RuntimeServiceLifecycle` |
| `generateSummaries` | `(tree: DocumentTree) => Promise<SummaryGenerationResult[]>` | Stateless per call | Bottom-up traversal of full tree |
| `regenerateFromNode` | `(nodeId: string) => Promise<SummaryGenerationResult[]>` | Stateless per call | Propagates from node to root |
| `SummaryGenerationResult` | `{ nodeId, skipped, error? }` | N/A | Per-node outcome for caller tracking |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Not applicable — service is consumed by IndexingService |
| Error   | Individual node failures logged and skipped; caller receives `SummaryGenerationResult` with `error` field |
| Empty   | Empty tree (root only, no children) returns empty results array |
| Success | All non-leaf nodes have summaries stored in `HierarchicalStoreContract` |

No frontend work is required for this story.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/services/SummaryService.ts` | Bottom-up LLM summary generation service |
| 2 | `src/__tests__/unit/summaryService.test.ts` | Unit tests for all acceptance criteria |

### Files to MODIFY

None. The service is standalone; wiring into bootstrap happens in INTG-1.

### Files UNCHANGED (confirm no modifications needed)

- `src/types.ts` — `SummaryRecord`, `DocumentTree`, `HierarchicalStoreContract` already defined by HIER-1
- `src/bootstrap/bootstrapRuntimeServices.ts` — wiring happens in INTG-1
- `src/services/IndexingService.ts` — integration happens in INTG-2
- `src/settings.ts` — `summaryMaxTokens` setting added in INTG-4
- `src/ui/ProgressSlideout.ts` — progress events added in SUM-3
- `src/utils/tokenEstimator.ts` — consumed as-is from HIER-4

---

## 5. Acceptance Criteria Checklist

### Phase A: Service Structure and Lifecycle

- [x] **A1** — `SummaryService` class exists and implements `RuntimeServiceLifecycle`
  - The class is exported from `src/services/SummaryService.ts`.
  - It has `init()` and `dispose()` methods.
  - After `dispose()`, calling `generateSummaries` throws an error.
  - Evidence: `src/__tests__/unit/summaryService.test.ts::A1_lifecycle_init_dispose(vitest)`

- [x] **A2** — `SummaryService` accepts `SummaryServiceDeps` via constructor
  - Dependencies include `providerRegistry`, `hierarchicalStore`, and `getSettings`.
  - Evidence: `src/__tests__/unit/summaryService.test.ts::A2_constructor_deps(vitest)`

### Phase B: Bottom-Up Tree Traversal

- [x] **B1** — `generateSummaries` processes leaf nodes before their parents
  - For a tree with note → topic → paragraph structure, paragraphs are processed first, then topics, then the note root.
  - Evidence: `src/__tests__/unit/summaryService.test.ts::B1_bottom_up_traversal_order(vitest)`

- [x] **B2** — Short leaf nodes (below ~200 tokens) are skipped with content as summary
  - A paragraph node with content under 200 estimated tokens has its content stored directly as the summary without an LLM call.
  - The `SummaryGenerationResult` for this node has `skipped: true`.
  - Evidence: `src/__tests__/unit/summaryService.test.ts::B2_short_leaf_skip(vitest)`

- [x] **B3** — Long leaf nodes (above ~200 tokens) receive LLM-generated summaries
  - A paragraph node with content exceeding 200 estimated tokens triggers an LLM call.
  - The generated summary is stored via `upsertSummary`.
  - Evidence: `src/__tests__/unit/summaryService.test.ts::B3_long_leaf_llm_summary(vitest)`

- [x] **B4** — Non-leaf nodes receive LLM summaries from child summaries
  - A topic node's summary is generated from the concatenated summaries of its children.
  - The LLM prompt includes all child summaries as input context.
  - Evidence: `src/__tests__/unit/summaryService.test.ts::B4_non_leaf_from_child_summaries(vitest)`

### Phase C: LLM Integration

- [x] **C1** — Summary generation uses the configured chat provider
  - The service calls `providerRegistry.getChatProvider()` to obtain the active chat provider.
  - The chat model is read from `getSettings().chatModel`.
  - Evidence: `src/__tests__/unit/summaryService.test.ts::C1_uses_chat_provider(vitest)`

- [x] **C2** — Summary prompt instructs faithful representation without editorializing
  - The system message instructs the LLM to produce a concise 1-2 sentence summary preserving key terms, entities, and relationships.
  - Evidence: `src/__tests__/unit/summaryService.test.ts::C2_summary_prompt_content(vitest)`

- [x] **C3** — LLM response tokens are collected into a complete summary string
  - The service consumes the `AsyncIterable<ChatStreamEvent>` from the chat provider, collecting all `token` events into a single summary string.
  - Evidence: `src/__tests__/unit/summaryService.test.ts::C3_token_collection(vitest)`

### Phase D: Summary Persistence

- [x] **D1** — Generated summaries are stored via `upsertSummary` with provenance metadata
  - Each `SummaryRecord` includes `nodeId`, `summary`, `modelUsed` (from settings), `promptVersion` (constant), and `generatedAt` (timestamp).
  - Evidence: `src/__tests__/unit/summaryService.test.ts::D1_upsert_summary_provenance(vitest)`

- [x] **D2** — Skipped leaf nodes also have their content stored as summary
  - Short leaf nodes that skip LLM generation still have a `SummaryRecord` persisted with their content as the `summary` field.
  - Evidence: `src/__tests__/unit/summaryService.test.ts::D2_skipped_leaf_persisted(vitest)`

### Phase E: Error Handling

- [x] **E1** — Individual node summary failures are logged and skipped
  - If the LLM call fails for a single node, the error is logged, the node's `SummaryGenerationResult` includes the `error` field, and processing continues with remaining nodes.
  - Evidence: `src/__tests__/unit/summaryService.test.ts::E1_individual_node_failure_skipped(vitest)`

- [x] **E2** — Disposed service throws on `generateSummaries`
  - After calling `dispose()`, `generateSummaries` throws `"SummaryService is disposed."`.
  - Evidence: `src/__tests__/unit/summaryService.test.ts::E2_disposed_throws(vitest)`

### Phase F: Structured Logging

- [x] **F1** — Summary generation emits `summary.generate.started` event
  - Logged at `info` level when summary generation begins for a tree, including node count.
  - Evidence: `src/__tests__/unit/summaryService.test.ts::F1_started_event(vitest)`

- [x] **F2** — Each node emits `summary.generate.completed` or `summary.generate.skipped` event
  - Completed nodes log at `debug` level with `nodeId`, `nodeType`, and summary length.
  - Skipped nodes log at `debug` level with `nodeId` and reason.
  - Evidence: `src/__tests__/unit/summaryService.test.ts::F2_per_node_events(vitest)`

- [x] **F3** — Summary generation emits completion event with total counts
  - Logged at `info` level with total nodes processed, skipped count, error count, and elapsed time.
  - Evidence: `src/__tests__/unit/summaryService.test.ts::F3_completion_event(vitest)`

### Phase G: `regenerateFromNode` (Propagation Path)

- [x] **G1** — `regenerateFromNode` regenerates from the specified node up to root
  - Given a changed paragraph node, the method regenerates summaries for that node, its parent topic, and the note root.
  - Evidence: `src/__tests__/unit/summaryService.test.ts::G1_propagation_to_root(vitest)`

- [x] **G2** — `regenerateFromNode` uses stored children summaries for ancestor nodes
  - When regenerating a topic node's summary, it reads existing child summaries from the store (not re-generating them).
  - Evidence: `src/__tests__/unit/summaryService.test.ts::G2_uses_stored_child_summaries(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All existing tests continue to pass (`npm run test`)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | LLM summary calls add latency and cost to the indexing pipeline | Short leaf nodes skip LLM calls; `max_tokens` is capped at ~100 per call; summary generation is a separate phase that can be monitored |
| 2 | Chat provider streaming interface requires collecting tokens into a string | Simple accumulation pattern; error handling wraps the async iterable |
| 3 | Individual node failures could leave partial summary trees | Failures are logged and skipped; parent nodes that depend on failed children use available summaries only |
| 4 | Prompt version changes require full summary regeneration | `promptVersion` field in `SummaryRecord` enables staleness detection; regeneration is triggered by comparing stored vs current version |
| 5 | Bottom-up traversal order must be correct for parent summaries to use child summaries | Traversal uses topological sort by depth (deepest first); tests verify ordering |

---

## Implementation Order

1. `src/services/SummaryService.ts` — Create class skeleton with constructor, `init()`, `dispose()`, deps interface, and constants (covers A1, A2)
2. `src/services/SummaryService.ts` — Implement bottom-up tree traversal with depth-sorted node processing (covers B1)
3. `src/services/SummaryService.ts` — Implement short leaf skip logic using `estimateTokens` (covers B2)
4. `src/services/SummaryService.ts` — Implement LLM summary generation via chat provider with prompt and token collection (covers B3, B4, C1, C2, C3)
5. `src/services/SummaryService.ts` — Implement `upsertSummary` persistence with provenance metadata (covers D1, D2)
6. `src/services/SummaryService.ts` — Implement error handling for individual node failures (covers E1, E2)
7. `src/services/SummaryService.ts` — Add structured logging for all summary events (covers F1, F2, F3)
8. `src/services/SummaryService.ts` — Implement `regenerateFromNode` with ancestor chain propagation (covers G1, G2)
9. **Verify** — `npm run typecheck && npm run build` to confirm compilation
10. `src/__tests__/unit/summaryService.test.ts` — Write comprehensive tests for all acceptance criteria (covers A1–G2)
11. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z4)

---

*Created: 2026-03-22 | Story: SUM-1 | Epic: Epic 13 — LLM Summary Generation Service*
