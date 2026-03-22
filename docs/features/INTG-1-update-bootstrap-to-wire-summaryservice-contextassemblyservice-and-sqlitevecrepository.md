# INTG-1: Update bootstrap to wire SummaryService, ContextAssemblyService, and SqliteVecRepository

**Story**: Update `bootstrapRuntimeServices.ts` with new service construction order, add `SummaryService` and `ContextAssemblyService` to `RuntimeServices`, and make `hierarchicalStore` required.
**Epic**: Epic 15 — Hierarchical Indexing Pipeline Integration
**Size**: Medium
**Status**: Complete

---

## 1. Summary

This story wires the three new hierarchical-pipeline services — `SummaryService`, `ContextAssemblyService`, and `SqliteVecRepository` (as `hierarchicalStore`) — into the runtime bootstrap and service container so that downstream stories (INTG-2, INTG-3, INTG-4) can consume them.

Currently, `SqliteVecRepository` is constructed and initialized in bootstrap but only passed to `ServiceContainer` as an optional field. `SummaryService` and `ContextAssemblyService` are not constructed or wired at all. `SearchService` receives an optional `hierarchicalStore` in its deps but bootstrap does not pass it.

After this story:
- `SummaryService` and `ContextAssemblyService` are constructed in bootstrap with their required deps and added to the service initialization/disposal lifecycle.
- `hierarchicalStore` becomes a **required** field on `RuntimeServices` and `ServiceContainerDeps` (it is always constructed).
- `SearchService` receives `hierarchicalStore` in its bootstrap deps.
- `RUNTIME_SERVICE_CONSTRUCTION_ORDER` is extended to include `summaryService` and `contextAssemblyService`.
- The `ServiceContainer` disposes all services including the new ones in reverse construction order.

This is the foundation story for Epic 15 — all other INTG stories depend on these services being available at runtime.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed. This is an Obsidian plugin with internal service interfaces only.

New types to add to `src/types.ts`:

```ts
export interface SummaryServiceContract extends RuntimeServiceLifecycle {
  generateSummaries(tree: DocumentTree, options?: SummaryGenerationOptions): Promise<SummaryGenerationResult[]>;
  regenerateFromChangedNodes(nodeIds: string[], tree: DocumentTree, options?: SummaryGenerationOptions): Promise<SummaryGenerationResult[]>;
}

export interface ContextAssemblyServiceContract extends RuntimeServiceLifecycle {
  assemble(matches: LeafMatch[]): Promise<AssembledContext>;
}
```

Updated `RuntimeServices`:

