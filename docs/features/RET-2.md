# RET-2: Token budgets and structured snippet formatting

**Story**: Replace hard-coded tier fractions in retrieval assembly with **injected budget ratios** aligned to plugin settings (`matchedContentBudget`, `siblingContextBudget`, `parentSummaryBudget`), and enforce caps using **`estimateTokens`** from [`tokenEstimator.ts`](../../src/core/domain/tokenEstimator.ts) so snippets and chat context stay within a **target token budget** for the assembled block.
**Epic**: 5 — Retrieval, search workflow, and chat workflow
**Size**: Medium
**Status**: Complete

> **Complementary to Phase B:** the context-budget contract delivered here is unchanged by [RET-4](RET-4.md) / [RET-5](RET-5.md) / [RET-6](RET-6.md); those stories change what enters the assembly, not how it is budgeted. [CHAT-4](CHAT-4.md) adds an **additional** system-message token-budget layer for `chatSystemPrompt` + `vaultOrganizationPrompt`, orthogonal to the per-tier fractions in this story.

---

## 1. Summary

[REQUIREMENTS §5](../requirements/REQUIREMENTS.md) and [README §10](../../README.md#10-structured-context-formatting) require **per-tier token budgets** (default 60% / 25% / 15%) when building structured context. [RET-1](RET-1.md) may inline those defaults; this story **externalizes** them as **`ContextBudgetConfig`** (or equivalent) passed into `SearchWorkflow` / shared assembly helpers, validates that the three fractions **sum to 1.0** (± floating tolerance) at runtime, and **truncates** each tier deterministically (e.g. by estimated tokens, preserving heading lines where feasible) when text would exceed its share.

**Prerequisite:** [RET-1](RET-1.md) complete (or assembly module extracted from it). **Downstream:** [CHAT-1](CHAT-1.md) must pass the **same** budget object when assembling RAG context so search UI and chat see consistent structure.

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                                                          | Why it binds this story                                                                |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [docs/decisions/ADR-003-phased-retrieval-strategy.md](../decisions/ADR-003-phased-retrieval-strategy.md)     | Phase 3 assembly must respect per-tier budgets (matched / sibling / parent summaries). |
| [docs/decisions/ADR-002-hierarchical-document-model.md](../decisions/ADR-002-hierarchical-document-model.md) | Heading trails and sibling lists define what text enters each tier.                    |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration test, or script) where wrong-stack substitution is a risk

