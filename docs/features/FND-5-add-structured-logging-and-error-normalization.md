# FND-5: Add structured logging and error normalization

**Story**: Introduce a shared runtime logger and normalized error model so provider/network/storage failures surface as actionable diagnostics for users and maintainers.
**Epic**: Epic 1 — Plugin Foundation and Runtime Shell
**Size**: Small
**Status**: Done

---

## 1. Summary

This story adds the error and logging foundation needed for reliable runtime operations. The current shell primarily uses ad-hoc `console.error` calls and raw error messages, which makes failures harder to classify and troubleshoot. FND-5 introduces a structured logging contract and a normalization path that converts unknown thrown values into consistent, typed runtime errors.

The story is a direct dependency for provider, storage, and reliability stories in later epics. As real OpenAI/Ollama calls, vector storage operations, and job orchestration land, those stories need one place to capture error domain (provider/network/storage), severity, retryability, and user-facing messaging. Without that baseline, each service risks inventing inconsistent failure handling and notices.

The guiding constraint is actionable observability without overbuilding. The implementation should remain lightweight for the MVP shell: typed log events, deterministic normalization rules, and clear user notices that recommend next actions (for example, check provider settings, endpoint reachability, or local storage permissions).

---

## 2. API Endpoints + Schemas

No external API endpoint changes are needed for this story.

This project is an Obsidian plugin runtime, so FND-5 only introduces internal TypeScript contracts (exported from `src/types.ts`) and utility helpers for logging/normalization.

```ts
export type RuntimeErrorDomain = "provider" | "network" | "storage" | "runtime";

export interface NormalizedRuntimeError {
  domain: RuntimeErrorDomain;
  code: string;
  message: string; // developer-facing detail
  userMessage: string; // notice-safe actionable text
  retryable: boolean;
  cause?: unknown;
  context?: Record<string, string | number | boolean | null | undefined>;
}

export type RuntimeLogLevel = "debug" | "info" | "warn" | "error";

export interface RuntimeLogEvent {
  level: RuntimeLogLevel;
  event: string;
  message: string;
  domain?: RuntimeErrorDomain;
  context?: Record<string, string | number | boolean | null | undefined>;
  error?: NormalizedRuntimeError;
}

export interface RuntimeLoggerContract {
  log(event: RuntimeLogEvent): void;
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
ObsidianAIPlugin (src/main.ts)
├── onload()
│   ├── bootstrapRuntimeServices(context)
│   │   ├── runtime logger emits lifecycle events
│   │   └── normalize error on bootstrap/init failure
│   └── notice uses normalized.userMessage
├── command callbacks
│   └── runIndexCommand()
│       ├── log command start/success/failure
│       └── normalize provider/network/storage/runtime errors
└── onunload()
    ├── ServiceContainer.dispose()
    │   └── logs structured disposal failures by service name
    └── leaf detach failures normalized and logged
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `normalizeRuntimeError` | `(error: unknown, context?: Record<string, unknown>) => NormalizedRuntimeError` | Pure stateless utility | Maps thrown values into domain/code/retryable/userMessage contracts |
| `createRuntimeLogger` | `(scope: string) => RuntimeLoggerContract` | Stateless wrapper | Emits structured payloads to console in a consistent shape for MVP |
| `ObsidianAIPlugin.runIndexCommand` | Existing method with normalized error path | Command lifecycle state | Replaces raw string interpolation with normalized notices/log metadata |
| `bootstrapRuntimeServices` | Existing bootstrap function | Initialization order + partial cleanup | Logs init/dispose failures with structured fields (`service`, `phase`) |
| `ServiceContainer.dispose` | Existing `dispose()` | Disposed / not disposed | Emits one structured error event per failed service disposal |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Startup/command execution logs `info` events with operation context; UI behavior remains shell-level |
| Error   | User sees normalized actionable message (provider/network/storage/runtime specific) and logs include structured error metadata |
| Empty   | Placeholder service responses continue unchanged, but log output still follows structured format |
| Success | Command/bootstrap success events are logged consistently without user-facing regression |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/logging/runtimeLogger.ts` | Provide default structured logger implementation (`RuntimeLoggerContract`) for plugin/runtime services |
| 2 | `src/errors/normalizeRuntimeError.ts` | Convert unknown errors into `NormalizedRuntimeError` with provider/network/storage/runtime domains |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Add normalized error and structured log type contracts used across runtime shell |
| 2 | `src/main.ts` | Replace ad-hoc `console.error` and raw notices with normalized error + structured logger usage in `onload`, command execution, and unload helpers |
| 3 | `src/bootstrap/bootstrapRuntimeServices.ts` | Add structured lifecycle logs and normalization for init/dispose failures during bootstrap |
| 4 | `src/services/ServiceContainer.ts` | Emit structured disposal failure events instead of aggregated unstructured `console.error` strings |
| 5 | `src/__tests__/smoke.test.ts` | Add/extend tests for normalization behavior and source-level integration points |
| 6 | `README.md` | Update backlog row for `FND-5` to link to this story doc |

