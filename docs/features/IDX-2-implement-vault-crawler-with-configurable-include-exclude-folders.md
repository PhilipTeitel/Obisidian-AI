# IDX-2: Implement vault crawler with configurable include/exclude folders

**Story**: Implement a deterministic vault crawler that returns markdown note payloads scoped by indexing include/exclude folder settings for downstream chunking and indexing workflows.
**Epic**: Epic 2 — Indexing and Metadata Pipeline
**Size**: Medium
**Status**: Done

---

## 1. Summary

This story introduces the indexing scope crawler that bridges Obsidian vault files and the indexing pipeline. The crawler is responsible for reading markdown files from the vault and returning normalized note payloads in a deterministic order so downstream indexing steps can operate predictably.

IDX-2 is a dependency for IDX-3 (full reindex workflow) and IDX-4 (incremental indexing), both of which require trustworthy file discovery constrained by user settings. Without this story, later indexing features cannot reliably honor folder boundaries configured in plugin settings.

The core design constraint is strict folder scoping correctness. Include folders define the candidate set, exclude folders remove paths from that set, and exclusion must always win. Scope behavior should be resilient to common path formatting variations (leading/trailing slashes) and should remain stable across runs for identical vault state.

Implementation remains focused on crawler behavior and indexing-service integration seam only. It does not implement vector-store persistence, incremental diffing, or command UX changes that belong to later stories.

---

## 2. API Endpoints + Schemas

No external API endpoint changes are needed for this story.

This repository is an Obsidian plugin and does not use `shared/types.ts`; no shared API schema changes are required.

Crawler output reuses the existing `ChunkerInput` shape so `IndexingService` can pass note payloads directly into `chunkMarkdownNote`:

