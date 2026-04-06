# PLG-3: `HttpTransportAdapter` (REST + WS)

**Story**: When **`transport === 'http'`**, implement **`ISidecarTransport`** using **`fetch`** + **`WebSocket`** to the URL/token emitted by the sidecar on stderr (PLG-1 parses and stores).
**Epic**: 8 — Plugin client, settings, secrets, and vault I/O
**Size**: Large
**Status**: Complete

---

## 1. Summary

SRV-2 maps routes; plugin mirrors: Bearer on REST; WS `?token=` for pushes; chat NDJSON stream from `POST /chat`.

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md) | HTTP opt-in; 127.0.0.1 + token. |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs **Accepted**
- [x] Section 4 filled
- [x] Phase Y non-mock evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Only connect to **`127.0.0.1`** (reject other hosts from parsed URL).
2. **Y2** — **`AbortSignal`** aborts fetch/WS for chat ([ADR-009](../decisions/ADR-009-chat-cancellation-and-timeout.md)).

---

## 5. API Endpoints + Schemas

(n/a)

---

## 6. Frontend Flow

(n/a)

---

## 7. File Touchpoints

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/plugin/client/HttpTransportAdapter.ts` | ISidecarTransport |
| 2 | `src/plugin/client/HttpTransportAdapter.test.ts` | mock fetch (minimal) |

---

## 8. Acceptance Criteria Checklist

### Phase A

- [x] **A1** — `send` health uses `Authorization: Bearer` and parses JSON body.
  - Evidence: `src/plugin/client/HttpTransportAdapter.test.ts::A1_health_fetch(vitest)` or manual integration note in test skip

### Phase Y

- [x] **Y1** — **(binding)** Rejects base URL not starting with `http://127.0.0.1`.
  - Evidence: `src/plugin/client/HttpTransportAdapter.test.ts::Y1_localhost_only(vitest)`

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — No `any`
- [x] **Z4** — **N/A**
- [x] **Z5** — N/A

---

## 9. Risks & Tradeoffs

| # | Risk | Mitigation |
|---|------|------------|
| 1 | WS in Obsidian Electron | Use browser WebSocket API. |

---

## Implementation Order

1. Parse token/url from stderr in lifecycle
2. HttpTransportAdapter
3. Tests

---

*Created: 2026-04-05 | Story: PLG-3 | Epic: 8*
