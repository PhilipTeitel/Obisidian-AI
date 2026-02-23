# IDX-4: Build incremental index workflow and `Index changes` command

**Story**: Implement hash-based incremental indexing so `Index changes` processes only created/updated/deleted notes and reports precise change counts.
**Epic**: Epic 2 — Indexing and Metadata Pipeline
**Size**: Large
**Status**: Done

---

## 1. Summary

This story introduces the first real incremental indexing path. Instead of re-embedding every note on each run, `indexChanges()` compares current vault content against persisted fingerprints, computes a change plan, and executes only the required work for created/updated/deleted content.

IDX-4 depends on IDX-3's full reindex pipeline and establishes the performance-critical behavior expected for day-to-day usage. It also creates durable indexing metadata needed by IDX-5 (progress state persistence) and IDX-6 (consistency/recovery checks).

The design principle is deterministic diffing with explicit persistence boundaries: note fingerprints must be stable across runs, change classification must be reproducible, and persisted manifest reads/writes must be versioned so future schema evolution is safe.

---

## 2. API Endpoints + Schemas

No external API endpoint changes are needed for this story.

This repository is an Obsidian plugin and does not use `shared/types.ts`; IDX-4 type additions should be defined in `src/types.ts`.

The following NEW interfaces should be added to model incremental diff state:

```ts
export interface IndexedNoteFingerprint {
  notePath: string;
  noteHash: string; // stable hash of normalized markdown note content
  updatedAt: number;
}

export interface IndexManifest {
  version: 1;
  updatedAt: number;
  notes: IndexedNoteFingerprint[];
}

export interface IncrementalDiffResult {
  created: IndexedNoteFingerprint[];
  updated: IndexedNoteFingerprint[];
  unchanged: IndexedNoteFingerprint[];
  deleted: IndexedNoteFingerprint[];
}
```

If `IndexManifest` is stored in plugin data, writes must be namespaced to avoid clobbering existing settings fields.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Obsidian command palette
└── Index changes command callback (main.ts)
    └── runIndexCommand("Index changes", "index-changes", ...)
        └── IndexingService.indexChanges()
            ├── crawlVaultMarkdownNotes(...) -> current notes
            ├── IndexManifestStore.load() -> previous fingerprints
            ├── diff current vs previous -> created/updated/deleted
            ├── chunk + embed only created/updated notes
            ├── persist next manifest
            └── JobSnapshot with incremental counts
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `IndexingService.indexChanges` | `() => Promise<JobSnapshot>` | Disposed + manifest read/write guards | Runs incremental workflow and reports diff summary |
| `IndexManifestStore.load/save` | `() => Promise<IndexManifest>` / `(manifest) => Promise<void>` | Persistent metadata state | Versioned store for note fingerprints across runs |
| `computeIncrementalDiff` | `(previous, current) => IncrementalDiffResult` | Pure function | Deterministic classification by `notePath` + `noteHash` |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | `Index changes` command shows running progress state while diff/index executes |
| Error   | Manifest read/write or indexing errors surface through normalized command failure path |
| Empty   | No created/updated/deleted notes yields success snapshot with explicit "No changes detected" detail |
| Success | Success snapshot detail includes created/updated/deleted counts and embedded chunk totals |

