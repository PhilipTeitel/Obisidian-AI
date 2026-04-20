REVIEW SUMMARY: result=Pass TEST-critical=0 TEST-high=0 SEC-critical=0 SEC-high=0 REL-critical=0 REL-high=0 API-critical=0 API-high=0

# Story Review: RET-5 — Hybrid retrieval (vector + FTS5 via RRF)

**Reviewed against:** `docs/features/RET-5.md`
**Date:** 2026-04-20
**Mode:** `/review-story`
**Gate result:** `Pass`

---

## Scope

- Story ID: RET-5
- Linked refined requirements (Sn IDs in scope): S1, S2, S3, S4, S12, S13, S14, S15 (REQ-004)
- Files in scope (from Section 7 intersected with working-tree changes):
  - `src/core/domain/rrf.ts` — created
  - `src/core/domain/fts-sanitize.ts` — created
  - `tests/core/domain/rrf.test.ts` — created
  - `tests/core/domain/fts-sanitize.test.ts` — created
  - `tests/core/workflows/SearchWorkflow.hybrid.test.ts` — created
  - `tests/core/workflows/ChatWorkflow.hybrid.test.ts` — created
  - `tests/contract/document-store.contract.ts` — modified (contract + `searchContentKeyword_contract`)
  - `tests/sidecar/adapters/SqliteDocumentStore.fts.test.ts` — created
  - `src/core/ports/IDocumentStore.ts` — modified
  - `src/sidecar/adapters/SqliteDocumentStore.ts` — modified
  - `src/core/workflows/SearchWorkflow.ts` — modified
  - `src/core/workflows/ChatWorkflow.ts` — modified
  - `src/core/domain/types.ts` — modified
  - `src/plugin/settings/defaults.ts` — modified
  - `src/plugin/settings/SettingsTab.ts` — modified
  - `src/sidecar/runtime/SidecarRuntime.ts` — modified
  - `src/plugin/settings/types.ts` — modified
  - `src/plugin/ui/ChatView.ts` — modified
  - `src/plugin/ui/SearchView.ts` — modified
  - `tests/core/workflows/searchTestStore.ts` — modified (fake store implements new port surface)
- Tests in scope (from Section 8a): all cited `::` test names exist under `tests/` and ran green in `npm run test`.
- Adapters in scope (from Section 4b):
  - `SqliteDocumentStore` for port `IDocumentStore` — integration coverage in `SqliteDocumentStore.fts.test.ts` and contract in `document-store.contract.ts`.

### Out-of-plan changes

Supporting fallout from `INNER JOIN note_meta` on vector/FTS paths and hybrid defaults; not listed in Section 7 but required for green CI:

- `tests/sidecar/adapters/SqliteDocumentStore.test.ts` — add `upsertNoteMeta` where vec queries run
- `tests/sidecar/adapters/SqliteDocumentStore.summaries.promptVersion.test.ts` — `A4_bullet_still_retrievable` note_meta seed
- `tests/core/workflows/SearchWorkflow.test.ts` — explicit `enableHybridSearch: false` where call-order baseline is asserted
- `tests/core/workflows/SearchWorkflow.coarseK.test.ts` — `B5` reworked to assert fallback counts, not identical call logs, across hybrid toggle
- `tests/core/workflows/SummaryWorkflow.test.ts`, `IncrementalIndexPlanner.test.ts`, `IndexWorkflow.test.ts`, `SummaryWorkflow.rubric.test.ts` — `IDocumentStore` stubs
- `tests/plugin/settings/defaults.test.ts` — default `enableHybridSearch`
- `tests/sidecar/runtime/SidecarRuntime.chatRetrieval.test.ts` — payload threads `enableHybridSearch` into `runChatStream`
- `docs/features/RET-5.md` — status + AC checklist (story bookkeeping)

Section 7 listed `httpServer.ts` / `stdioServer.ts` as MODIFY for envelope forwarding; no edits were necessary because chat/search JSON payloads are passed through wholesale and `SidecarRequest` types already include optional `enableHybridSearch` / filters.

---

## Findings

### Test Coverage (`TEST-#`)

None.

### Reliability (`REL-#`)

None.

### Security (`SEC-#`)

None.

### API Contracts (`API-#`)

None.

---

## Required actions before QA

None.

---

## Notes

- Z6 was validated with this review output line (zero high/critical findings).
