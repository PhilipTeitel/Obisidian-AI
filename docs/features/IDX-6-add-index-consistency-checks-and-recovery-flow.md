# IDX-6: Add index consistency checks and recovery flow

**Story**: Add preflight consistency validation and recovery behavior so indexing can detect corrupt/stale state, repair safely, and resume without manual intervention.
**Epic**: Epic 2 — Indexing and Metadata Pipeline
**Size**: Small
**Status**: Done

---

## 1. Summary

This story hardens the indexing pipeline by validating persisted indexing metadata before work starts and by recovering from incomplete or inconsistent prior runs. The goal is to keep indexing reliable when plugin shutdowns, partial failures, or data-shape drift occur.

IDX-6 depends on IDX-4 manifest persistence and IDX-5 job-state persistence. It is the safety layer that ensures those persisted artifacts remain trustworthy and that stale state does not permanently block new indexing commands.

The guiding constraint is fail-safe behavior over perfect repair: when consistency cannot be proven, the system should prefer conservative recovery (for example, fallback to full reindex baseline) rather than risk silently skipping content.

---

## 2. API Endpoints + Schemas

No external API endpoint changes are needed for this story.

This repository is an Obsidian plugin and does not use `shared/types.ts`; IDX-6 type additions should be defined in `src/types.ts`.

The following NEW interfaces should be introduced to describe consistency checks:

```ts
export interface IndexConsistencyIssue {
  code: "STALE_ACTIVE_JOB" | "MANIFEST_SHAPE_INVALID" | "MANIFEST_VERSION_UNSUPPORTED";
  message: string;
  recoverable: boolean;
}

export interface IndexConsistencyReport {
  ok: boolean;
  issues: IndexConsistencyIssue[];
  requiresFullReindexBaseline: boolean;
}
```

If no new exported types are introduced, equivalent internal contracts must still be documented in code comments/tests.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Index command callback (main.ts)
└── IndexingService.reindexVault()/indexChanges()
    ├── runConsistencyPreflight()
    │   ├── validate IndexManifestStore payload
    │   └── validate IndexJobStateStore active-job lifecycle
    ├── applyRecoveryActions()
    │   ├── clear stale active job markers
    │   └── fallback baseline mode when manifest is unusable
    └── continue indexing workflow with recovered state
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `runConsistencyPreflight` | `() => Promise<IndexConsistencyReport>` | Read-only validation state | Runs before each indexing command execution |
| `applyRecoveryActions` | `(report) => Promise<void>` | Persistent correction state | Clears stale active jobs, resets incompatible manifest state |
| `IndexingService.indexChanges` | `(...options) => Promise<JobSnapshot>` | Recovery-aware execution | Falls back to safe behavior when consistency requires baseline |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Command starts with preflight validation before core crawl/chunk/embed steps |
| Error   | Non-recoverable consistency failures surface as normalized command failures |
| Empty   | Recovered state can still produce a valid no-change success result when appropriate |
| Success | Recovery actions are applied silently or with concise notice, and indexing completes normally |

