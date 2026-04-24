REVIEW SUMMARY: result=Pass TEST-critical=0 TEST-high=0 SEC-critical=0 SEC-high=0 REL-critical=0 REL-high=0 API-critical=0 API-high=0

# Story Review: BUG-4 — FTS query construction — sanitize user text before SQLite FTS5 `MATCH`

**Reviewed against:** `docs/features/BUG-4.md`
**Date:** 2026-04-24
**Mode:** `/review-story`
**Gate result:** `Pass`

---

## Scope

- Story ID: BUG-4
- Linked refined requirements (Sn IDs in scope): REQ-006 S5, S6
- Files in scope (from Section 7 intersected with working-tree intent):
  - `src/core/domain/fts-sanitize.ts` — modified (`buildFtsMatchQuery`, removed `sanitizeFtsQuery`)
  - `src/sidecar/adapters/SqliteDocumentStore.ts` — modified (`searchContentKeyword` null short-circuit + debug log)
  - `tests/core/domain/fts-sanitize.test.ts` — modified (A1–A6)
  - `tests/contract/documentStore.searchContentKeyword.contract.ts` — created (Y1, Y2)
  - `tests/integration/SqliteDocumentStore.fts-sanitize.integration.test.ts` — created (Y3–Y5)
- Tests in scope (from Section 8a):
  - `tests/core/domain/fts-sanitize.test.ts::A1_basic_tokens_or_joined` … `A6_64_term_cap`
  - `tests/contract/documentStore.searchContentKeyword.contract.ts::Y1_*`, `Y2_*`
  - `tests/integration/SqliteDocumentStore.fts-sanitize.integration.test.ts::Y3_real_fts_no_syntax_error`, `Y4_backticks_and_punctuation`, `Y5_zero_token_short_circuit`
- Adapters in scope:
  - `SqliteDocumentStore` for port `IDocumentStore`

### Out-of-plan changes

- `vitest.config.ts` — add Vitest `include` entry so the new contract filename is discovered (not `*.test.ts`); align with existing contract-file pattern.
- `tests/integration/chat-nl-date-queries.integration.test.ts` — expectations updated to match `stripMatchedNLDatePhraseForRetrieval` (ADR-016); fixes suite drift unrelated to FTS construction but required for `npm run test` green.

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

(None — gate passed.)

---

## Notes

- Zero-token path uses `console.debug` with the structured fields required by story Z5; full sidecar `pino` wiring can replace this in a later observability pass without changing the MATCH contract.
