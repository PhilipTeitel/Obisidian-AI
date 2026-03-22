# STOR-3: Wire SqliteVecRepository into bootstrap and deprecate LocalVectorStoreRepository

**Story**: Update `bootstrapRuntimeServices.ts` to construct and wire `SqliteVecRepository` as the `hierarchicalStore` in `RuntimeServices`. Mark `LocalVectorStoreRepository` as deprecated. Update `ServiceContainer` to support the new store.
**Epic**: Epic 12 — SQLite Hierarchical Storage Migration
**Size**: Medium
**Status**: Complete

---

## 1. Summary

This story completes Epic 12 by wiring the `SqliteVecRepository` (from STOR-2) into the runtime bootstrap system. The bootstrap function will construct a `SqliteVecRepository` instance and attach it to the `RuntimeServices` interface via the `hierarchicalStore` field (defined as optional in HIER-1).

The existing `LocalVectorStoreRepository` and its flat chunk pipeline remain functional — they are not removed. The `LocalVectorStoreRepository` file receives a `@deprecated` JSDoc annotation directing future consumers to use `SqliteVecRepository` instead. This dual-store approach allows the flat pipeline to continue working until Epic 15 (Integration) switches the runtime over.

The `ServiceContainer` is updated to accept and expose the optional `hierarchicalStore` field. The `SqliteVecRepository` is initialized during bootstrap (its `init()` loads persisted state) and disposed during shutdown (reverse order).

Key changes:
- `bootstrapRuntimeServices.ts`: Construct `SqliteVecRepository`, call `init()`, attach to `ServiceContainer`
- `ServiceContainer.ts`: Add optional `hierarchicalStore` to deps and expose on the container
- `LocalVectorStoreRepository.ts`: Add `@deprecated` JSDoc annotation to the class

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed. This is an Obsidian plugin with internal service interfaces only.

No new types are needed. The `RuntimeServices.hierarchicalStore` field is already defined as optional in `src/types.ts` (from HIER-1).

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
src/bootstrap/bootstrapRuntimeServices.ts (modified)
├── Constructs SqliteVecRepository
├── Calls init() during bootstrap sequence
├── Passes to ServiceContainer
└── Disposed during shutdown

src/services/ServiceContainer.ts (modified)
├── Accepts optional hierarchicalStore in deps
└── Exposes on RuntimeServices interface

