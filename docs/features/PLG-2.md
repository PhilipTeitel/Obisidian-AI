# PLG-2: `StdioTransportAdapter` (NDJSON)

**Story**: Implement **`ISidecarTransport`** for **stdio**: one JSON object per line on stdin; read stdout lines demuxing **RPC** (`id` + `body` / `error`) and **push** (`channel: push`).
**Epic**: 8 — Plugin client, settings, secrets, and vault I/O
**Size**: Medium
**Status**: Complete

---

## 1. Summary

Parity with SRV-1 framing. **`send`** maps to RPC lines; **`streamChat`** consumes push chunks until terminal `{ id, done, sources }`.

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                     | Why it binds this story  |
| ------------------------------------------------------- | ------------------------ |
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md) | Default stdio transport. |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs **Accepted**
- [x] Section 4 filled
- [x] Phase Y non-mock evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Implement **`ISidecarTransport`** in `src/plugin/client/` only.
2. **Y2** — Use **`SidecarRequest` / `SidecarResponse`** types from **`src/core/domain/types.ts`** (bundled).
3. **Y3** — **Chat** must forward **`AbortSignal`** to stop reading early ([ADR-009](../decisions/ADR-009-chat-cancellation-and-timeout.md)).

---

## 5. API Endpoints + Schemas

(n/a)

---

## 6. Frontend Flow

(n/a)

---

## 7. File Touchpoints

| #   | Path                                                | Purpose           |
| --- | --------------------------------------------------- | ----------------- |
| 1   | `src/plugin/client/StdioTransportAdapter.ts`        | ISidecarTransport |
| 2   | `tests/plugin/client/StdioTransportAdapter.test.ts` | mock streams      |

---

## 8. Acceptance Criteria Checklist

### Phase A

- [x] **A1** — `send({ type: 'health' })` resolves with `HealthResponse` against mock stdout.
  - Evidence: `tests/plugin/client/StdioTransportAdapter.test.ts::A1_health_roundtrip(vitest)`

### Phase Y

- [x] **Y1** — **(binding)** `npm run verify:core-imports` — plugin may import `core/domain` types; core must not import plugin.
  - Evidence: `npm run verify:core-imports`

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — No `any`
- [x] **Z4** — **N/A**
- [x] **Z5** — N/A

---

## 9. Risks & Tradeoffs

| #   | Risk                      | Mitigation    |
| --- | ------------------------- | ------------- |
| 1   | Line buffer fragmentation | Use readline. |

---

## Implementation Order

1. Adapter + demux loop
2. Tests
3. Wire lifecycle stdin/stdout

---

_Created: 2026-04-05 | Story: PLG-2 | Epic: 8_
