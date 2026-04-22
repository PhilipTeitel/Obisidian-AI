REVIEW SUMMARY: result=Pass TEST-critical=0 TEST-high=0 SEC-critical=0 SEC-high=0 REL-critical=0 REL-high=0 API-critical=0 API-high=0

# Story Review: BUG-1 — Source provenance contract — sources equal notes actually used

**Reviewed against:** `docs/features/BUG-1.md`
**Date:** 2026-04-21
**Mode:** `/review-story`
**Gate result:** `Pass`

---

## Scope

- Story ID: BUG-1
- Linked refined requirements (Sn IDs in scope): S1, S2, S7 (per story Section 8a)
- Files in scope (from Section 7 "Files to CREATE/MODIFY" intersected with working tree):
  - `src/core/domain/types.ts` — modified (`UsedNodeRecord`, `chatStitchMaxTokens`)
  - `src/core/domain/contextAssembly.ts` — modified (stitch + stitch budget helpers)
  - `src/core/workflows/ChatWorkflow.ts` — modified (used-node set → `sources`)
  - `src/core/workflows/SearchWorkflow.ts` — modified (post-retrieval filter parity on `results`)
  - `src/sidecar/runtime/SidecarRuntime.ts` — modified (`sourceCount` on chat completion log)
  - `tests/core/workflows/ChatWorkflow.sources.test.ts` — created
  - `tests/core/workflows/SearchWorkflow.sources.test.ts` — created
  - `tests/integration/chat-stream-sources.integration.test.ts` — created
  - `tests/core/workflows/searchTestStore.ts` — modified (tag filter hook for B3)
- Tests in scope (from Section 8a Test Plan): all cited `::` test names exist and passed under `npm run test`
- Adapters in scope (from Section 4b): none (Section 4b states no new adapter)

### Out-of-plan changes

- None (incidental `var/test/*.db` noise reverted before review).

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

None (gate passed).

---

## Notes

- Y1 uses an in-process `IChatPort` that yields real stream chunks; provenance is exercised through production `runChatStream` + `buildGroundedMessages` injection, not stubbed source lists.
