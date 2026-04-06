# PLG-1: `SidecarLifecycle` — spawn, async health, shutdown on unload

**Story**: Implement **`SidecarLifecycle`** in the plugin that spawns the sidecar with **`child_process.spawn`**, passes **environment** ([README Plugin Settings](../../README.md#plugin-settings) + `OBSIDIAN_AI_*` from PLG-4), resolves **async health** (first successful `health` RPC without blocking `onload` beyond the [§15](../../README.md#15-startup-performance) budget), and **kills** the child on plugin unload.
**Epic**: 8 — Plugin client, settings, secrets, and vault I/O
**Size**: Medium
**Status**: Complete

---

## 1. Summary

ADR-006 requires a **thin plugin** that owns process lifecycle. The sidecar entry is **`dist/sidecar/server.js`** relative to the plugin folder (same layout as [README Project Structure](../../README.md#project-structure)); `OBSIDIAN_AI_DB_PATH` and provider env vars are set before spawn (PLG-4).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md) | Sidecar process; plugin spawns Node sidecar. |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs exist and are **Accepted**
- [x] README, requirements, and ADRs do not contradict each other
- [x] Section 4 filled
- [x] Phase Y includes non-mock evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Use **`node`** from `process.execPath` (or `NODE` env) + absolute path to **`server.js`** under the plugin directory.
2. **Y2** — **Never** spawn if `isDesktopOnly` assumption violated — `manifest.json` stays desktop-only.
3. **Y3** — On `onunload`, **SIGTERM** (or `kill`) the child; close stdin/stdout.
4. **Y4** — Health check does **not** open the vault DB on the sidecar before first user index if `OBSIDIAN_AI_DB_PATH` is valid — sidecar `health` returns `dbReady` per SRV-3.

---

## 5. API Endpoints + Schemas

Internal TypeScript only; wire to transport in PLG-2/3.

---

## 6. Frontend Flow

Not applicable (lifecycle only).

### 6a–6c

(n/a)

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/plugin/client/SidecarLifecycle.ts` | spawn, env, health promise, shutdown |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/plugin/main.ts` | construct lifecycle + transport |

---

## 8. Acceptance Criteria Checklist

### Phase A

- [x] **A1** — `SidecarLifecycle.start()` resolves only after **health ok** (stdio `send` or HTTP fetch); verified via **StdioTransportAdapter** round-trip plus manual spawn in dev.
  - Evidence: `src/plugin/client/StdioTransportAdapter.test.ts::A1_health_roundtrip(vitest)` + `SidecarLifecycle` used from `main.ts`

### Phase Y

- [x] **Y1** — **(binding)** `rg "child_process" src/plugin` shows only `SidecarLifecycle` (or documented client files), not `src/core`.
  - Evidence: `rg "child_process" src/core` exits 1

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — No `any` in new files
- [x] **Z4** — **N/A** (`@shared/types`)
- [x] **Z5** — Log spawn errors to console in dev-friendly form

---

## 9. Risks & Tradeoffs

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Missing `dist/sidecar` in user install | Document `npm run build`; optional notice in settings. |

---

## Implementation Order

1. `SidecarLifecycle.ts`
2. Tests with mocked `spawn`
3. Wire `main.ts`

---

*Created: 2026-04-05 | Story: PLG-1 | Epic: 8*
