# WKF-1: `SummaryWorkflow` — bottom-up LLM summaries

**Story**: Implement **`SummaryWorkflow`** in `src/core/workflows/SummaryWorkflow.ts` that walks a note’s hierarchical tree **post-order** (leaves first), generates **LLM summaries for every non-leaf node** via **`IChatPort`**, persists them through **`IDocumentStore.upsertSummary`**, and **skips redundant chat calls** when stored summaries are **fresh** per [README §13 — Incremental summaries](../../README.md#13-incremental-summaries) and [ADR-008 §2](../../docs/decisions/ADR-008-idempotent-indexing-state-machine.md) (summarizing idempotency).
**Epic**: 4 — Index, summary, and embedding workflows
**Size**: Large
**Status**: Complete

---

## 1. Summary

Bottom-up summaries are the backbone of coarse retrieval ([README §5 — Bottom-up summaries](../../README.md#5-bottom-up-summaries), [ADR-002](../decisions/ADR-002-hierarchical-document-model.md)): parent nodes must summarize their **children’s summaries** (or leaf **content** where no child summary exists), not ad-hoc truncation of the whole note. This story implements that orchestration **entirely behind ports** so provider adapters ([ADR-005](../decisions/ADR-005-provider-abstraction.md)) remain swappable.

**Leaf behavior:** Nodes with no children (e.g. `paragraph`, `sentence_part`, `bullet` leaves) do **not** get a row in `summaries`; their **content** is the input to the parent’s summarization prompt.

**Staleness:** After a re-parse, any node whose `contentHash` or `updatedAt` changed may invalidate summaries **up the ancestor chain** ([README §13](../../README.md#13-incremental-summaries)). The workflow must treat a non-leaf as **dirty** if any **descendant** in the in-memory tree was **new or changed** compared to the previous index pass, or if no stored summary exists. A practical rule Implementer may use: build the set of node ids present in the **new** `ChunkNoteResult`; for each non-leaf, if **any descendant id** in the subtree is not in the “reused unchanged” set (or subtree contains a node whose hash differs from a prior read — when prior state unavailable, regenerate conservatively), regenerate that non-leaf. **Minimum bar for MVP tests:** if **only** leaf content under a parent changes, that parent and **all ancestors up to the note root** receive new LLM summaries; unchanged branches do not.

**Skip path:** When a non-leaf already has a `summaries` row and **`generated_at` ≥ that node’s `updated_at`** in `nodes` (string compare on ISO timestamps from the store), and the node is not marked dirty by the rule above, **do not** call `IChatPort.complete` for that node (emit optional debug log only).

**Dependencies:** [CHK-1](CHK-1.md)–[CHK-5](CHK-5.md) (chunker), [STO-3](STO-3.md) (store), [FND-3](FND-3.md) (ports). Does **not** wire the sidecar HTTP router (SRV-\*); [WKF-2](WKF-2.md) will invoke this workflow from the indexing state machine.

Pointers: [docs/requirements/REQUIREMENTS.md](../requirements/REQUIREMENTS.md) §5 (summaries and embeddings); [IChatPort](../../src/core/ports/IChatPort.ts); [IDocumentStore](../../src/core/ports/IDocumentStore.ts).

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                  | Why it binds this story                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [ADR-002](../decisions/ADR-002-hierarchical-document-model.md)       | Tree shape, node types, parent/child semantics for traversal order.           |
| [ADR-005](../decisions/ADR-005-provider-abstraction.md)              | Summaries must use `IChatPort` only; no direct OpenAI/Ollama imports in core. |
| [ADR-008](../decisions/ADR-008-idempotent-indexing-state-machine.md) | Summarizing step skip rules tied to content hash / stored artifacts.          |
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md)              | Core stays free of Obsidian/SQLite; workflow is portable under `src/core/`.   |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration/contract test, or script) where wrong-stack substitution is a risk

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `SummaryWorkflow` and any helper modules it adds under `src/core/workflows/` or `src/core/domain/` for summary logic must **not** import `better-sqlite3`, `obsidian`, `electron`, or `src/sidecar/**` (FND-3 hexagonal boundary).
2. **Y2** — All model calls go through **`IChatPort.complete`**; streaming deltas are consumed until completion before persisting the final summary string.
3. **Y3** — **`apiKey`** is passed through to `IChatPort.complete` as an optional argument (plugin forwards per request); the workflow does not read SecretStorage.
4. **Y4** — Prompt assembly uses **children’s text**: for each child, use **stored summary** if the child is non-leaf and has a summary row **else** child **`content`** (leaf body). Heading trail / node type may be included for structure (Implementer documents prompt shape in code comment).
5. **Y5** — **Non-leaf** is defined as any node with **one or more children** in the parsed tree for the note (by `parentId` links in `DocumentNode[]`).
6. **Y6** — Staleness / skip rules must align with README §13 and ADR-008 §2; **never** skip when the target non-leaf is dirty per section 1 summary rules.

---

## 5. API Endpoints + Schemas

No HTTP routes. Extend the **storage port** so the workflow can read summary rows and embedding metadata for idempotency (used again by [WKF-3](WKF-3.md) / [WKF-2](WKF-2.md)).

Add to [`src/core/ports/IDocumentStore.ts`](../../src/core/ports/IDocumentStore.ts) (names may be aliased but semantics required):

- `getSummary(nodeId: string): Promise<StoredSummary | null>`
- `getEmbeddingMeta(nodeId: string, vectorType: VectorType): Promise<EmbedMeta | null>`

Add to [`src/core/domain/types.ts`](../../src/core/domain/types.ts):

```ts
/** Row shape for `summaries` (read path for WKF-1 / WKF-3). */
export interface StoredSummary {
  summary: string;
  generatedAt: string;
  model: string | null;
}
```

Implement both methods on [`SqliteDocumentStore`](../../src/sidecar/adapters/SqliteDocumentStore.ts) with SQL mapping (`generated_at` ↔ `generatedAt`, etc.).

**SummaryWorkflow** public surface (Implementer may use a class or factory):

```ts
export interface SummaryWorkflowInput {
  noteId: string;
  vaultPath: string;
  noteTitle: string;
  markdown: string;
  /** From settings / STO-2 dimension — forwarded into prompts only if needed for logging; embed dimension enforced in WKF-2. */
  maxEmbeddingTokens?: number;
  chatModelLabel: string;
  apiKey?: string;
}

export interface SummaryWorkflowDeps {
  chat: IChatPort;
  store: IDocumentStore;
}

// Example: summarizeNote(deps, input): Promise<void>
```

---

## 6. Frontend Flow

Not applicable (core workflow only; UI consumes progress via WKF-2 + SRV-/PLG- stories).

### 6a. Component / Data Hierarchy

Not applicable.

### 6b. Props & Contracts

Not applicable.

### 6c. States (Loading / Error / Empty / Success)

Not applicable.

---

## 7. File Touchpoints

### Files to CREATE

| #   | Path                                           | Purpose                                                                         |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | `src/core/workflows/SummaryWorkflow.ts`        | Post-order traversal, skip logic, `IChatPort` + `IDocumentStore` orchestration. |
| 2   | `tests/core/workflows/SummaryWorkflow.test.ts` | Unit tests with fake chat + in-memory store (or typed fakes).                   |

### Files to MODIFY

| #   | Path                                                 | Change                                |
| --- | ---------------------------------------------------- | ------------------------------------- |
| 1   | `src/core/domain/types.ts`                           | Add `StoredSummary`.                  |
| 2   | `src/core/ports/IDocumentStore.ts`                   | Add `getSummary`, `getEmbeddingMeta`. |
| 3   | `src/sidecar/adapters/SqliteDocumentStore.ts`        | Implement new read methods.           |
| 4   | `tests/sidecar/adapters/SqliteDocumentStore.test.ts` | Cover read methods + column mapping.  |
| 5   | `src/core/ports/index.ts`                            | Re-export if applicable.              |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/ports/IChatPort.ts` — contract already sufficient.
- `src/sidecar/adapters/JobStepService.ts` — summarizing **step transitions** belong in WKF-2.

---

## 8. Acceptance Criteria Checklist

### Phase A: Port extensions

- [x] **A1** — `IDocumentStore.getSummary` returns `null` when no row exists, otherwise `{ summary, generatedAt, model }` with ISO-like timestamps consistent with SQLite `datetime('now')` / existing `upsertSummary` writes.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.test.ts::A1_getSummary_roundtrip(vitest)`
- [x] **A2** — `IDocumentStore.getEmbeddingMeta` returns `null` when no `embedding_meta` row exists for the `(nodeId, vectorType)` pair; otherwise returns `EmbedMeta` fields including `contentHash`.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.test.ts::A2_get_embedding_meta(vitest)`

### Phase B: Traversal and prompts

- [x] **B1** — For a synthetic tree (note → two paragraph leaves), `SummaryWorkflow` calls `IChatPort.complete` **exactly once** for the parent non-leaf and **never** for leaves; the persisted summary is passed to `upsertSummary` with the correct `nodeId` and non-empty string.
  - Evidence: `tests/core/workflows/SummaryWorkflow.test.ts::B1_single_parent_two_leaves(vitest)`
- [x] **B2** — Post-order: for a depth-3 chain (root topic → subtopic → paragraph), the **deepest** non-leaf is summarized **before** its parent (verify call order via fake that records sequence).
  - Evidence: `tests/core/workflows/SummaryWorkflow.test.ts::B2_post_order_depth_chain(vitest)`

### Phase C: Skip / staleness

- [x] **C1** — When a non-leaf already has `summaries.generated_at` ≥ `nodes.updated_at` and no dirty marking applies, **zero** `IChatPort.complete` invocations occur for that node (skipped).
  - Evidence: `tests/core/workflows/SummaryWorkflow.test.ts::C1_skip_fresh_summary(vitest)`
- [x] **C2** — When a leaf’s `content` changes (new hash / updated row), the workflow regenerates summaries for **that leaf’s parent and every ancestor** up to the note root (at least one chat call per affected non-leaf).
  - Evidence: `tests/core/workflows/SummaryWorkflow.test.ts::C2_propagate_after_leaf_change(vitest)`

### Phase Y: Binding & stack compliance

- [x] **Y1** — **(binding)** No forbidden imports under `src/core/workflows/` (no `better-sqlite3`, `obsidian`, `electron`, or path into `src/sidecar/`).
  - Verification: `rg` from repo root with negative pattern returns no matches in `src/core/workflows/`.
  - Evidence: `npm run verify:core-imports` (uses `scripts/check-core-imports.mjs` over `src/core/**`)
- [x] **Y2** — **(binding)** `SummaryWorkflow` source never imports from `openai`, `@anthropic-ai/sdk`, or `ollama` packages.
  - Evidence: `package.json` does not add those deps to `src/core` path; `rg '^import.*openai' src/core/workflows` returns empty.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths) — N/A if no shared package change; if `packages/shared` is touched, enforce alias
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 9. Risks & Tradeoffs

| #   | Risk / Tradeoff                                               | Mitigation                                                                                                                 |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Large fan-out nodes exceed chat context limits                | Truncate or chunk child summaries in prompt with explicit ordering; document limit behavior; unit test with many children. |
| 2   | ISO timestamp comparison edge cases                           | Use consistent UTC from store; document compare strategy; prefer numeric unix in future if issues arise.                   |
| 3   | Duplicate work between WKF-1 skip logic and WKF-3 incremental | Keep skip rules in one shared pure helper if duplication appears; WKF-3 may import same helper from `src/core/domain/`.    |

---

## Implementation Order

1. `src/core/domain/types.ts` — add `StoredSummary` (covers A1).
2. `src/core/ports/IDocumentStore.ts` — add read methods (covers A1–A2).
3. `src/sidecar/adapters/SqliteDocumentStore.ts` + `tests/sidecar/adapters/SqliteDocumentStore.test.ts` — implement reads (covers A1–A2).
4. `src/core/workflows/SummaryWorkflow.ts` — traversal + prompts + skip (covers B\*, C\*).
5. `tests/core/workflows/SummaryWorkflow.test.ts` — fakes + assertions (covers B\*, C\*).
6. Add or reuse `verify:core-imports` script (covers Y1).
7. **Final verify** — `npm run build`, `npm run lint`, `npm test` (or workspace equivalent).

---

_Created: 2026-04-05 | Story: WKF-1 | Epic: 4 — Index, summary, and embedding workflows_
