# SRV-4: Structured logging — Pino, `runId` / `jobId`, redaction

**Story**: Replace ad-hoc **`console.*`** in **`src/sidecar/**`** (except stdout protocol writes) with **Pino** per [ADR-010](../decisions/ADR-010-structured-logging-sidecar.md) and [README §20](../../README.md#20-logging-and-observability): **child loggers** with **`runId`**, **`jobId`**, **`scope`**; **stderr** output; level from **`OBSIDIAN_AI_LOG_LEVEL`**; never log **apiKey**, note **content**, or raw vectors.
**Epic**: 7 — Sidecar server, routes, and observability
**Size**: Medium
**Status**: Complete

---

## 1. Summary

Centralize **`createSidecarLogger()`** (or similar) in `src/sidecar/logging/logger.ts`. Wire **IndexWorkflow**/**JobStepService**/**routes** to pass contextual children where feasible. **Development:** optional `pino-pretty` via **devDependency** and env flag (no pretty in production path).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [ADR-010](../decisions/ADR-010-structured-logging-sidecar.md) | Pino, stderr, levels, redaction rules. |

---

## 3. Definition of Ready (DoR)

- [x] ADR-010 **Accepted**
- [x] README §20 alignment
- [x] Section 4 filled
- [x] Phase Y non-mock evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Sidecar application logs go to **stderr** via **Pino** (not stdout).
2. **Y2** — Default level **`info`**; override via **`OBSIDIAN_AI_LOG_LEVEL`**.
3. **Y3** — Do not log **`apiKey`**, full **`content`** fields from index payloads, or embedding arrays.
4. **Y4** — Index/search/chat **info** logs include **operation name** and **duration** or **counts** where practical (per README §20).

---

## 5. API Endpoints + Schemas

(n/a)

---

## 6. Frontend Flow

(n/a)

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/sidecar/logging/logger.ts` | `createSidecarLogger`, level from env |
| 2 | `src/sidecar/logging/logger.test.ts` | Level parsing |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `package.json` | `pino` dependency; `pino-pretty` devDependency optional |
| 2 | `src/sidecar/**` | Replace `console.warn`/`console.debug` in server paths with logger |

---

## 8. Acceptance Criteria Checklist

### Phase A

- [x] **A1** — `createSidecarLogger()` produces a logger that respects `OBSIDIAN_AI_LOG_LEVEL=error` (info logs not emitted — use sink test or pino test helper).
  - Evidence: `src/sidecar/logging/logger.test.ts::A1_log_level_env(vitest)`

### Phase Y

- [x] **Y1** — **(binding)** `package.json` **`dependencies`** includes **`pino`**.
  - Evidence: `rg '"pino"' package.json`

- [x] **Y2** — **(binding)** `rg "console\\.log" src/sidecar` shows **no** production-path logs to stdout (stdio write helpers exempted if named `writeLine`).
  - Evidence: `rg "console\\.log" src/sidecar` (document allowed files in story if any)

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — No `any`
- [x] **Z4** — **N/A**
- [x] **Z5** — Satisfied by Pino adoption

---

## 9. Risks & Tradeoffs

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Bundle size | esbuild bundles pino; acceptable for sidecar. |

---

## Implementation Order

1. Add `pino` to `package.json`.
2. `logger.ts` + test **A1**.
3. Thread logger through `SidecarRuntime`, routes, replace `console` in `IndexWorkflow` sidecar-only calls (if any from sidecar copy—actually IndexWorkflow is core; only sidecar entry adapts). **Note:** `IndexWorkflow.ts` uses `console.warn` — SRV-4 may inject logger via wrapper or leave core unchanged; **prefer** sidecar-only logging in `SidecarRuntime` worker catch that logs failures (**Z5**).

---

*Created: 2026-04-05 | Story: SRV-4 | Epic: 7 — Sidecar server, routes, and observability*