No new dedicated UI component is required; command notices and progress slideout communicate recovery outcomes.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/services/indexing/indexConsistency.ts` | Central consistency validation and recovery planning helpers |
| 2 | `src/__tests__/unit/indexConsistency.test.ts` | Unit tests for stale-job detection, manifest validation, and recovery decisions |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Add consistency report/issue contracts used by indexing recovery flow |
| 2 | `src/services/IndexingService.ts` | Execute preflight consistency checks, apply recovery, and fallback to safe baseline behavior |
| 3 | `src/services/indexing/IndexManifestStore.ts` | Add validation helpers and reset/fallback support for unusable manifest payloads |
| 4 | `src/services/indexing/IndexJobStateStore.ts` | Add stale-active-job reconciliation helper for interrupted runs |
| 5 | `src/main.ts` | Surface concise user notices when recovery actions are applied |
| 6 | `src/__tests__/integration/plugin.runtime.test.ts` | Add integration coverage for command behavior under recovered/stale state |

### Files UNCHANGED (confirm no modifications needed)

- `src/utils/chunker.ts` — no parser behavior changes required for consistency/recovery
- `src/utils/vaultCrawler.ts` — no traversal behavior changes required for consistency/recovery
- `src/ui/SearchView.ts` — search UI is unrelated to indexing recovery mechanics

---

## 5. Acceptance Criteria Checklist

### Phase A: Consistency Validation

- [x] **A1** — Indexing runs preflight consistency checks before work starts
  - `reindexVault` and `indexChanges` both execute preflight validation.
  - Validation inspects persisted manifest and persisted active-job state.

- [x] **A2** — Stale active-job state is detected and marked recoverable
  - Persisted `activeJob` entries from interrupted prior runs are identified as stale.
  - Recovery converts stale active state into a terminal record (for example `failed`/`cancelled`) so new jobs can proceed.

- [x] **A3** — Invalid/unsupported manifest payload is classified clearly
  - Shape/version validation failures produce explicit issue codes/messages.
  - Non-usable manifest states trigger safe fallback behavior instead of silent use.

### Phase B: Recovery Execution

- [x] **B1** — Recovery actions are automatically applied for recoverable issues
  - Stale active-job markers are cleared without requiring manual user intervention.
  - Recoverable manifest issues are reset to a safe baseline state.

- [x] **B2** — `indexChanges` falls back safely when baseline cannot be trusted
  - If manifest is unusable, incremental run performs full-baseline behavior (or equivalent safe fallback) and re-seeds manifest state.
  - Fallback path is explicit in snapshot detail/log context.

- [x] **B3** — User feedback is concise and actionable
  - Recovery events are visible through notice/log messaging without excessive noise.
  - Non-recoverable consistency failures provide clear next-step guidance.

### Phase C: Verification Coverage

- [x] **C1** — Unit tests cover issue detection and recovery decision logic
  - Tests assert stale active-job detection, invalid manifest detection, and fallback flags.
  - Tests assert no-action path when consistency state is healthy.

- [x] **C2** — Integration tests cover command execution after recovered state
  - Simulated stale/invalid state in test harness is recovered, then command succeeds.
  - Non-recoverable case still follows normalized failure path with expected notice.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Over-aggressive recovery could discard useful incremental history | Limit auto-reset behavior to clearly invalid/unsupported state and log reason codes |
| 2 | Extra preflight checks can add command latency | Keep checks lightweight and bounded to local persisted state reads |
| 3 | Recovery notices may overwhelm users if emitted too often | Emit notices only when corrective action is taken, not on every healthy run |

---

## Implementation Order

1. `src/types.ts` — add consistency issue/report contracts for explicit validation and recovery outcomes (covers A3, B2).
2. `src/services/indexing/indexConsistency.ts` — implement preflight validation and recovery action planning helpers (covers A1, A2, A3, B1).
3. `src/services/indexing/IndexManifestStore.ts` and `src/services/indexing/IndexJobStateStore.ts` — add shape/version validation and stale-active reconciliation primitives (covers A2, A3, B1).
4. `src/services/IndexingService.ts` — integrate preflight + recovery before executing reindex/incremental workflows, including fallback behavior (covers B2, B3).
5. `src/main.ts` and `src/__tests__/integration/plugin.runtime.test.ts` — add concise recovery messaging and command-level behavior assertions (covers B3, C2).
6. `src/__tests__/unit/indexConsistency.test.ts` — validate detection and recovery decision matrix (covers C1).
7. **Verify** — run `npm run test` and `npm run lint` after recovery integration (covers Z2, Z3).
8. **Final verify** — run `npm run build` and manually simulate stale state to confirm automatic recovery path (covers Z1, Z4).

---

*Created: 2026-02-23 | Story: IDX-6 | Epic: Epic 2 — Indexing and Metadata Pipeline*
