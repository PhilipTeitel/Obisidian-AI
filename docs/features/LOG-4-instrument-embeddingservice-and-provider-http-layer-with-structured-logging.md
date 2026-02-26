# LOG-4: Instrument EmbeddingService and provider HTTP layer with structured logging

**Story**: Add structured logging for embedding batch/retry lifecycle and provider HTTP request/response timing with sensitive-header redaction.
**Epic**: Epic 9 — Logging and Observability Instrumentation
**Size**: Medium
**Status**: Done

---

## 1. Summary

LOG-4 instruments the embedding execution stack from service orchestration down to provider HTTP transport utilities.

The goal is to expose batch sizing, retry attempts, timeout behavior, request/response timing, and failure semantics needed to debug reliability issues under provider/network pressure.

A strict constraint is sensitive-data handling: logs must never include raw Authorization header values. All header logging must redact sensitive credentials while preserving enough metadata for diagnostics.

---

## 2. API Endpoints + Schemas

No API endpoint changes are required.

No shared schema changes are required. Existing runtime logger contracts from LOG-1 are reused.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
EmbeddingService.embed()
└── provider.embed()
    └── fetchJsonWithTimeout()
        ├── request start log (redacted headers)
        ├── response timing log
        └── failure/timeout log
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `EmbeddingService.embed` | `(request: EmbeddingRequest) => Promise<EmbeddingResponse>` | Batch/retry lifecycle | Logs batch boundaries, retry attempts, and completion/failure |
| `fetchJsonWithTimeout` | `(url, init, timeoutMs) => Promise<unknown>` | HTTP request lifecycle | Logs request/response timing and errors with redacted headers |
| `fetchStreamWithTimeout` | `(url, init, timeoutMs) => Promise<Response>` | Chat HTTP lifecycle | Applies same redaction strategy for consistency |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Not directly visible in UI; logs emit request/batch start events. |
| Error | Logs capture normalized failures, retries exhausted, timeout status. |
| Empty | Empty embedding input returns immediately with skip log context. |
| Success | Logs include batch count, retry usage, and total elapsed timing. |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/features/LOG-4-instrument-embeddingservice-and-provider-http-layer-with-structured-logging.md` | Story spec and acceptance criteria |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/services/EmbeddingService.ts` | Add batch lifecycle/retry timing/failure logs |
| 2 | `src/providers/embeddings/httpEmbeddingUtils.ts` | Add HTTP request/response/failure logs with header redaction |
| 3 | `src/providers/chat/httpChatUtils.ts` | Add matching HTTP lifecycle logging and header redaction |
| 4 | `src/__tests__/unit/embeddingService.resilience.test.ts` | Keep resilience behavior assertions green with instrumentation |
| 5 | `src/__tests__/unit/openaiEmbeddingProvider.test.ts` | Verify OpenAI request wiring remains stable with instrumentation |
| 6 | `README.md` | Link LOG-4 story and mark done after completion |

### Files UNCHANGED (confirm no modifications needed)

- `src/providers/embeddings/OpenAIEmbeddingProvider.ts` — request shape remains unchanged; utility handles transport logging/redaction.
- `src/providers/embeddings/OllamaEmbeddingProvider.ts` — request shape remains unchanged; utility handles transport logging/redaction.

---

## 5. Acceptance Criteria Checklist

### Phase A: EmbeddingService Batch Instrumentation

- [x] **A1** — EmbeddingService logs operation start with request metadata
  - Includes provider ID, model, input count, batch size, retry budget, timeout.
  - Evidence: `src/services/EmbeddingService.ts::A1_embedding_operation_start_logging(code-review)`

- [x] **A2** — EmbeddingService logs batch attempt timing and retry progression
  - Emits per-batch attempt start/failure/retry/completion events.
  - Evidence: `src/__tests__/unit/embeddingService.resilience.test.ts::retries_failed_provider_calls_and_succeeds_before_retry_budget_is_exhausted(vitest)`

- [x] **A3** — EmbeddingService logs terminal success/failure outcomes
  - Completion includes elapsed and batch count; exhausted retries log failure details.
  - Evidence: `src/__tests__/unit/embeddingService.resilience.test.ts::throws_EmbeddingBatchError_with_failed_indexes_when_retries_are_exhausted(vitest)`

### Phase B: Provider HTTP Layer Instrumentation

- [x] **B1** — HTTP embedding utility logs request/response timing and error outcomes
  - Includes URL, method, timeout, status, elapsed timing metadata.
  - Evidence: `src/providers/embeddings/httpEmbeddingUtils.ts::B1_http_embedding_timing_logging(code-review)`

- [x] **B2** — Authorization headers are redacted in HTTP logs
  - Any `Authorization`/credential header values are replaced with redacted placeholders.
  - Evidence: `src/providers/embeddings/httpEmbeddingUtils.ts::B2_authorization_redaction(code-review)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/services/EmbeddingService.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Story scope does not add shared-client imports.
  - Evidence: `src/providers/embeddings/httpEmbeddingUtils.ts::Z4_import_path_consistency(eslint)`
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines
  - Embedding and HTTP transport significant operations are fully instrumented.
  - Evidence: `src/services/EmbeddingService.ts::Z5_embedding_http_lifecycle_logging(code-review)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Logging headers can leak secrets if unsafely serialized | Centralize header redaction helper before emission |
| 2 | Batch-level logs increase output volume | Keep details concise and rely on log-level threshold control |
| 3 | Retry loops may produce repeated failure noise | Include attempt counters to make repeated events actionable |

---

## Implementation Order

1. `src/services/EmbeddingService.ts` — instrument operation/batch/retry lifecycle and terminal outcomes (covers A1, A2, A3).
2. `src/providers/embeddings/httpEmbeddingUtils.ts` and `src/providers/chat/httpChatUtils.ts` — add HTTP start/response/failure logs with credential redaction (covers B1, B2).
3. `src/__tests__/unit/embeddingService.resilience.test.ts` and provider tests — run to confirm existing behavior remains intact.
4. **Verify** — run targeted embedding/provider tests.
5. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-26 | Story: LOG-4 | Epic: Epic 9 — Logging and Observability Instrumentation*
