# STO-4: Implement OpenAI embedding provider integration

**Story**: Add a production-ready OpenAI embedding provider that uses configurable endpoint/model settings and retrieves the API key from secret storage.
**Epic**: Epic 3 — Local Vector Storage and Embedding Providers
**Size**: Medium
**Status**: Done

---

## 1. Summary

This story introduces concrete OpenAI embedding generation for indexing/search pipelines. The provider must honor plugin settings for endpoint/model selection while sourcing credentials from secret storage instead of plain settings data.

The implementation should be robust against malformed responses, non-2xx status codes, and missing credentials. Runtime errors should be explicit enough to guide user remediation.

This story focuses on OpenAI embedding only. Chat endpoints and broader key-management UX remain outside scope.

---

## 2. API Endpoints + Schemas

New outbound provider request (no local API endpoint):

| Attribute | Value |
|-----------|-------|
| Method    | POST |
| Path      | `{openaiEndpoint}/embeddings` |
| Auth      | required (`Authorization: Bearer <api-key>`) |
| Query     | none |
| Response  | OpenAI embeddings JSON payload (`data[].embedding`) |

Internal type contract additions/usage:

```ts
export interface SecretStoreContract {
  getSecret(key: string): Promise<string | null>;
}
```

If no API key is available from secret storage, provider should throw a provider-auth actionable error.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
EmbeddingService
└── OpenAIEmbeddingProvider
    ├── SecretStore.getSecret("openai-api-key")
    ├── settings.openaiEndpoint
    └── POST /embeddings
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `OpenAIEmbeddingProvider.embed` | `(request: EmbeddingRequest) => Promise<EmbeddingResponse>` | Stateless per call | Maps OpenAI response vectors into internal `EmbeddingVector[]` |
| `SecretStoreContract.getSecret` | `(key: string) => Promise<string \| null>` | External secret backend | Credential source for API key |
| Provider config getters | endpoint + model via settings | N/A | Endpoint/model configurable via existing settings |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Runtime call only; no direct UI state in this story |
| Error   | Missing key, non-2xx response, or malformed payload throws provider error |
| Empty   | Empty input list returns empty vectors without network call |
| Success | Returns one embedding vector per input in response order |

No frontend view updates are required.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/providers/embeddings/OpenAIEmbeddingProvider.ts` | Implement OpenAI embedding HTTP integration |
| 2 | `src/secrets/PluginSecretStore.ts` | Secret-store adapter used to retrieve OpenAI API key |
| 3 | `src/__tests__/unit/openaiEmbeddingProvider.test.ts` | Unit tests for key retrieval, request payloads, and response parsing |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Add/confirm secret-store and provider contracts |
| 2 | `src/bootstrap/bootstrapRuntimeServices.ts` | Construct and register OpenAI embedding provider with secret-store dependency |
| 3 | `src/services/EmbeddingService.ts` | Route embedding requests through registered OpenAI provider |

### Files UNCHANGED (confirm no modifications needed)

- `src/ui/SearchView.ts` — provider transport integration is backend-only
- `src/ui/ChatView.ts` — chat flow out of scope
- `src/main.ts` — command lifecycle unchanged

---

## 5. Acceptance Criteria Checklist

### Phase A: OpenAI Provider Behavior

- [x] **A1** — Provider sends embeddings requests to configured OpenAI endpoint
  - Endpoint uses settings value and trims trailing slashes safely.
  - Request body includes `model` and `input` values from embedding request.

- [x] **A2** — API key is read from secret store
  - Provider requests `openai-api-key` from secret storage before network call.
  - Missing secret prevents outbound request and throws actionable auth error.

- [x] **A3** — Provider parses and validates OpenAI response payload
  - `data[].embedding` vectors are validated as numeric arrays.
  - Output vector count matches input count or provider throws.

### Phase B: Runtime Integration

- [x] **B1** — OpenAI provider is registered in bootstrap flow
  - Provider registry includes `openai` embedding provider at runtime startup.
  - EmbeddingService can resolve and execute OpenAI provider path.

- [x] **B2** — Unit tests cover success and failure paths
  - Tests include missing API key, non-2xx HTTP status, malformed JSON shape, and happy path parsing.
  - No network dependency in tests (fetch is fully mocked).

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Secret-store API availability differs between runtime and tests | Use adapter with capability checks and deterministic test doubles |
| 2 | OpenAI response shape changes can break parsing | Validate response shape explicitly and fail fast with clear errors |
| 3 | Endpoint misconfiguration can produce opaque failures | Include endpoint/status context in thrown provider errors |

---

## Implementation Order

1. `src/types.ts` — define/confirm secret-store contract and provider signatures (covers A2, B1).
2. `src/secrets/PluginSecretStore.ts` — implement secret retrieval adapter (covers A2).
3. `src/providers/embeddings/OpenAIEmbeddingProvider.ts` — implement HTTP call + response validation (covers A1, A2, A3).
4. `src/bootstrap/bootstrapRuntimeServices.ts` — construct/register OpenAI provider with secret-store dependency (covers B1).
5. `src/services/EmbeddingService.ts` — ensure runtime requests resolve through provider registry (covers B1).
6. `src/__tests__/unit/openaiEmbeddingProvider.test.ts` — add full path coverage with mocked fetch (covers B2).
7. **Final verify** — run `npm run test && npm run lint && npm run build` (covers Z1-Z4).

---

*Created: 2026-02-23 | Story: STO-4 | Epic: Epic 3 — Local Vector Storage and Embedding Providers*
