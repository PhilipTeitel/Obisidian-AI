# SRV-3: `health` route — `dbReady`, `uptime`, startup handshake

**Story**: Ensure **`health`** responses match [README API Contract](../../README.md#sidecar-message-protocol): `{ status: 'ok', uptime, dbReady }` where **`dbReady`** is **true** iff the SQLite database has been successfully opened and migrated (lazy init complete), and **`uptime`** is process uptime in **seconds** (or ms—**pick one**, document in type; align `HealthResponse` in [types.ts](../../src/core/domain/types.ts) if README and type disagree).
**Epic**: 7 — Sidecar server, routes, and observability
**Size**: Small
**Status**: Open

---

## 1. Summary

Plugin startup budget ([README §15](../../README.md#15-startup-performance)) requires **async health**: sidecar can report **`dbReady: false`** before first storage touch, then **`true`** after lazy open. This story aligns **stdio + HTTP** health handlers and the shared **`HealthResponse`** type.

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [ADR-004](../decisions/ADR-004-per-vault-index-storage.md) | Lazy DB → `dbReady` reflects open state. |
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md) | Same payload stdio/HTTP. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs **Accepted**
- [ ] No README/requirements contradiction on `health` fields
- [ ] Section 4 filled
- [ ] Phase Y non-mock evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `dbReady === false` until lazy init succeeds; **`true`** after first successful open (even if DB file was newly created).
2. **Y2** — `status` is literal **`'ok'`** when the process is accepting requests (sidecar alive).
3. **Y3** — `uptime` is monotonic wall time since sidecar start, same unit as documented in `HealthResponse`.

---

## 5. API Endpoints + Schemas

Update `HealthResponse` if needed:

```ts
export interface HealthResponse {
  status: 'ok';
  /** Seconds since sidecar process start. */
  uptime: number;
  dbReady: boolean;
}
```

---

## 6. Frontend Flow

(n/a)

---

## 7. File Touchpoints

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/domain/types.ts` | JSDoc / unit for `uptime` |
| 2 | `src/sidecar/runtime/SidecarRuntime.ts` | Expose `isDbReady()`, `getUptimeSeconds()` |
| 3 | `src/sidecar/stdio/stdioServer.ts` + `http` | Health handler uses runtime |

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/sidecar/runtime/health.test.ts` | dbReady transitions |

---

## 8. Acceptance Criteria Checklist

### Phase A

- [ ] **A1** — Before any DB operation, `health` returns `dbReady: false` and numeric `uptime >= 0`.
  - Evidence: `src/sidecar/runtime/health.test.ts::A1_db_not_ready_initially(vitest)`

- [ ] **A2** — After successful lazy open (or `openDatabase` in test), `health` returns `dbReady: true`.
  - Evidence: `src/sidecar/runtime/health.test.ts::A2_db_ready_after_open(vitest)`

### Phase Y

- [ ] **Y1** — **(binding)** `HealthResponse` in `types.ts` documents `uptime` unit; `npm run typecheck` passes.
  - Evidence: `npm run typecheck`

### Phase Z

- [ ] **Z1** — `npm run build` passes
- [ ] **Z2** — `npm run lint` passes
- [ ] **Z3** — No `any`
- [ ] **Z4** — **N/A**
- [ ] **Z5** — N/A minimal

---

## 9. Risks & Tradeoffs

| # | Risk | Mitigation |
|---|------|------------|
| 1 | README silent on uptime unit | Use seconds; one-line README tweak optional in DOC-2. |

---

## Implementation Order

1. `types.ts` JSDoc.
2. `SidecarRuntime` state flags.
3. Route handlers.
4. Tests **A1–A2**.

---

*Created: 2026-04-05 | Story: SRV-3 | Epic: 7 — Sidecar server, routes, and observability*
