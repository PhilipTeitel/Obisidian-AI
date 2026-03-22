# SUM-3: Add summary generation progress events to IndexingService and ProgressSlideout

**Story**: Add progress callback support to `SummaryService.generateSummaries` so the indexing pipeline can emit progress events during the summary generation phase, and ensure the ProgressSlideout can display summary generation status.
**Epic**: Epic 13 — LLM Summary Generation Service
**Size**: Small
**Status**: Complete

---

## 1. Summary

This story extends `SummaryService.generateSummaries` with an optional `onProgress` callback that reports per-node progress during summary generation. This enables the `IndexingService` (in INTG-2) to emit `JobSnapshot` progress events during the `summarize` stage, which the `ProgressSlideout` already knows how to display.

The `IndexingStage` type already includes `"summarize"` (added in HIER-1). The `ProgressSlideout` already renders any `JobSnapshot.progress.label` string. The only missing piece is the progress callback mechanism in `SummaryService` and a helper to create summary-phase labels.

Key changes:
- Add `SummaryGenerationOptions` interface with optional `onNodeProcessed` callback.
- Modify `generateSummaries` to accept options and invoke the callback after each node.
- Export a `SUMMARY_STAGE_LABEL` constant for consistent labeling.
- The callback receives the current node count, total count, and current node ID.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are needed. This is an Obsidian plugin with internal service interfaces only.

New types added to `SummaryService`:

```ts
export interface SummaryProgressEvent {
  completed: number;
  total: number;
  currentNodeId: string;
  currentNodeType: string;
}

export interface SummaryGenerationOptions {
  onNodeProcessed?: (event: SummaryProgressEvent) => void;
}

export const SUMMARY_STAGE_LABEL = "Summarize";
```

Updated method signature:

```ts
generateSummaries(tree: DocumentTree, options?: SummaryGenerationOptions): Promise<SummaryGenerationResult[]>;
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
src/services/SummaryService.ts (modified)
├── INTG-2: IndexingService passes onNodeProcessed callback
│   └── Callback creates JobSnapshot with label "Reindex vault · Summarize"
│       └── ProgressSlideout.setStatus(snapshot) renders the label
└── SummaryProgressEvent provides completed/total for progress tracking
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `SummaryGenerationOptions` | `{ onNodeProcessed? }` | N/A | Optional callback for progress tracking |
| `SummaryProgressEvent` | `{ completed, total, currentNodeId, currentNodeType }` | N/A | Per-node progress data |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | ProgressSlideout shows "Reindex vault · Summarize" with node count (handled by INTG-2) |
| Error   | Not applicable — progress events are best-effort |
| Empty   | No nodes to summarize → no progress events emitted |
| Success | All nodes processed, final progress event shows completed = total |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/summaryService.progress.test.ts` | Unit tests for progress callback invocation |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/services/SummaryService.ts` | Add `SummaryProgressEvent`, `SummaryGenerationOptions`, `SUMMARY_STAGE_LABEL`; update `generateSummaries` to accept options and invoke callback |

### Files UNCHANGED

- `src/ui/ProgressSlideout.ts` — already renders any `JobSnapshot.progress.label` string
- `src/services/IndexingService.ts` — integration happens in INTG-2
- `src/types.ts` — `IndexingStage` already includes `"summarize"`

---

## 5. Acceptance Criteria Checklist

### Phase A: Progress Callback

- [x] **A1** — `generateSummaries` accepts optional `SummaryGenerationOptions`
  - The method signature includes an optional second parameter.
  - Existing callers without options continue to work.
  - Evidence: `src/__tests__/unit/summaryService.progress.test.ts::A1_optional_options(vitest)`

- [x] **A2** — `onNodeProcessed` callback is invoked after each node
  - The callback receives `completed` (incrementing), `total` (node count), `currentNodeId`, and `currentNodeType`.
  - Evidence: `src/__tests__/unit/summaryService.progress.test.ts::A2_callback_per_node(vitest)`

- [x] **A3** — Progress callback errors are swallowed and logged
  - If the callback throws, the error is logged at `warn` level and processing continues.
  - Evidence: `src/__tests__/unit/summaryService.progress.test.ts::A3_callback_error_swallowed(vitest)`

- [x] **A4** — No callback invocation when options are omitted
  - When `generateSummaries` is called without options, no errors occur.
  - Evidence: `src/__tests__/unit/summaryService.progress.test.ts::A4_no_options_no_error(vitest)`

### Phase B: Stage Label

- [x] **B1** — `SUMMARY_STAGE_LABEL` constant is exported
  - The constant value is `"Summarize"` for consistent use in progress labels.
  - Evidence: `src/__tests__/unit/summaryService.progress.test.ts::B1_stage_label_exported(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All existing tests continue to pass (`npm run test`)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Progress callback adds overhead per node | Callback is optional; when not provided, no overhead |
| 2 | Callback errors could disrupt summary generation | Errors are caught and logged, never propagated |
| 3 | Progress granularity is per-node, not per-LLM-call | Per-node is sufficient for UI progress display; per-call would add complexity without user benefit |

---

## Implementation Order

1. `src/services/SummaryService.ts` — Add `SummaryProgressEvent`, `SummaryGenerationOptions`, `SUMMARY_STAGE_LABEL` (covers B1)
2. `src/services/SummaryService.ts` — Update `generateSummaries` to accept options and invoke callback (covers A1, A2, A3, A4)
3. **Verify** — `npm run typecheck && npm run build`
4. `src/__tests__/unit/summaryService.progress.test.ts` — Write tests for all acceptance criteria (covers A1–B1)
5. **Final verify** — `npm run test && npm run lint && npm run build` (covers Z1–Z4)

---

*Created: 2026-03-22 | Story: SUM-3 | Epic: Epic 13 — LLM Summary Generation Service*