_Planning note: No **Tensions / conflicts** identified. README default fractions match REQUIREMENTS §5._

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Budget inputs are **three non-negative numbers** (`matched`, `sibling`, `parent`) that **sum to 1.0** within **`1e-6`**; invalid configs must throw or return a documented error before calling the store (no silent clamp to unrelated defaults without logging).
2. **Y2** — Token accounting uses **`estimateTokens`** from core (`tokenEstimator.ts`) for MVP consistency with CHK-2; do not import vendor tokenizers into `src/core/`.
3. **Y3** — Assembly output format must remain **machine-testable**: each tier is introduced by the same **Markdown-ish labels** as [README §10](../../README.md#10-structured-context-formatting) (`**Matched content:**`, `**Sibling context:**`, `**Parent summary:**`) unless a single documented rename is applied across README + tests in the same PR.
4. **Y4** — Reducing `matchedContentBudget` in config must **never** increase allocated tokens for **`parentSummaryBudget`** unless the user changes that fraction (tiers are independent slices of the **total** assembly budget).
5. **Y5** — **`SearchWorkflow`** (or shared `assembleStructuredContext`) accepts **`totalTokenBudget`** (positive integer); implementer picks default (e.g. `8000`) documented in code and tests — sidecar later maps chat model window minus overhead.

---

## 5. API Endpoints + Schemas

No IPC schema change required if `SearchRequest` unchanged; sidecar maps settings → workflow options.

```ts
/** Fractions of totalTokenBudget for the three assembly tiers (README Plugin Settings). */
export interface ContextBudgetConfig {
  matchedContent: number;
  siblingContext: number;
  parentSummary: number;
}

export interface SearchAssemblyOptions {
  budget: ContextBudgetConfig;
  /** Upper bound for estimateTokens across the full assembled block (excl. fixed headings). */
  totalTokenBudget: number;
}
```

Extend `runSearch` (RET-1) signature to accept `assembly?: SearchAssemblyOptions`; when omitted, use README defaults `0.6`, `0.25`, `0.15` and `totalTokenBudget` default constant.

---

## 6. Frontend Flow

Not applicable. **PLG-4** surfaces numeric settings later; this story only consumes values from the **caller** (tests pass explicit numbers).

### 6a. Component / Data Hierarchy

```
(n/a)
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
| ---------------- | ----------------- | ----- | ----- |
| —                | —                 | —     | —     |

### 6c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
| ----- | ----------- |
| —     | —           |

---

## 7. File Touchpoints

### Files to CREATE

| #   | Path                                        | Purpose                                                                  |
| --- | ------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | `src/core/domain/contextAssembly.ts`        | Pure helpers: apply budgets, truncate by `estimateTokens`, format tiers. |
| 2   | `tests/core/domain/contextAssembly.test.ts` | Budget math, truncation order, label presence.                           |

### Files to MODIFY

| #   | Path                                          | Change                                                          |
| --- | --------------------------------------------- | --------------------------------------------------------------- |
| 1   | `src/core/workflows/SearchWorkflow.ts`        | Inject `SearchAssemblyOptions`; remove magic fraction literals. |
| 2   | `tests/core/workflows/SearchWorkflow.test.ts` | Assert truncation when tiers exceed budgets.                    |

### Files UNCHANGED (confirm no modifications needed)

- `src/sidecar/adapters/SqliteDocumentStore.ts` — ANN unchanged; assembly is post-fetch text only.

---

## 8. Acceptance Criteria Checklist

### Phase A: Config validation

- [x] **A1** — When fractions sum to **0.99**, `runSearch` / assembly entry **rejects** the config (throws or `Result` error) — no partial assembly.
  - Evidence: `tests/core/domain/contextAssembly.test.ts::A1_rejects_bad_sum(vitest)`

- [x] **A2** — When fractions are **`0.6 / 0.25 / 0.15`**, assembly runs without error on a minimal fake tree.
  - Evidence: `tests/core/domain/contextAssembly.test.ts::A2_default_budget_ok(vitest)`

### Phase B: Truncation behavior

- [x] **B1** — With a tiny `totalTokenBudget`, **`Matched content`** section is truncated first per tier allocation (matched tier cannot borrow sibling/parent share).
  - Evidence: `tests/core/domain/contextAssembly.test.ts::B1_matched_truncation_respects_share(vitest)`

- [x] **B2** — `SearchResult.snippet` estimated tokens **≤** `totalTokenBudget` + fixed heading overhead (`SNIPPET_HEADING_OVERHEAD_TOKENS` in `contextAssembly.ts`), matching §5 “tier bodies” vs headings.
  - Evidence: `tests/core/workflows/SearchWorkflow.test.ts::B2_snippet_within_budget(vitest)`

### Phase Y: Binding & stack compliance

- [x] **Y1** — **(binding)** `contextAssembly.ts` imports **only** `src/core/**` modules (no `sidecar`, `obsidian`, `better-sqlite3`).
  - Evidence: `npm run check:boundaries` or `rg` on `contextAssembly.ts` as in RET-1 **Y1**

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias — **N/A** (no shared package)
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 9. Risks & Tradeoffs

| #   | Risk / Tradeoff                             | Mitigation                                                                                                      |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | `estimateTokens` is crude vs real tokenizer | Document in code; acceptable MVP per CHK-2; optional follow-up story.                                           |
| 2   | Truncation mid-bullet hurts readability     | Prefer paragraph/sentence boundaries where cheap (reuse sentence splitter only if already imported — optional). |

---

## Implementation Order

1. `contextAssembly.ts` + tests **A1, A2, B1**.
2. Refactor `SearchWorkflow` to call assembly helper with `SearchAssemblyOptions`.
3. Extend `SearchWorkflow.test.ts` for **B2**.
4. **Verify** — `npm run build`, `vitest` targeted files.
5. **Final verify** — full test suite.

---

_Created: 2026-04-05 | Story: RET-2 | Epic: 5 — Retrieval, search workflow, and chat workflow_