src/storage/LocalVectorStoreRepository.ts (modified)
└── @deprecated annotation added to class
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ServiceContainerDeps` | Add optional `hierarchicalStore` | N/A | New optional field |
| `ServiceContainer` | Expose `hierarchicalStore` | N/A | Satisfies `RuntimeServices` interface |
| `bootstrapRuntimeServices` | Construct + init `SqliteVecRepository` | N/A | New construction step |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | `SqliteVecRepository.init()` runs during bootstrap |
| Error   | Bootstrap fails if init fails (existing error handling) |
| Empty   | Valid — empty hierarchical store |
| Success | Store is available via `services.hierarchicalStore` |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/bootstrapHierarchicalStore.test.ts` | Tests verifying hierarchical store is wired, initialized, and accessible |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/bootstrap/bootstrapRuntimeServices.ts` | Import and construct `SqliteVecRepository`, init during bootstrap, pass to `ServiceContainer` |
| 2 | `src/services/ServiceContainer.ts` | Add optional `hierarchicalStore` to `ServiceContainerDeps`, expose on class |
| 3 | `src/storage/LocalVectorStoreRepository.ts` | Add `@deprecated` JSDoc annotation to class |

### Files UNCHANGED (confirm no modifications needed)

- `src/types.ts` — `RuntimeServices.hierarchicalStore` already defined as optional
- `src/storage/SqliteVecRepository.ts` — no changes needed
- `src/storage/vectorStoreSchema.ts` — no changes needed
- `src/services/IndexingService.ts` — integration happens in INTG-2
- `src/main.ts` — no command or lifecycle changes

---

## 5. Acceptance Criteria Checklist

### Phase A: Bootstrap Wiring

- [x] **A1** — `SqliteVecRepository` is constructed in `bootstrapRuntimeServices`
  - The bootstrap function creates a `SqliteVecRepository` instance with the plugin and pluginId.
  - Evidence: `src/__tests__/unit/bootstrapHierarchicalStore.test.ts::A1_repo_constructed(vitest)`

- [x] **A2** — `SqliteVecRepository.init()` is called during bootstrap
  - The repository's `init()` method is invoked as part of the bootstrap sequence.
  - Evidence: `src/__tests__/unit/bootstrapHierarchicalStore.test.ts::A2_repo_initialized(vitest)`

- [x] **A3** — `hierarchicalStore` is accessible on `RuntimeServices`
  - After bootstrap, `services.hierarchicalStore` is defined and implements `HierarchicalStoreContract`.
  - Evidence: `src/__tests__/unit/bootstrapHierarchicalStore.test.ts::A3_store_accessible(vitest)`

### Phase B: ServiceContainer Update

- [x] **B1** — `ServiceContainer` accepts optional `hierarchicalStore` in deps
  - The `ServiceContainerDeps` interface includes an optional `hierarchicalStore` field.
  - Evidence: `src/__tests__/unit/bootstrapHierarchicalStore.test.ts::B1_container_accepts_store(vitest)`

- [x] **B2** — `ServiceContainer` exposes `hierarchicalStore` on the instance
  - The container's `hierarchicalStore` property returns the store passed in deps.
  - Evidence: `src/__tests__/unit/bootstrapHierarchicalStore.test.ts::B2_container_exposes_store(vitest)`

### Phase C: Deprecation

- [x] **C1** — `LocalVectorStoreRepository` has `@deprecated` JSDoc annotation
  - The class-level JSDoc includes `@deprecated Use SqliteVecRepository instead`.
  - Evidence: Source code inspection (no runtime test needed)

### Phase D: Backward Compatibility

- [x] **D1** — Existing services continue to function without hierarchical store
  - All existing tests continue to pass. The flat pipeline is unaffected.
  - Evidence: `npm run test` — all existing tests pass

- [x] **D2** — Bootstrap still succeeds and all named services initialize
  - The existing bootstrap integration tests continue to pass.
  - Evidence: `src/__tests__/integration/plugin.runtime.test.ts::all_existing_tests_pass(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All existing tests continue to pass (`npm run test`)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Adding `SqliteVecRepository` to bootstrap increases startup time | The `init()` call is lightweight (loads from plugin data); lazy initialization for heavy operations is deferred to first use |
| 2 | Dual stores (`LocalVectorStoreRepository` + `SqliteVecRepository`) increase memory usage | Both stores are lightweight in-memory; the flat store will be removed in Epic 15 |
| 3 | `hierarchicalStore` is optional on `RuntimeServices`, which could mask missing wiring | Tests verify the store is present after bootstrap; INTG-1 will make it required |
| 4 | Deprecation annotation has no runtime enforcement | The annotation serves as developer guidance; actual removal happens in a future epic |

---

## Implementation Order

1. `src/services/ServiceContainer.ts` — Add optional `hierarchicalStore` to `ServiceContainerDeps` and expose on class (covers B1, B2)
2. `src/bootstrap/bootstrapRuntimeServices.ts` — Import `SqliteVecRepository`, construct, init, and pass to `ServiceContainer` (covers A1, A2, A3)
3. `src/storage/LocalVectorStoreRepository.ts` — Add `@deprecated` JSDoc annotation (covers C1)
4. **Verify** — `npm run typecheck && npm run build` to confirm compilation
5. `src/__tests__/unit/bootstrapHierarchicalStore.test.ts` — Write tests for wiring, initialization, and accessibility (covers A1–D2)
6. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z4)

---

*Created: 2026-03-22 | Story: STOR-3 | Epic: Epic 12 — SQLite Hierarchical Storage Migration*