No new frontend view is required; command + slideout wiring should consume improved incremental snapshots.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/services/indexing/IndexManifestStore.ts` | Persist and retrieve versioned index fingerprint manifest data |
| 2 | `src/utils/hasher.ts` | Shared deterministic hash utility for normalized note content fingerprints |
| 3 | `src/__tests__/unit/indexManifestStore.test.ts` | Unit tests for manifest persistence/versioning and fallback behavior |
| 4 | `src/__tests__/unit/indexing.incremental.test.ts` | Unit tests for diff classification and incremental workflow execution |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Add `IndexedNoteFingerprint`, `IndexManifest`, and `IncrementalDiffResult` contracts |
| 2 | `src/services/IndexingService.ts` | Implement `indexChanges()` diff planning, selective chunk/embed work, and manifest writeback |
| 3 | `src/bootstrap/bootstrapRuntimeServices.ts` | Inject manifest-store dependencies into `IndexingService` construction |
| 4 | `src/main.ts` | Remove placeholder success notice for `Index changes`; surface real incremental completion detail |
| 5 | `src/__tests__/unit/services.runtime.test.ts` | Update runtime tests for new dependencies and incremental behavior assertions |
| 6 | `src/__tests__/integration/plugin.runtime.test.ts` | Update command integration expectations for real `Index changes` behavior |

### Files UNCHANGED (confirm no modifications needed)

- `src/utils/chunker.ts` — chunking rules are already defined; IDX-4 consumes existing behavior
- `src/utils/vaultCrawler.ts` — crawler scope behavior remains source of current note inputs
- `src/ui/SearchView.ts` — semantic search UI is outside indexing diff scope

---

## 5. Acceptance Criteria Checklist

### Phase A: Fingerprint Manifest Foundations

- [x] **A1** — Note fingerprints are computed deterministically from normalized note content
  - Incremental logic produces a stable `noteHash` for each crawled note.
  - Hash output is independent of platform line-ending differences (`\r\n` vs `\n`).

- [x] **A2** — Manifest persistence is versioned and namespaced
  - `IndexManifestStore` reads/writes a `version` field and validates expected shape.
  - Missing or malformed manifest data falls back safely to an empty baseline manifest.

- [x] **A3** — Full reindex path can seed/refresh manifest baseline
  - `reindexVault()` writes a complete manifest reflecting all currently indexed notes.
  - Manifest `updatedAt` is refreshed on successful baseline writes.

### Phase B: Incremental Diff + Execution

- [x] **B1** — Incremental diff classifies created/updated/unchanged/deleted notes correctly
  - Classification compares current crawl results against prior manifest by `notePath`.
  - Updated notes are identified when `noteHash` differs for the same path.

- [x] **B2** — `indexChanges()` performs indexing work only for created/updated notes
  - Only changed notes are chunked and sent to embedding.
  - Unchanged notes do not trigger chunking or embedding calls.

- [x] **B3** — Deleted notes are reflected in the persisted manifest
  - Notes absent from current crawl are removed from next manifest snapshot.
  - Success detail reports deleted note count even when no new embeddings are generated.

### Phase C: Command UX and Testing

- [x] **C1** — `Index changes` command reports real incremental outcome
  - Placeholder success copy is removed for `obsidian-ai:index-changes`.
  - Completion notice/detail includes created/updated/deleted counts.

- [x] **C2** — No-change runs short-circuit safely
  - With no created/updated/deleted notes, command returns success and does not call embedding service.
  - Slideout/notice messaging explicitly indicates no changes detected.

- [x] **C3** — Automated tests cover diff correctness and command wiring
  - Unit tests validate all diff buckets and manifest edge cases.
  - Integration tests verify command callback path and user-facing notices.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Manifest schema evolution can break incremental runs on existing installs | Include explicit `version` and migration-safe fallback to empty baseline |
| 2 | Hashing full note bodies may still be costly on large vaults | Keep hash utility efficient and process notes in deterministic single-pass flow |
| 3 | Persisting manifest alongside settings can cause accidental data overwrite | Namespace manifest payload and preserve unknown keys on read/write |
| 4 | Incorrect diff logic can silently skip updates | Add exhaustive unit tests for create/update/delete/unchanged classification |

---

## Implementation Order

1. `src/types.ts` — add manifest/diff contracts used by incremental workflow and store (covers A1, A2, B1).
2. `src/utils/hasher.ts` and `src/services/indexing/IndexManifestStore.ts` — implement deterministic note hashing plus manifest load/save/fallback behavior (covers A1, A2, A3).
3. `src/services/IndexingService.ts` — implement diff planning, selective chunk/embed execution, manifest writeback, and no-change short-circuit (covers B1, B2, B3, C2).
4. `src/bootstrap/bootstrapRuntimeServices.ts` — wire manifest-store dependency into indexing service construction (covers A2, A3).
5. `src/main.ts` — replace `Index changes` placeholder success message with real incremental completion reporting (covers C1).
6. `src/__tests__/unit/indexManifestStore.test.ts`, `src/__tests__/unit/indexing.incremental.test.ts`, `src/__tests__/unit/services.runtime.test.ts`, and `src/__tests__/integration/plugin.runtime.test.ts` — add/adjust tests for persistence, diffing, and command UX (covers C3).
7. **Verify** — run `npm run test` and `npm run lint` after incremental path wiring (covers Z2, Z3).
8. **Final verify** — run `npm run build` and manually run `Reindex vault` then `Index changes` in a dev vault to confirm changed-only behavior (covers Z1, Z4).

---

*Created: 2026-02-23 | Story: IDX-4 | Epic: Epic 2 — Indexing and Metadata Pipeline*
