# SRV-5: `ProgressAdapter` — push path for `IndexProgressEvent`

**Story**: Implement **`IProgressPort`** in the sidecar as a **`ProgressAdapter`** that forwards **`emit()`** to all registered sinks: **stdio push lines** and **WebSocket clients** (SRV-2), so `JobStepService` progress reaches the plugin **in real time** ([README ProgressSlideout](../../README.md#progressslideout)).
**Epic**: 7 — Sidecar server, routes, and observability
**Size**: Medium
**Status**: Complete

---

## 1. Summary

`JobStepService` already calls `IProgressPort.emit` ([QUE-2](QUE-2.md)). This story introduces **`ProgressAdapter`** implementing **`IProgressPort`**: thread-safe (single-threaded Node) list of **(a)** a callback that **writes NDJSON push** to stdout, and **(b)** **WS broadcast** function when HTTP mode is active.

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [ADR-008](../decisions/ADR-008-idempotent-indexing-state-machine.md) | Progress events per step transition. |
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md) | Push path for both transports. |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs **Accepted**
- [x] Section 4 filled
- [x] Phase Y non-mock evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `emit` must **never throw** to callers (swallow/log sink errors).
2. **Y2** — Stdio push line format: `{ channel: 'push', type: 'progress', event: IndexProgressEvent }` (JSON one line).
3. **Y3** — WebSocket message JSON matches `{ type: 'progress', event: IndexProgressEvent }`.

---

## 5. API Endpoints + Schemas

(n/a — uses existing `ProgressEvent` type)

---

## 6. Frontend Flow

(n/a)

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/sidecar/adapters/ProgressAdapter.ts` | `IProgressPort` impl |
| 2 | `src/sidecar/adapters/ProgressAdapter.test.ts` | Sink invocation |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/sidecar/runtime/SidecarRuntime.ts` | Construct `ProgressAdapter`, pass to `JobStepService` |

---

## 8. Acceptance Criteria Checklist

### Phase A

- [x] **A1** — Calling `emit` on `ProgressAdapter` invokes registered stdout callback with serialized event containing `jobId`, `runId`, `notePath`, `step`.
  - Evidence: `src/sidecar/adapters/ProgressAdapter.test.ts::A1_stdout_sink(vitest)`

- [x] **A2** — Second sink (WS mock) receives same event when registered.
  - Evidence: `src/sidecar/adapters/ProgressAdapter.test.ts::A2_dual_sink(vitest)`

### Phase Y

- [x] **Y1** — **(binding)** `JobStepService` in runtime uses **`ProgressAdapter`** instance (grep `new JobStepService` in sidecar).
  - Evidence: `rg "new JobStepService" src/sidecar`

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — No `any`
- [x] **Z4** — **N/A**
- [x] **Z5** — Sink errors logged via SRV-4 logger

---

## 9. Risks & Tradeoffs

| # | Risk | Mitigation |
|---|------|------------|
| 1 | stdout flooding | Document; future backpressure in PLG. |

---

## Implementation Order

1. `ProgressAdapter.ts` + tests.
2. Wire `SidecarRuntime` → `JobStepService`.
3. Ensure stdio server registers push writer.

---

*Created: 2026-04-05 | Story: SRV-5 | Epic: 7 — Sidecar server, routes, and observability*