```ts
export interface ChunkerInput {
  notePath: string;
  noteTitle: string;
  markdown: string;
  updatedAt: number;
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Obsidian App (vault)
└── IndexingService
    ├── crawlVaultMarkdownNotes(vault, indexedFolders, excludedFolders)
    │   ├── getMarkdownFiles()
    │   ├── include/exclude scope filtering
    │   └── cachedRead(file) -> ChunkerInput[]
    └── chunkNoteForIndexing(input) -> ChunkRecord[]
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `crawlVaultMarkdownNotes` | `({ vault, indexedFolders, excludedFolders }) => Promise<ChunkerInput[]>` | Stateless (async) | Reads markdown note payloads constrained by folder scope |
| `isPathInFolderScope` | `(notePath, folder) => boolean` | Stateless | Prefix matcher for normalized vault paths |
| `IndexingService.reindexVault` | `() => Promise<JobSnapshot>` | Uses runtime settings | Uses crawler outputs instead of placeholder note payload |
| `IndexingService.indexChanges` | `() => Promise<JobSnapshot>` | Uses runtime settings | Uses crawler outputs as interim source until incremental diffing story |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Not applicable in UI for IDX-2; crawler runs inside indexing service command execution |
| Error   | Vault read/crawler failures bubble through indexing command error normalization path |
| Empty   | No markdown files in scope returns `[]`; indexing still runs safely with empty embed inputs |
| Success | Matching markdown files are returned as deterministic `ChunkerInput[]` and passed to chunking |

No frontend view/component changes are required for this story.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/utils/vaultCrawler.ts` | Implement scoped markdown crawling, folder-path normalization, and note payload assembly |
| 2 | `src/__tests__/unit/vaultCrawler.test.ts` | Unit tests for include/exclude scope, normalization behavior, deterministic ordering, and payload mapping |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/services/IndexingService.ts` | Replace placeholder note payload usage with crawler-fed note payloads and chunking seam integration |
| 2 | `src/bootstrap/bootstrapRuntimeServices.ts` | Provide `app` dependency to `IndexingService` for vault access |
| 3 | `src/__tests__/harness/createMockAppHarness.ts` | Add minimal vault mock surface for command/runtime integration tests |
| 4 | `src/__tests__/unit/services.runtime.test.ts` | Update indexing unit test wiring for new `IndexingService` dependencies |
| 5 | `src/__tests__/setup/mockObsidianModule.ts` | Extend mock app shape if needed to satisfy crawler integration typing |

### Files UNCHANGED (confirm no modifications needed)

- `src/utils/chunker.ts` — chunking behavior is already covered by IDX-1 and remains unchanged in IDX-2
- `src/main.ts` — command registration and notices remain unchanged; command internals continue to call `IndexingService`
- `src/services/SearchService.ts` — semantic search retrieval is outside crawler scope

---

## 5. Acceptance Criteria Checklist

### Phase A: Folder Scope Resolution

- [x] **A1** — Include folder normalization is deterministic and resilient
  - Include folder values support leading/trailing slash variants (for example `"/projects/"`, `"projects"`).
  - Empty/blank include settings fall back to root scope (`"/"`) so indexing never silently disables all notes.

- [x] **A2** — Exclude folder precedence is enforced
  - A note path matched by both include and exclude scopes is excluded.
  - Exclude matching uses the same normalized prefix rules as include matching.

- [x] **A3** — Scope matching is boundary-safe
  - Folder prefix checks do not overmatch sibling paths (`"proj"` does not match `"project-notes"`).
  - Root include (`"/"`) matches all markdown files before exclusion filtering.

### Phase B: Vault Crawling Output

- [x] **B1** — Crawler reads markdown files from vault APIs
  - Crawler calls `vault.getMarkdownFiles()` to enumerate candidates.
  - Crawler reads note text via `vault.cachedRead(file)` for files that pass scope filtering.

- [x] **B2** — Crawler output maps directly to chunker input
  - Each returned payload includes `notePath`, `noteTitle`, `markdown`, and `updatedAt`.
  - `noteTitle` comes from file basename and `updatedAt` comes from file stat mtime.

- [x] **B3** — Crawler output ordering is deterministic
  - Returned notes are sorted consistently by `notePath` independent of vault enumeration order.
  - Repeated runs over unchanged vault state return identical payload ordering.

### Phase C: IndexingService Integration

- [x] **C1** — `IndexingService` consumes crawler payloads in reindex and index-changes paths
  - Placeholder hardcoded note payloads are removed from both methods.
  - Both methods pass crawler note payloads through `chunkNoteForIndexing`.

- [x] **C2** — Runtime wiring provides vault access without expanding command surface
  - `bootstrapRuntimeServices` injects `app` into `IndexingService` dependencies.
  - Existing command registration and command IDs remain unchanged.

- [x] **C3** — Unit tests cover crawler and updated indexing wiring
  - Dedicated crawler unit tests verify include/exclude behavior and payload mapping.
  - Runtime/indexing unit tests continue to pass with the new dependency shape and empty-scope behavior.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Path normalization inconsistencies can accidentally include or exclude wrong notes | Centralize path normalization + scope matching helpers with focused unit tests |
| 2 | Large vaults can make full crawl expensive even before embedding | Keep crawler deterministic and lightweight now; add incremental diffing in IDX-4 |
| 3 | Test harness drift from real Obsidian vault APIs can hide integration issues | Keep mocked vault interface minimal and aligned to the specific APIs used (`getMarkdownFiles`, `cachedRead`) |
| 4 | Empty include settings may be interpreted differently by users | Explicit fallback to root include in code and tests to avoid silent no-op indexing |

---

## Implementation Order

1. `src/utils/vaultCrawler.ts` — implement folder normalization, include/exclude matching, and markdown payload assembly (covers A1, A2, A3, B1, B2, B3).
2. `src/__tests__/unit/vaultCrawler.test.ts` — add scope and payload tests including deterministic ordering assertions (covers A1, A2, A3, B2, B3, C3).
3. `src/services/IndexingService.ts` — replace placeholder note payload usage with crawler-fed payloads and chunking pass-through (covers C1).
4. `src/bootstrap/bootstrapRuntimeServices.ts` — pass `app` to `IndexingService` dependency construction (covers C2).
5. `src/__tests__/harness/createMockAppHarness.ts` and `src/__tests__/unit/services.runtime.test.ts` — update test wiring for vault dependency and keep runtime command tests green (covers C2, C3).
6. **Verify** — run `npm run test` and `npm run lint` to validate behavior + code quality (covers Z2, Z3).
7. **Final verify** — run `npm run build` and confirm no runtime command registration regressions (covers Z1, Z4).

---

*Created: 2026-02-22 | Story: IDX-2 | Epic: Epic 2 — Indexing and Metadata Pipeline*
