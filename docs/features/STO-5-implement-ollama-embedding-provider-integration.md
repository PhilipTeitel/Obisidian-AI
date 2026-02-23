# STO-5: Implement Ollama embedding provider integration

**Story**: Add a local-runtime Ollama embedding provider that supports configurable endpoint/model settings and robust response parsing for embedding generation.
**Epic**: Epic 3 — Local Vector Storage and Embedding Providers
**Size**: Medium
**Status**: Done

---

## 1. Summary

This story adds Ollama as an MVP embedding provider so users can run local embedding generation without remote APIs. The provider should honor existing settings for endpoint and model selection.

The implementation must support reliable request/response handling for Ollama embedding endpoints and degrade clearly when endpoint connectivity or payload shape is invalid.

This story is intentionally limited to embedding provider integration and runtime wiring, not chat or UI controls.

---

## 2. API Endpoints + Schemas

New outbound provider request (no local API endpoint):

| Attribute | Value |
|-----------|-------|
| Method    | POST |
| Path      | `{ollamaEndpoint}/api/embed` (or compatible embedding route) |
| Auth      | none (MVP local runtime) |
| Query     | none |
| Response  | Ollama embedding payload (`embeddings[]` or compatible shape) |

No shared API schema file changes are required.

If Ollama endpoint returns malformed vectors, provider should throw actionable provider errors.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
EmbeddingService
└── OllamaEmbeddingProvider
    ├── settings.ollamaEndpoint
    ├── request model + inputs
    └── parse embeddings response
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `OllamaEmbeddingProvider.embed` | `(request: EmbeddingRequest) => Promise<EmbeddingResponse>` | Stateless per call | Uses configured endpoint and request model |
| Endpoint getter | `() => string` | N/A | Source of runtime-configurable Ollama base URL |
| Response parser | internal helper | N/A | Supports batch/single embedding response shapes |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Runtime-only provider call |
| Error   | Endpoint failure or malformed payload throws provider error |
| Empty   | Empty input list returns empty vectors without network call |
| Success | Returns embedding vector output aligned to input ordering |

No frontend changes are required for STO-5.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/providers/embeddings/OllamaEmbeddingProvider.ts` | Implement Ollama embedding HTTP integration |
| 2 | `src/__tests__/unit/ollamaEmbeddingProvider.test.ts` | Unit tests for endpoint requests and response parsing |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/bootstrap/bootstrapRuntimeServices.ts` | Construct/register Ollama embedding provider |
| 2 | `src/providers/ProviderRegistry.ts` | Ensure Ollama registration/lookup path is supported |
| 3 | `src/services/EmbeddingService.ts` | Route embedding requests to registered Ollama provider |

### Files UNCHANGED (confirm no modifications needed)

- `src/ui/SearchView.ts` — no UI changes required for provider transport
- `src/ui/ChatView.ts` — chat flows are out of scope
- `src/main.ts` — command surface unchanged

---

## 5. Acceptance Criteria Checklist

### Phase A: Ollama Provider Behavior

- [x] **A1** — Provider targets configured Ollama endpoint
  - Endpoint is taken from settings and normalized safely.
  - Request payload includes selected model and input content.

- [x] **A2** — Provider parses Ollama embedding response formats
  - Supports array response forms used by Ollama embedding routes.
  - Validates vectors as numeric arrays and preserves input ordering.

- [x] **A3** — Provider fails clearly on malformed payloads
  - Missing embeddings field or invalid values throw provider errors.
  - Non-2xx responses include status context in error message.

### Phase B: Runtime Integration

- [x] **B1** — Ollama provider is registered and discoverable in registry
  - Registry includes `ollama` embedding provider after bootstrap.
  - EmbeddingService resolves Ollama provider path without hardcoding behavior.

- [x] **B2** — Unit tests cover success + failure paths
  - Tests include endpoint normalization, parse success, non-2xx failure, and malformed payload failure.
  - Network is mocked; no external Ollama runtime required for CI tests.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Ollama response shape differences across versions | Implement parser support for compatible response forms with strict validation |
| 2 | Local endpoint instability can cause noisy failures | Include retry/timeout handling at embedding service layer (STO-6) |
| 3 | Model mismatch errors may be opaque | Include model and endpoint context in thrown errors |

---

## Implementation Order

1. `src/providers/embeddings/OllamaEmbeddingProvider.ts` — implement endpoint call + response parsing/validation (covers A1-A3).
2. `src/bootstrap/bootstrapRuntimeServices.ts` — register Ollama provider in runtime bootstrap (covers B1).
3. `src/providers/ProviderRegistry.ts` + `src/services/EmbeddingService.ts` — validate provider resolution path for Ollama (covers B1).
4. `src/__tests__/unit/ollamaEmbeddingProvider.test.ts` — cover happy/failure parsing and transport behavior (covers B2).
5. **Final verify** — run `npm run test && npm run lint && npm run build` (covers Z1-Z4).

---

*Created: 2026-02-23 | Story: STO-5 | Epic: Epic 3 — Local Vector Storage and Embedding Providers*
