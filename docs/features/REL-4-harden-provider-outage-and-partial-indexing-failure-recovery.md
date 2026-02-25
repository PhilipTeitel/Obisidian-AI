# REL-4: Harden provider outage and partial indexing failure recovery

**Story**: Improve indexing failure resilience by adding transient provider retries, safer incremental write ordering, and explicit user-facing recovery guidance.
**Epic**: Epic 7 — Performance, Reliability, and MVP Readiness
**Size**: Medium
**Status**: Done

---

## 1. Summary

REL-4 addresses reliability gaps when provider outages or partial indexing failures occur during indexing operations. While retry behavior exists inside embedding batches, the indexing orchestration layer still benefits from command-level transient retries, safer sequencing in incremental updates, and clear recovery guidance when failures persist.

The highest-risk failure mode is partial incremental writes under dependency instability. This story hardens the incremental flow by avoiding destructive delete operations before embeddings are available, reducing the chance of data loss when providers fail mid-run.

The story also improves user outcomes by attaching actionable recovery hints to failure surfaces so operators know whether to retry, check provider credentials/connectivity, or run a full reindex to restore consistency.

---

## 2. API Endpoints + Schemas

No API endpoint or schema changes are required.

REL-4 modifies runtime indexing/error behavior only; public TypeScript contracts remain unchanged.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Index command
└── IndexingService.runIndexingJob()
    ├── transient provider failure detection
    ├── bounded retry attempt (command-level)
    ├── incremental safe sequencing (embed before delete)
    └── failure message with "Recovery action: ..."
        └── plugin command notice surfaces recovery hint
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `IndexingService.runIndexingJob` | internal job orchestration | retry attempt state + failed snapshot details | Adds transient retry + recovery guidance detail |
| `IndexingService.runIncrementalIndex` | internal incremental path | safer write ordering | Prevents delete-before-embed when provider is unavailable |
| `ObsidianAIPlugin.runIndexCommand` | command failure notice path | recovery hint extraction | Adds actionable text to user notice when present |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Retry progress can be emitted when transient provider failures are detected |
| Error   | Failure notices include normalized message plus recovery hint when available |
| Empty   | N/A |
| Success | Command eventually succeeds after transient retry or normal path completion |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/features/REL-4-harden-provider-outage-and-partial-indexing-failure-recovery.md` | REL-4 plan and checklist |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/services/IndexingService.ts` | Add transient retry handling, recovery action messaging, and safer incremental sequencing |
| 2 | `src/main.ts` | Surface recovery-action hints in command failure notices |
| 3 | `src/__tests__/unit/indexing.incremental.test.ts` | Validate retry behavior and delete-guard behavior under embedding failures |
| 4 | `src/__tests__/integration/plugin.runtime.test.ts` | Validate recovery hint propagation into user-facing notices |
| 5 | `README.md` | Link REL-4 story row in backlog |

### Files UNCHANGED (confirm no modifications needed)

- `src/services/EmbeddingService.ts` — retains batch-level retry policy; REL-4 adds orchestration-level hardening around it.
- `src/services/indexing/indexConsistency.ts` — preflight/recovery baseline logic remains valid.

---

## 5. Acceptance Criteria Checklist

### Phase A: Retry + Recovery Hardening

- [x] **A1** — Indexing job orchestration retries transient provider failures once before terminal failure
  - Retry behavior is bounded and emits explicit retry progress context.
  - Evidence: `src/__tests__/unit/indexing.incremental.test.ts::retries_transient_provider_failures_before_marking_incremental_indexing_failed(vitest)`

- [x] **A2** — Incremental indexing avoids delete-before-embed on provider failure
  - If embedding fails, note-path deletes are not executed for that attempt.
  - Evidence: `src/__tests__/unit/indexing.incremental.test.ts::does_not_delete_note_paths_when_embedding_fails_during_incremental_indexing(vitest)`

- [x] **A3** — Terminal indexing failure errors include explicit recovery action guidance
  - Recovery guidance differentiates retry flow and full-reindex fallback hints.
  - Evidence: `src/services/IndexingService.ts::A3_recovery_action_messages(source)`

### Phase B: User-Facing Error Guidance

- [x] **B1** — Command failure notices append recovery action hint when present
  - User-visible notice remains normalized and includes actionable recovery text.
  - Evidence: `src/__tests__/integration/plugin.runtime.test.ts::appends_recovery_action_hints_to_user_notices_on_indexing_failures(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/services/IndexingService.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - This repository currently has no `@shared/types` package; REL-4 introduces no import changes that violate this guardrail.
  - Evidence: `src/main.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Additional retries can increase command duration | Bound retry attempts to one extra try and only for transient provider/network signatures |
| 2 | Overly broad recovery hints can be noisy | Keep messaging explicit and tied to failure classes |
| 3 | Changing incremental sequencing may alter failure characteristics | Add focused unit tests proving delete-guard behavior under provider outages |

---

## Implementation Order

1. `src/services/IndexingService.ts` — add retry classification, retry loop, recovery guidance construction, and safe incremental sequencing (covers A1, A2, A3).
2. `src/main.ts` — append recovery hints to normalized notices in command failure path (covers B1).
3. `src/__tests__/unit/indexing.incremental.test.ts` — add failure/retry coverage for new orchestration behavior (covers A1, A2).
4. `src/__tests__/integration/plugin.runtime.test.ts` — assert recovery hints reach notices (covers B1).
5. **Verify** — run targeted indexing/runtime tests.
6. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-24 | Story: REL-4 | Epic: Epic 7 — Performance, Reliability, and MVP Readiness*