```ts
export interface RuntimeServices {
  indexingService: IndexingServiceContract;
  embeddingService: EmbeddingServiceContract;
  searchService: SearchServiceContract;
  chatService: ChatServiceContract;
  agentService: AgentServiceContract;
  providerRegistry: ProviderRegistryContract;
  summaryService: SummaryServiceContract;
  contextAssemblyService: ContextAssemblyServiceContract;
  hierarchicalStore: HierarchicalStoreContract;
  dispose(): Promise<void>;
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
src/types.ts (modified)
├── Add SummaryServiceContract interface
├── Add ContextAssemblyServiceContract interface
├── Make hierarchicalStore required on RuntimeServices
└── Extend RUNTIME_SERVICE_CONSTRUCTION_ORDER

src/services/ServiceContainer.ts (modified)
├── Add summaryService, contextAssemblyService to ServiceContainerDeps
├── Add summaryService, contextAssemblyService to class fields
├── Make hierarchicalStore required
└── Include all services in dispose lifecycle

src/bootstrap/bootstrapRuntimeServices.ts (modified)
├── Import SummaryService, ContextAssemblyService
├── Construct SummaryService with deps
├── Construct ContextAssemblyService with deps
├── Pass hierarchicalStore to SearchService
└── Pass new services to ServiceContainer
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `SummaryServiceContract` | New interface in types.ts | N/A | Matches SummaryService public API |
| `ContextAssemblyServiceContract` | New interface in types.ts | N/A | Matches ContextAssemblyService public API |
| `RuntimeServices` | `summaryService`, `contextAssemblyService` added; `hierarchicalStore` required | N/A | Breaking: optional → required |
| `ServiceContainerDeps` | Add `summaryService`, `contextAssemblyService`; `hierarchicalStore` required | N/A | Aligns with RuntimeServices |
| `RUNTIME_SERVICE_CONSTRUCTION_ORDER` | Add `"summaryService"`, `"contextAssemblyService"` | N/A | After embeddingService, before indexingService |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | New services init during bootstrap alongside existing services |
| Error   | Bootstrap fails if any service init fails (existing error handling) |
| Empty   | Valid — services initialized with empty store |
| Success | All services available via `services.summaryService`, `services.contextAssemblyService`, `services.hierarchicalStore` |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/bootstrapIntegration.test.ts` | Tests verifying new services are wired, initialized, and disposable |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Add `SummaryServiceContract`, `ContextAssemblyServiceContract`; make `hierarchicalStore` required on `RuntimeServices`; extend `RUNTIME_SERVICE_CONSTRUCTION_ORDER` |
| 2 | `src/services/ServiceContainer.ts` | Add `summaryService`, `contextAssemblyService` to deps and class; make `hierarchicalStore` required; include all in dispose |
| 3 | `src/bootstrap/bootstrapRuntimeServices.ts` | Import and construct `SummaryService`, `ContextAssemblyService`; pass `hierarchicalStore` to `SearchService`; pass new services to `ServiceContainer` |
| 4 | `src/services/SummaryService.ts` | Add `implements SummaryServiceContract` to class declaration |
| 5 | `src/services/ContextAssemblyService.ts` | Add `implements ContextAssemblyServiceContract` to class declaration |

### Files UNCHANGED (confirm no modifications needed)

- `src/storage/SqliteVecRepository.ts` — already constructed in bootstrap
- `src/services/SearchService.ts` — already accepts optional `hierarchicalStore` in deps
- `src/services/IndexingService.ts` — integration happens in INTG-2
- `src/services/ChatService.ts` — hierarchical context integration already done in RET-5
- `src/main.ts` — no command or lifecycle changes
- `src/settings.ts` — token budget settings added in INTG-4

---

## 5. Acceptance Criteria Checklist

### Phase A: Type Contracts

- [x] **A1** — `SummaryServiceContract` interface exists in `src/types.ts`
  - Interface declares `generateSummaries` and `regenerateFromChangedNodes` methods matching `SummaryService` public API.
  - Evidence: `src/__tests__/unit/bootstrapIntegration.test.ts::A1_summary_contract_exists(vitest)`

- [x] **A2** — `ContextAssemblyServiceContract` interface exists in `src/types.ts`
  - Interface declares `assemble` method matching `ContextAssemblyService` public API.
  - Evidence: `src/__tests__/unit/bootstrapIntegration.test.ts::A2_context_assembly_contract_exists(vitest)`

- [x] **A3** — `RuntimeServices.hierarchicalStore` is required (not optional)
  - The `?` is removed from the `hierarchicalStore` field on `RuntimeServices`.
  - Evidence: `src/__tests__/unit/bootstrapIntegration.test.ts::A3_hierarchical_store_required(vitest)`

- [x] **A4** — `RuntimeServices` includes `summaryService` and `contextAssemblyService` fields
  - Both fields are typed with their respective contracts.
  - Evidence: `src/__tests__/unit/bootstrapIntegration.test.ts::A4_new_services_on_runtime(vitest)`

- [x] **A5** — `RUNTIME_SERVICE_CONSTRUCTION_ORDER` includes `summaryService` and `contextAssemblyService`
  - `summaryService` appears after `embeddingService` (it depends on provider registry). `contextAssemblyService` appears after `searchService` (it depends on hierarchical store).
  - Evidence: `src/__tests__/unit/bootstrapIntegration.test.ts::A5_construction_order(vitest)`

### Phase B: Bootstrap Wiring

- [x] **B1** — `SummaryService` is constructed in `bootstrapRuntimeServices` with correct deps
  - Receives `providerRegistry`, `hierarchicalStore`, and `getSettings`.
  - Evidence: `src/__tests__/unit/bootstrapIntegration.test.ts::B1_summary_service_constructed(vitest)`