### Files UNCHANGED (confirm no modifications needed)

- `src/ui/SearchView.ts` — UI rendering behavior is outside FND-5 scope; this story only normalizes runtime error/log plumbing
- `src/ui/ChatView.ts` — no chat UI contract change required for logging/error normalization foundation
- `src/settings.ts` — settings schema validation and secret management belong to CFG stories, not FND-5

---

## 5. Acceptance Criteria Checklist

### Phase A: Shared Contracts and Utilities

- [x] **A1** — Runtime error and log schemas are explicitly typed
  - `RuntimeErrorDomain`, `NormalizedRuntimeError`, `RuntimeLogEvent`, and `RuntimeLoggerContract` are exported from `src/types.ts`.
  - New/modified files avoid `any` and use typed context/value unions.

- [x] **A2** — Error normalization utility returns actionable classification
  - `normalizeRuntimeError` always returns a non-empty `code`, `message`, and `userMessage`.
  - Classification covers provider/network/storage/runtime domains with deterministic fallback behavior.

### Phase B: Runtime Integration

- [x] **B1** — Plugin lifecycle paths emit structured logs
  - `onload`, command execution, and `onunload` paths log with consistent event names and contextual metadata.
  - Raw one-off `console.error("...", error)` calls in these paths are replaced by structured log events.

- [x] **B2** — User-facing failures are normalized and actionable
  - Command/bootstrap failures surface `userMessage` text that tells users what to check next.
  - Failed command snapshots still include `errorMessage`, but the value derives from normalized errors.

- [x] **B3** — Bootstrap/container failure logging includes service-level context
  - Partial initialization/disposal failures capture service name and phase (`init` vs `dispose`) in structured logs.
  - A failure in one service cleanup does not prevent subsequent cleanup attempts.

### Phase C: Regression Safety

- [x] **C1** — Existing shell behavior remains stable
  - Existing command IDs, view registration, and shell placeholders remain unchanged.
  - No new startup-heavy work is introduced during plugin load.

- [x] **C2** — Tests cover normalization and integration seams
  - Tests assert normalization output for representative provider/network/storage/runtime errors.
  - Tests verify runtime shell source still includes lifecycle wiring while using normalized/logged error paths.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Overly broad normalization heuristics can misclassify edge-case errors | Keep classifier rule order explicit and default to `runtime` with preserved original message/cause |
| 2 | Structured logs can become noisy if every path logs at `error` level | Define event naming + level conventions (`info` for lifecycle milestones, `error` only on failures) |
| 3 | User-facing messages may hide useful developer details | Split `userMessage` and `message`; log full normalized payload while keeping notices concise |
| 4 | Later provider/storage stories may require more error codes than initial schema | Use extensible string `code` values and domain-based contracts to avoid schema churn |

---

## Implementation Order

1. `src/types.ts` — add normalized error and logger contracts used by runtime shell modules (covers A1).
2. `src/errors/normalizeRuntimeError.ts` — implement deterministic classification and fallback logic for unknown thrown values (covers A2).
3. `src/logging/runtimeLogger.ts` — implement structured logger wrapper and shared context/event helpers (covers B1).
4. `src/bootstrap/bootstrapRuntimeServices.ts` and `src/services/ServiceContainer.ts` — instrument init/dispose error paths with normalized structured logs (covers B3).
5. `src/main.ts` — route bootstrap/command/unload error handling through normalization + actionable notices (covers B1, B2, C1).
6. `src/__tests__/smoke.test.ts` — add normalization classification tests and source-level assertions for integration points (covers C2).
7. **Verify** — run `npm run build`, `npm run lint`, and `npm run test` to confirm no regressions and typed contracts (covers Z1, Z2, Z3).
8. **Final verify** — manually trigger command failure paths in a test vault (provider endpoint unavailable, storage-like failure simulation) and confirm notice + log quality (covers B2, B3, Phase Z).

---

*Created: 2026-02-21 | Story: FND-5 | Epic: Epic 1 — Plugin Foundation and Runtime Shell*
