REVIEW SUMMARY: result=Pass TEST-critical=0 TEST-high=0 SEC-critical=0 SEC-high=0 REL-critical=0 REL-high=0 API-critical=0 API-high=0

# Story Review: RET-4 — Configurable coarse-K + content-only fallback

**Reviewed against:** `docs/features/RET-4.md`
**Date:** 2026-04-20
**Mode:** `/review-story`
**Gate result:** `Pass`

---

## Scope

- Story ID: RET-4
- Linked refined requirements (Sn IDs in scope): REQ-003 S1–S10 (via story §8a mapping)
- Files in scope (from Section 7 intersected with implementer diff for this story):
  - `src/core/workflows/SearchWorkflow.ts` — modified
  - `src/core/workflows/ChatWorkflow.ts` — modified
  - `src/core/domain/types.ts` — modified
  - `src/plugin/settings/types.ts` — modified
  - `src/plugin/settings/defaults.ts` — modified
  - `src/plugin/settings/SettingsTab.ts` — modified
  - `src/plugin/settings/chatCoarseK.ts` — created
  - `src/plugin/settings/buildSearchAssembly.ts` — created
  - `src/sidecar/runtime/SidecarRuntime.ts` — modified
  - `src/plugin/ui/ChatView.ts` — modified
  - `src/plugin/ui/SearchView.ts` — modified
  - `README.md` — modified
  - `tests/core/workflows/SearchWorkflow.coarseK.test.ts` — created
  - `tests/core/workflows/ChatWorkflow.coarseK.test.ts` — created
  - `tests/sidecar/runtime/SidecarRuntime.chatRetrieval.test.ts` — created
  - `tests/plugin/settings/SettingsTab.chatCoarseK.test.ts` — created
  - `tests/contract/document-store.contract.ts` — modified
  - `tests/integration/sqlite-document-store.fallback.test.ts` — created
  - `tests/core/workflows/SearchWorkflow.test.ts` — modified
  - `tests/core/workflows/searchTestStore.ts` — modified
  - `tests/plugin/settings/defaults.test.ts` — modified
  - `docs/features/RET-4.md` — modified (status + AC)
- Tests in scope (from Section 8a): as named in story evidence lines for A1–Y9; all exist and `npm test` passes.
- Adapters in scope (from Section 4b):
  - `SqliteDocumentStore` for port `IDocumentStore` — integration + contract coverage present.

### Out-of-plan changes

- `src/sidecar/http/httpServer.ts` and `src/sidecar/stdio/stdioServer.ts` — listed in story §7 as MODIFY but **no line changes** in this implementation: request bodies are still parsed as `SearchRequest` / chat payload; new optional fields (`coarseK`, `search`, `enableHybridSearch`, `k`) deserialize with existing `JSON.parse` + structural typing without dedicated handler edits. Recommend updating story §7 on the next doc pass to mark these as unchanged if intentional, or add a one-line comment in each handler referencing RET-4 wire fields for audit trail.

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

(None — gate `Pass`.)

---

## Notes

- Z5: `SearchWorkflow.runSearch` emits `coarseK`, `fallback_fired`, and `merged_candidates` via optional `deps.log.debug` (`SidecarRuntime` supplies pino logger on `getSearchDeps()`).
