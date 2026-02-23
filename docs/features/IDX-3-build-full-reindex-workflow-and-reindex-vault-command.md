# IDX-3: Build full reindex workflow and `Reindex vault` command

**Story**: Implement the first end-to-end full reindex pipeline so the `Reindex vault` command crawls scoped notes, chunks markdown, generates embeddings, and reports a real job result instead of placeholder behavior.
**Epic**: Epic 2 — Indexing and Metadata Pipeline
**Size**: Medium
**Status**: Done

---

## 1. Summary

This story turns `reindexVault()` from a scaffold into a production workflow for the current MVP stage: gather note inputs from the configured vault scope, produce deterministic chunks, embed chunk content, and return an accurate job snapshot that reflects work performed.

IDX-3 is the operational baseline for the rest of Epic 2. IDX-4 depends on this story to introduce incremental diffing, IDX-5 depends on it to persist/stream richer job progress, and IDX-6 depends on it to add consistency and recovery guardrails around the same execution path.

The key design constraint is deterministic orchestration with clear boundaries: `IndexingService` owns workflow sequencing and job reporting, while `vaultCrawler` and `chunker` remain pure/isolated utilities. This keeps later stories focused on diffing, persistence, and recovery without rewriting the core full-index path.

---

## 2. API Endpoints + Schemas

No external API endpoint changes are needed for this story.

This repository is an Obsidian plugin and does not use `shared/types.ts`; no new external schema surface is required in IDX-3.

No new exported domain type is required to deliver this story. Existing contracts remain sufficient:

```ts
export interface IndexingServiceContract extends RuntimeServiceLifecycle {
  reindexVault(): Promise<JobSnapshot>;
  indexChanges(): Promise<JobSnapshot>;
}
```

IDX-3 should keep the contract stable and focus on implementing `reindexVault()` behavior.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Obsidian command palette
└── Reindex vault command callback (main.ts)
    └── runIndexCommand("Reindex vault", "reindex-vault", ...)
        └── IndexingService.reindexVault()
            ├── crawlVaultMarkdownNotes(...)
            ├── chunkMarkdownNote(...) for each note
            ├── embeddingService.embed(...) for chunk content
            └── JobSnapshot (succeeded/failed + counts)
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `IndexingService.reindexVault` | `() => Promise<JobSnapshot>` | Internal disposed guard | Executes full scope crawl/chunk/embed workflow and returns final snapshot |
| `ObsidianAIPlugin.runIndexCommand` | `(commandName, jobType, runCommand) => Promise<void>` | Handles success/failure notices | Consumes returned snapshot and updates `ProgressSlideout` |
| `ProgressSlideout.setStatus` | `(snapshot: JobSnapshot) => void` | UI state only | Displays command label/detail based on real reindex result |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Command starts; progress shell is shown with reindex label while service runs |
| Error   | `runIndexCommand` normalizes error, marks slideout state `failed`, and shows user-facing notice |
| Empty   | Reindex succeeds with zero notes/chunks and a deterministic detail message indicating nothing was indexed |
| Success | Reindex succeeds with non-zero counts; slideout detail reflects notes/chunks processed |

No new frontend view is introduced in IDX-3; this story uses existing command + slideout surfaces.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/indexing.reindex.test.ts` | Focused unit tests for full reindex sequencing, batching behavior (if added), and success/empty snapshots |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/services/IndexingService.ts` | Replace placeholder-like behavior with complete full reindex orchestration and deterministic result detail |
| 2 | `src/main.ts` | Remove placeholder success notice for `Reindex vault`; show completion notice tied to real snapshot outcome |
| 3 | `src/__tests__/integration/plugin.runtime.test.ts` | Update command assertions to validate real `Reindex vault` behavior/notice text |
| 4 | `src/__tests__/harness/createMockAppHarness.ts` | Add simple helpers to seed mock vault markdown files for command integration tests |
| 5 | `src/__tests__/unit/services.runtime.test.ts` | Tighten `IndexingService` runtime assertions to validate full reindex execution details |

### Files UNCHANGED (confirm no modifications needed)