- [x] **B2** — `ContextAssemblyService` is constructed in `bootstrapRuntimeServices` with correct deps
  - Receives `hierarchicalStore` and `getSettings`.
  - Evidence: `src/__tests__/unit/bootstrapIntegration.test.ts::B2_context_assembly_constructed(vitest)`

- [x] **B3** — `SearchService` receives `hierarchicalStore` in its bootstrap deps
  - The `hierarchicalStore` field is passed when constructing `SearchService`.
  - Evidence: `src/__tests__/unit/bootstrapIntegration.test.ts::B3_search_gets_hierarchical_store(vitest)`

- [x] **B4** — All new services are initialized during bootstrap
  - `summaryService` and `contextAssemblyService` appear in `initializationOrder` after bootstrap completes.
  - Evidence: `src/__tests__/unit/bootstrapIntegration.test.ts::B4_new_services_initialized(vitest)`

### Phase C: ServiceContainer Update

- [x] **C1** — `ServiceContainer` accepts and exposes `summaryService` and `contextAssemblyService`
  - Both fields are accessible on the container instance after construction.
  - Evidence: `src/__tests__/unit/bootstrapIntegration.test.ts::C1_container_exposes_new_services(vitest)`

- [x] **C2** — `ServiceContainer.dispose()` disposes all services including new ones
  - Disposal runs in reverse construction order and includes `summaryService`, `contextAssemblyService`, and `hierarchicalStore`.
  - Evidence: `src/__tests__/unit/bootstrapIntegration.test.ts::C2_dispose_includes_new_services(vitest)`

### Phase D: Backward Compatibility

- [x] **D1** — All existing tests continue to pass
  - No regressions in existing test suites.
  - Evidence: `npm run test` — all existing tests pass

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Making `hierarchicalStore` required is a breaking change for tests that construct `RuntimeServices` or `ServiceContainer` without it | Update all test factories/mocks to include `hierarchicalStore` |
| 2 | Adding services to `RUNTIME_SERVICE_CONSTRUCTION_ORDER` changes the `RuntimeServiceName` union type | All existing names remain; only new names are added |
| 3 | `SummaryService` depends on `providerRegistry` and `hierarchicalStore` being initialized first | Construction order ensures dependencies are ready before dependents |
| 4 | `ContextAssemblyService` reads budget settings that don't exist on `ObsidianAISettings` yet | INTG-4 adds these settings; until then, `ContextAssemblyService` uses defaults via its internal `resolveBudgets` fallback |

---

## Implementation Order

1. `src/types.ts` — Add `SummaryServiceContract`, `ContextAssemblyServiceContract`; make `hierarchicalStore` required on `RuntimeServices`; extend `RUNTIME_SERVICE_CONSTRUCTION_ORDER` with `"summaryService"` and `"contextAssemblyService"` (covers A1, A2, A3, A4, A5)
2. `src/services/SummaryService.ts` — Add `implements SummaryServiceContract` to class declaration
3. `src/services/ContextAssemblyService.ts` — Add `implements ContextAssemblyServiceContract` to class declaration
4. `src/services/ServiceContainer.ts` — Add `summaryService`, `contextAssemblyService` to `ServiceContainerDeps` and class fields; make `hierarchicalStore` required; update `dispose()` to include all services (covers C1, C2)
5. `src/bootstrap/bootstrapRuntimeServices.ts` — Import and construct `SummaryService` and `ContextAssemblyService`; pass `hierarchicalStore` to `SearchService`; add new services to `servicesByName` and `ServiceContainer` construction (covers B1, B2, B3, B4)
6. **Verify** — `npm run typecheck && npm run build` to confirm compilation
7. `src/__tests__/unit/bootstrapIntegration.test.ts` — Write tests for all acceptance criteria (covers A1–D1)
8. Fix any test failures caused by `hierarchicalStore` becoming required (update test factories/mocks)
9. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z3)

---

*Created: 2026-03-22 | Story: INTG-1 | Epic: Epic 15 — Hierarchical Indexing Pipeline Integration*
