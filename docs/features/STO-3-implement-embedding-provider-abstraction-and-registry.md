# STO-3: Implement embedding provider abstraction and registry

**Story**: Extend runtime provider wiring so embedding providers are registered, resolved, and validated through a shared abstraction that can support post-MVP providers.
**Epic**: Epic 3 — Local Vector Storage and Embedding Providers
**Size**: Small
**Status**: Done

---

## 1. Summary

This story turns the embedding-provider contract into a real runtime abstraction by adding provider registration and resolution behavior to the existing provider registry. The goal is to remove hardcoded provider assumptions from `EmbeddingService`.

The registry should support extension beyond OpenAI and Ollama with stable provider IDs, typed contracts, and deterministic lookup behavior. This lays the groundwork for future providers without requiring service refactors.

Scope is intentionally runtime/service-oriented and does not include UI provider-management workflows.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are required for STO-3.

Internal contract updates in `src/types.ts` should include:

```ts
export interface ProviderRegistryContract extends RuntimeServiceLifecycle {
  getEmbeddingProviderId(): ProviderId;
  getChatProviderId(): ProviderId;
  registerEmbeddingProvider(provider: EmbeddingProvider): void;
  getEmbeddingProvider(providerId?: ProviderId): EmbeddingProvider;
  listEmbeddingProviders(): EmbeddingProvider[];
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
bootstrapRuntimeServices
└── ProviderRegistry
    ├── registerEmbeddingProvider(...)
    ├── getEmbeddingProvider(...)
    └── listEmbeddingProviders(...)

EmbeddingService
└── ProviderRegistry.getEmbeddingProvider(...)
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `registerEmbeddingProvider` | `(provider: EmbeddingProvider) => void` | In-memory map | Registers provider by stable ID |
| `getEmbeddingProvider` | `(providerId?: ProviderId) => EmbeddingProvider` | In-memory map | Falls back to active setting when ID omitted |
| `listEmbeddingProviders` | `() => EmbeddingProvider[]` | In-memory map | Returns deterministic provider list for diagnostics/tests |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Not UI-facing; runtime setup only |
| Error   | Unknown provider IDs throw clear runtime errors |
| Empty   | No providers registered is invalid for embedding calls |
| Success | Valid providers resolve by ID and active settings |

No frontend changes are required for STO-3.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/providerRegistry.embedding.test.ts` | Validate provider registration and lookup semantics |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Extend provider registry contract for embedding provider resolution |
| 2 | `src/providers/ProviderRegistry.ts` | Implement provider registration/list/lookup behavior |
| 3 | `src/services/EmbeddingService.ts` | Resolve concrete embedding provider via registry |
| 4 | `src/bootstrap/bootstrapRuntimeServices.ts` | Register default embedding providers during bootstrap |

### Files UNCHANGED (confirm no modifications needed)

- `src/ui/SearchView.ts` — provider abstraction is backend/runtime concern only
- `src/ui/ChatView.ts` — chat pane behavior is out of scope
- `src/main.ts` — command wiring unchanged

---

## 5. Acceptance Criteria Checklist

### Phase A: Registry Contract

- [x] **A1** — Registry supports embedding provider registration by ID
  - Registering provider ID exposes it through list/lookup methods.
  - Duplicate registrations replace or reject deterministically (documented behavior).

- [x] **A2** — Registry resolves embedding providers by explicit or active ID
  - `getEmbeddingProvider(providerId)` resolves explicit IDs.
  - `getEmbeddingProvider()` resolves the currently configured provider ID.

### Phase B: Service Wiring

- [x] **B1** — EmbeddingService uses provider instances from registry
  - Service no longer returns placeholder vectors without provider calls.
  - Unknown provider IDs surface actionable runtime errors.

- [x] **B2** — Bootstrap registers MVP embedding providers
  - OpenAI and Ollama embedding providers are both registered at runtime startup.
  - Provider registry remains extensible for future provider additions.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Provider lookup failures can break indexing at runtime | Throw explicit errors with provider ID context and add tests |
| 2 | Registry API may grow beyond MVP scope | Keep interfaces minimal and provider-kind specific |
| 3 | Bootstrapping order changes could cause unregistered provider usage | Ensure provider registration occurs before service initialization |

---

## Implementation Order

1. `src/types.ts` — expand `ProviderRegistryContract` for provider registration/lookup (covers A1, A2).
2. `src/providers/ProviderRegistry.ts` — implement internal provider map + deterministic lookup/list behavior (covers A1, A2).
3. `src/bootstrap/bootstrapRuntimeServices.ts` — register default providers during bootstrap (covers B2).
4. `src/services/EmbeddingService.ts` — resolve providers through registry and remove placeholder behavior (covers B1).
5. `src/__tests__/unit/providerRegistry.embedding.test.ts` + runtime tests — verify registration and resolution semantics (covers A1-A2, B1-B2).
6. **Final verify** — run `npm run test && npm run lint && npm run build` (covers Z1-Z4).

---

*Created: 2026-02-23 | Story: STO-3 | Epic: Epic 3 — Local Vector Storage and Embedding Providers*