- `src/utils/chunker.ts` — chunk boundary/tag semantics were delivered in IDX-1 and should be consumed, not reworked
- `src/utils/vaultCrawler.ts` — include/exclude traversal logic was delivered in IDX-2 and should remain the source of note inputs
- `src/bootstrap/bootstrapRuntimeServices.ts` — existing dependency injection is already sufficient for IDX-3 scope

---

## 5. Acceptance Criteria Checklist

### Phase A: Full Reindex Pipeline

- [x] **A1** — Full reindex performs crawl -> chunk -> embed in one deterministic flow
  - `reindexVault()` obtains scoped notes via `crawlVaultMarkdownNotes(...)`.
  - Every crawled note is transformed via `chunkMarkdownNote(...)` before embedding.

- [x] **A2** — Embedding input is derived only from generated chunk content
  - `embeddingService.embed(...)` receives `inputs` equal to flattened chunk content for the run.
  - Provider/model values come from runtime settings snapshot (`embeddingProvider`, `embeddingModel`).

- [x] **A3** — Final `JobSnapshot` detail is accurate and verifiable
  - Success detail includes at minimum note count and chunk count produced by the run.
  - Empty scope returns a success snapshot with deterministic zero-count detail (not an error).

### Phase B: Command Surface Behavior

- [x] **B1** — `Reindex vault` command no longer reports placeholder completion text
  - Running `obsidian-ai:reindex-vault` produces a completion notice tied to actual indexing outcome.
  - `ProgressSlideout` receives the returned snapshot and reflects `succeeded` on success.

- [x] **B2** — `Index changes` command behavior remains explicitly unchanged in IDX-3
  - `obsidian-ai:index-changes` can continue current behavior pending IDX-4.
  - No regression is introduced to command registration IDs/names.

- [x] **B3** — Reindex failures preserve normalized error path
  - Any thrown error still flows through `normalizeRuntimeError(...)` in `runIndexCommand`.
  - Failed runs set slideout dataset state to `failed` and populate error detail.

### Phase C: Verification Coverage

- [x] **C1** — Unit tests cover full reindex success and empty-scope behavior
  - Tests verify note/chunk counts reflected in snapshot detail for non-empty input.
  - Tests verify deterministic zero-count success snapshot for empty scope.

- [x] **C2** — Integration tests verify command-level behavior
  - Plugin harness invokes `Reindex vault` command and asserts non-placeholder success notice.
  - Existing runtime command wiring tests remain green with updated expectations.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Large vault reindex can send very large embed input arrays in one call | Add deterministic batching in `IndexingService` if needed and validate with unit tests |
| 2 | Reindex command UX may diverge from still-placeholder index-changes UX | Keep explicit command-specific messaging and document IDX-4 dependency |
| 3 | Snapshot details can drift from actual workflow counts | Derive detail from measured runtime counters, not hardcoded strings |

---

## Implementation Order

1. `src/services/IndexingService.ts` — implement full reindex orchestration with explicit runtime counters and success/empty/failure snapshot detail (covers A1, A2, A3, B3).
2. `src/main.ts` — update `Reindex vault` success notice path to reflect real command completion rather than placeholder copy (covers B1, B2).
3. `src/__tests__/unit/indexing.reindex.test.ts` — add focused unit tests for full reindex sequencing and snapshot semantics (covers C1).
4. `src/__tests__/harness/createMockAppHarness.ts` and `src/__tests__/integration/plugin.runtime.test.ts` — seed mock vault data and assert command-level behavior in integration tests (covers C2, B1).
5. `src/__tests__/unit/services.runtime.test.ts` — align service runtime assertions with finalized IDX-3 behavior (covers C1, B3).
6. **Verify** — run `npm run test` and `npm run lint` after the reindex path is wired (covers Z2, Z3).
7. **Final verify** — run `npm run build` and manually trigger `Reindex vault` in a dev vault to confirm progress + notice behavior (covers Z1, Z4).

---

*Created: 2026-02-23 | Story: IDX-3 | Epic: Epic 2 — Indexing and Metadata Pipeline*
