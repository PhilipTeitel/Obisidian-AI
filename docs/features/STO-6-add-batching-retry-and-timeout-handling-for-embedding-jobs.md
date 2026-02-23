# STO-6: Add batching, retry, and timeout handling for embedding jobs

**Story**: Harden embedding execution with batched requests, retry logic, and timeout controls while surfacing per-input failure details during indexing.
**Epic**: Epic 3 — Local Vector Storage and Embedding Providers
**Size**: Medium
**Status**: Done

---

## 1. Summary

This story makes embedding execution resilient enough for production indexing workloads by introducing bounded batch size, retry behavior for transient failures, and timeout enforcement for provider calls.

It also ensures failures are surfaced with enough granularity to identify which chunk/note inputs failed, rather than only returning opaque job-level errors.

The story uses safe defaults suitable for both remote APIs and slower local runtimes, while allowing explicit per-request override values.

---

## 2. API Endpoints + Schemas

No new local API endpoints are introduced.

`EmbeddingRequest` should support operational controls:

```ts
export interface EmbeddingRequest {
  providerId: ProviderId;
  model: string;
  inputs: string[];
  batchSize?: number;
  maxRetries?: number;
  timeoutMs?: number;
}
```

Failure metadata type for surfaced per-input errors:

```ts
export interface EmbeddingInputFailure {
  inputIndex: number;
  message: string;
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
IndexingService
└── EmbeddingService
    ├── split inputs into batches
    ├── execute provider calls with timeout
    ├── retry transient failures
    └── throw structured batch failure with input indexes
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `EmbeddingService.embed` | `(request: EmbeddingRequest) => Promise<EmbeddingResponse>` | Batch loop | Handles batching/retries/timeout and vector reassembly |
| `EmbeddingBatchError` | error object with `failedInputIndexes` | N/A | Surfaces failed indexes for upstream job-context mapping |
| `IndexingService.embedChunkContent` | internal helper | N/A | Maps failure indexes to chunk IDs/note paths for actionable errors |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Progress snapshots continue through embed stage |
| Error   | Batch failures include failed input/chunk context in error details |
| Empty   | Empty input list returns immediately with no provider calls |
| Success | All batch responses merged into a complete, ordered vector output |

No direct frontend component changes are required.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/services/errors/EmbeddingBatchError.ts` | Structured error for failed embedding batch inputs |
| 2 | `src/__tests__/unit/embeddingService.resilience.test.ts` | Tests for batching, retry, timeout, and failure mapping |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Extend embedding request contract with batch/retry/timeout controls |
| 2 | `src/services/EmbeddingService.ts` | Implement batching/retry/timeout orchestration |
| 3 | `src/services/IndexingService.ts` | Surface per-chunk failure context when embed stage fails |
| 4 | `src/__tests__/unit/services.runtime.test.ts` | Update runtime tests for new embedding behavior |

### Files UNCHANGED (confirm no modifications needed)

- `src/ui/SearchView.ts` — UI-only behavior unchanged
- `src/ui/ChatView.ts` — chat behavior not impacted by embedding job resilience
- `src/main.ts` — command definitions and notices remain unchanged

---

## 5. Acceptance Criteria Checklist

### Phase A: Batch + Retry + Timeout

- [x] **A1** — Embedding requests execute in bounded batches
  - Default batch size is safe and finite for MVP workloads.
  - Batch outputs are merged into original input order.

- [x] **A2** — Transient failures are retried up to configured maximum
  - Retry attempts are bounded and deterministic.
  - Exhausted retries throw clear provider/runtime error details.

- [x] **A3** — Timeout is enforced per provider call
  - Long-running provider calls are aborted/failed by timeout.
  - Timeout value uses safe default and supports per-request override.

### Phase B: Failure Visibility

- [x] **B1** — Embedding failures surface failed input indexes
  - Batch error includes concrete failed input index list.
  - Upstream callers can map failures to chunk/note context.

- [x] **B2** — Indexing errors include actionable chunk/note details
  - Embed-stage failures identify impacted chunks or notes in thrown error text.
  - Job failure snapshots remain consistent with existing indexing command flow.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Over-aggressive retries can increase runtime latency | Keep conservative default retry count and bounded timeout |
| 2 | Timeout enforcement strategy may differ by provider implementation | Implement service-level timeout wrapper independent of provider internals |
| 3 | Failure detail expansion can leak too much internal context | Include chunk/note identifiers only, not raw content bodies |

---

## Implementation Order

1. `src/types.ts` — add batch/retry/timeout request options and failure metadata types (covers A1-A3, B1).
2. `src/services/errors/EmbeddingBatchError.ts` — define structured failure error carrying failed indexes (covers B1).
3. `src/services/EmbeddingService.ts` — implement batched execution, retries, and timeout behavior (covers A1-A3).
4. `src/services/IndexingService.ts` — map failed indexes to chunk IDs/note paths in embed-stage failures (covers B2).
5. `src/__tests__/unit/embeddingService.resilience.test.ts` + runtime updates — validate resilience paths end-to-end (covers A1-A3, B1-B2).
6. **Final verify** — run `npm run test && npm run lint && npm run build` (covers Z1-Z4).

---

*Created: 2026-02-23 | Story: STO-6 | Epic: Epic 3 — Local Vector Storage and Embedding Providers*
