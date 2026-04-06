# SRV-2: HTTP adapter — REST + WebSocket progress

**Story**: Add an **opt-in HTTP surface** on **`127.0.0.1`** with a **random port** and **per-session Bearer token** ([ADR-006](../decisions/ADR-006-sidecar-architecture.md)), exposing the same operations as stdio: **REST** routes mirroring message types and a **WebSocket** for **`progress`** and **chat** streaming chunks. Auth: `Authorization: Bearer <token>` on every HTTP request; WebSocket subprotocol or first message may carry token (document chosen approach in code).
**Epic**: 7 — Sidecar server, routes, and observability
**Size**: Medium
**Status**: Open

---

## 1. Summary

When `OBSIDIAN_AI_HTTP_PORT` is set to a non-empty value **or** a dedicated flag/env enables HTTP mode, the sidecar starts **`node:http`** server bound to **127.0.0.1** only. **Stdio mode** remains the default when HTTP is not enabled. REST paths mirror [README API Contract](../../README.md#sidecar-message-protocol): e.g. `POST /index/full`, `POST /index/incremental`, `GET /index/status`, `POST /search`, `POST /chat` (streaming via SSE or WS), `POST /chat/clear`, `GET /health`.

**Token:** On startup, generate `randomUUID()` session token; print `OBSIDIAN_AI_SESSION_TOKEN=<token>` and `OBSIDIAN_AI_HTTP_URL=http://127.0.0.1:<port>` to **stderr** (PLG-1 parses for HttpTransportAdapter).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md) | 127.0.0.1, random port, Bearer token, parity with stdio payloads. |
| [ADR-009](../decisions/ADR-009-chat-cancellation-and-timeout.md) | Chat streaming + `AbortSignal` on disconnect. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted**
- [ ] README, requirements, and ADRs do not contradict each other
- [ ] Section 4 filled
- [ ] Phase Y includes non-mock evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Listen only **`127.0.0.1`** (not `0.0.0.0`).
2. **Y2** — All REST endpoints require **`Authorization: Bearer <token>`**; missing/invalid → **401** JSON body.
3. **Y3** — Request/response JSON bodies match **stdio** payload/body shapes (same TypeScript types).
4. **Y4** — Progress events delivered over **WebSocket** as JSON `{ type: 'progress', event: IndexProgressEvent }` (and chat chunks similarly).
5. **Y5** — Dependency: add **`ws`** (and types) for WebSocket server; keep **`better-sqlite3`** external in esbuild.

---

## 5. API Endpoints + Schemas

| Method | Path | Auth | Body / response |
|--------|------|------|-----------------|
| POST | `/index/full` | Bearer | `IndexFullRequest` → `IndexRunAck` |
| POST | `/index/incremental` | Bearer | `IndexIncrementalRequest` → `IndexRunAck` |
| GET | `/index/status` | Bearer | → `IndexStatusResponse` |
| POST | `/search` | Bearer | `SearchRequest` → `SearchResponse` |
| POST | `/chat` | Bearer | stream (WS or SSE) per implementation note in §1 |
| POST | `/chat/clear` | Bearer | → `{ ok: true }` |
| GET | `/health` | Bearer | → `HealthResponse` |
| GET | `/ws` | Bearer (query `token=` or header upgrade) | WebSocket for push |

---

## 6. Frontend Flow

Not applicable.

### 6a–6c

(n/a)

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/sidecar/http/httpServer.ts` | HTTP + WS wiring |
| 2 | `src/sidecar/http/httpServer.test.ts` | Auth + one route smoke |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/sidecar/server.ts` | Branch: stdio vs HTTP from env |
| 2 | `package.json` | Add `ws` + `@types/ws` |
| 3 | `esbuild.sidecar.mjs` | External `ws` if not bundled |

---

## 8. Acceptance Criteria Checklist

### Phase A: Security + binding

- [ ] **A1** — Server binds to **127.0.0.1** only (assert in test via listen address or connection refusal to non-local).
  - Evidence: `src/sidecar/http/httpServer.test.ts::A1_localhost_only(vitest)`

- [ ] **A2** — Request without Bearer returns **401** for a protected route.
  - Evidence: `src/sidecar/http/httpServer.test.ts::A2_bearer_required(vitest)`

### Phase B: Parity

- [ ] **B1** — `GET /health` with valid token returns JSON matching `HealthResponse` shape.
  - Evidence: `src/sidecar/http/httpServer.test.ts::B1_health_json(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** `package.json` lists **`ws`** in `dependencies`.
  - Evidence: `rg '"ws"' package.json`

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes
- [ ] **Z2** — `npm run lint` passes
- [ ] **Z3** — No `any` in new files
- [ ] **Z4** — **N/A** (`@shared/types`)
- [ ] **Z5** — Appropriate logging (SRV-4) or stderr until then

---

## 9. Risks & Tradeoffs

| # | Risk | Mitigation |
|---|------|------------|
| 1 | SSE vs WS for chat | Pick one in implementation; document in README row if needed. |

---

## Implementation Order

1. Add `ws` dependency.
2. `httpServer.ts` — create server, auth middleware, mount routes delegating to same handlers as stdio (`SidecarRuntime`).
3. `server.ts` — env gate.
4. Tests **A1–B1**.
5. `npm run build` + full tests.

---

*Created: 2026-04-05 | Story: SRV-2 | Epic: 7 — Sidecar server, routes, and observability*
