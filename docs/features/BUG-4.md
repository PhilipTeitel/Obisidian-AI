# BUG-4: FTS query construction — sanitize user text before SQLite FTS5 `MATCH`

**Story**: Replace the existing character-strip sanitizer with a `tokenize → quote-as-phrase → OR-combine` builder, and make the hybrid retrieval leg safe when the resulting query is empty. Fixes BUG-001 / [REQ-006 S5–S6](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md) — ordinary punctuation (`?`, `!`, `.`) and inline backticks (`` ` ``) no longer raise `fts syntax error` slideouts; chat and search continue to work, falling back to vector-only when BM25 input collapses to zero tokens.
**Epic**: 11 — Chat accuracy and UX bug fixes (REQ-006)
**Size**: Medium
**Status**: Complete

---

## 1. Summary

Users hit an error slideout `Chat failed: fts syntax error near ?` whenever a chat prompt contains `?`, `!`, `.`, or inline backticks. The current sanitizer at [`src/core/domain/fts-sanitize.ts`](../../src/core/domain/fts-sanitize.ts) replaces only `"`, `*`, `(`, `)`, `:`, `-`, `^` — not the characters that trigger the bug. SQLite FTS5's query parser accepts only alphanumeric barewords plus whitespace and a handful of operators; anything else adjacent to a bareword is a syntax error. [REQ-006 S5–S6](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md) sets the acceptance: the request must not fail with an FTS error for ordinary punctuation or for `` ` ``.

[ADR-017](../decisions/ADR-017-fts-query-construction.md) resolves the sanitizer design: tokenize the user text on non-alphanumeric characters, drop FTS5 reserved keywords (`AND`/`OR`/`NOT`/`NEAR`), quote each surviving token as a phrase, and OR-combine up to 64 tokens. When tokenization yields zero tokens, the hybrid retrieval leg **skips BM25 entirely** and relies on vector retrieval alone — the chat flow continues normally with no user-visible error.

This story replaces the existing `sanitizeFtsQuery` with `buildFtsMatchQuery` (new name, new semantics), wires `SqliteDocumentStore.searchContentKeyword` to handle the zero-token short-circuit, and adds a contract test so any future adapter implementing the hybrid leg conforms to the same safety guarantees.

**Out-of-scope `Sn` from REQ-006:** S1, S2, S3, S4, S7 (owned by BUG-1, BUG-2, BUG-3). This story does not change retrieval ranking, embeddings, or filters — only the FTS5 input string and the zero-token fallback.

**Prerequisites:** [RET-5](RET-5.md) (hybrid retrieval exists), [STO-4](STO-4.md) (`nodes_fts` table with `unicode61` tokenizer). **Linked REQ:** [REQ-006](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [`docs/decisions/ADR-017-fts-query-construction.md`](../decisions/ADR-017-fts-query-construction.md) | Primary ADR — defines tokenize/quote/OR/zero-token-fallback/length-cap. |
| [`docs/decisions/ADR-012-hybrid-retrieval-and-coarse-k.md`](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) | Hybrid retrieval composes BM25 + vector via RRF; BUG-4 modifies the BM25 input but not the fusion. |
| [`docs/decisions/ADR-006-sidecar-architecture.md`](../decisions/ADR-006-sidecar-architecture.md) | FTS call happens inside the sidecar `SqliteDocumentStore`; adapter boundary is unchanged. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs (ADR-017, ADR-012) exist and are **Accepted**
- [ ] README §23 (User-Text Safety for Full-Text Search) and ADR-017 agree on the tokenize/quote/OR rule and the zero-token fallback
- [ ] Section 4 lists 6 bullets restated from ADR-017 Decisions 1–6
- [ ] Section 4b lists `IDocumentStore` (existing port) with both a contract test row and an integration test row against real SQLite + FTS5; Phase Y includes a `(binding)` criterion citing the integration test
- [ ] Section 8a covers every AC ID (A1–A6, Y1–Y5, Z1–Z6) and maps REQ-006 S5 and S6 to at least one test row each
- [ ] Phase Y has at least one `(binding)` criterion whose evidence is an integration test against **real** SQLite + FTS5 — not a mocked store

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — User text is tokenized on `[^0-9A-Za-z\u0080-\uFFFF]`; empty tokens are discarded.
2. **Y2** — Tokens equal (case-insensitive) to FTS5 reserved keywords (`AND`, `OR`, `NOT`, `NEAR`) are removed.
3. **Y3** — Each surviving token is emitted as a quoted FTS5 phrase (`"token"`); tokens are combined with ` OR `.
4. **Y4** — When tokenization yields zero tokens, `searchContentKeyword` returns `[]` without calling FTS5; no exception is thrown.
5. **Y5** — Number of OR-combined tokens is capped at **64** (configurable constant); excess tokens are dropped (first 64 unique lowercased tokens kept).
6. **Y6** — Prompts containing `?`, `!`, `.`, `` ` `` never produce an FTS5 syntax error path.

---

## 4b. Ports & Adapters

| Port name | Port file | Adapter(s) | Real backing service / fixture | Notes |
|-----------|-----------|------------|--------------------------------|-------|
| `IDocumentStore` | [`src/core/ports/IDocumentStore.ts`](../../src/core/ports/IDocumentStore.ts) | [`SqliteDocumentStore`](../../src/sidecar/adapters/SqliteDocumentStore.ts) (existing) | Local SQLite DB built from migrations `001_schema.sql` + `002_fts.sql` in `tests/fixtures/`; a handful of seeded notes for the integration test. | No new adapter. This story modifies `searchContentKeyword`'s query construction and zero-token handling — both observable on the real adapter against real SQLite. The contract test runs against any `IDocumentStore` implementation; the integration test runs against the real `SqliteDocumentStore`. |

---

## 5. API Endpoints + Schemas

No wire-shape changes. `chat` and `search` payloads and responses are unaffected. The `IDocumentStore.searchContentKeyword(query, k, filter?)` signature is unchanged; the internal implementation of the query-construction step changes.

New pure helper in core:

```ts
// src/core/domain/fts-sanitize.ts — replaces sanitizeFtsQuery
export interface BuildFtsMatchQueryOptions {
  /** Defaults to 64. */
  maxTerms?: number;
}

/**
 * Produce an FTS5 MATCH expression safe for `nodes_fts MATCH ?`, given free-form user text.
 * Returns `null` when the input yields zero usable tokens — callers must skip the BM25 leg.
 */
export function buildFtsMatchQuery(
  raw: string,
  options?: BuildFtsMatchQueryOptions,
): string | null;
```

The existing `sanitizeFtsQuery` export is removed; [RET-5](RET-5.md)'s internal callers migrate to `buildFtsMatchQuery`. If external callers exist (none expected), they either adopt the new API or accept a one-line wrapper that treats `null` as "no query".

---

## 6. Frontend Flow

### 6a. Component / Data Hierarchy

Not applicable — this is a sidecar-internal change. The plugin UI (`ChatView`, `SearchView`) is unaffected beyond the disappearance of the error slideout that previously fired on punctuation.

### 6b. Props & Contracts

Not applicable.

### 6c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Prompt with punctuation only (e.g. `?!?!`) | Hybrid BM25 leg returns `[]`; vector leg runs on the raw text; if vector returns results, normal chat reply; otherwise insufficient-evidence path per [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md). No error slideout. |
| Prompt with words + punctuation (`"What happened last month?"`) | Tokens: `what`, `happened`, `last`, `month`. BM25 runs with `"what" OR "happened" OR "last" OR "month"`. |
| Prompt containing reserved keywords (`"pros and cons"`) | `AND`-as-word is dropped; BM25 runs with `"pros" OR "cons"`. |
| Very long prompt (200+ words) | First 64 unique tokens used for BM25; vector leg sees full prompt; user sees normal reply. |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `tests/core/domain/fts-sanitize.test.ts` | Unit tests for `buildFtsMatchQuery`: punctuation, backticks, reserved-keyword removal, zero-token `null`, 64-term cap (A1–A5). |
| 2 | `tests/contract/documentStore.searchContentKeyword.contract.ts` | Contract test for any `IDocumentStore` implementing hybrid keyword search: (a) punctuation-only input returns `[]`, (b) keyword input returns ranked hits, (c) no thrown FTS errors on any common punctuation characters. |
| 3 | `tests/integration/SqliteDocumentStore.fts-sanitize.integration.test.ts` | Integration — real SQLite + FTS5: submit queries containing `?`, `!`, `.`, `` ` ``; assert no thrown error, correct hits when applicable, `[]` for pure punctuation (Y6, Y4). |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/domain/fts-sanitize.ts` | Replace `sanitizeFtsQuery` with `buildFtsMatchQuery` per ADR-017 Decisions 1–6. |
| 2 | `src/sidecar/adapters/SqliteDocumentStore.ts` | In `searchContentKeyword`, call `buildFtsMatchQuery`; on `null`, return `[]` immediately with a debug log; otherwise pass the returned string to `nodes_fts MATCH ?`. |
| 3 | `src/core/workflows/SearchWorkflow.ts` | No logic change, but if any call site previously relied on `sanitizeFtsQuery`'s behavior of "return empty string" versus "return `null`", migrate to the new contract. |

### Files UNCHANGED (confirm no modifications needed)

- `src/sidecar/db/migrations/002_fts.sql` — tokenizer config stays `unicode61 remove_diacritics 1` (or `2` per existing migration); ADR-017 explicitly does not change it.
- `src/core/domain/rrf.ts` — fusion logic unchanged.
- `src/plugin/ui/*` — no renderer changes; error slideouts that previously fired simply stop firing.

---

## 8. Acceptance Criteria Checklist

### Phase A: `buildFtsMatchQuery` (pure)

- [x] **A1** — Alphanumeric-only input produces the expected OR-of-phrases
  - `buildFtsMatchQuery("pros cons") === '"pros" OR "cons"'`.
  - Evidence: `tests/core/domain/fts-sanitize.test.ts::A1_basic_tokens_or_joined(vitest)`

- [x] **A2** — Punctuation is stripped; residual tokens are quoted and OR-joined
  - `buildFtsMatchQuery("What happened last month?") === '"what" OR "happened" OR "last" OR "month"'` (lowercased per ADR-017 Decision 2).
  - Evidence: `tests/core/domain/fts-sanitize.test.ts::A2_punctuation_stripped(vitest)` — covers S5.

- [x] **A3** — Inline backticks are stripped
  - `buildFtsMatchQuery("use the \`foo\` command") === '"use" OR "the" OR "foo" OR "command"'`.
  - Evidence: `tests/core/domain/fts-sanitize.test.ts::A3_backticks_stripped(vitest)` — covers S6.

- [x] **A4** — Reserved keywords (`AND`, `OR`, `NOT`, `NEAR`, case-insensitive) are dropped
  - `buildFtsMatchQuery("pros and cons") === '"pros" OR "cons"'`; the word `AND` does not become an FTS5 operator.
  - Evidence: `tests/core/domain/fts-sanitize.test.ts::A4_reserved_keywords_dropped(vitest)`

- [x] **A5** — Zero-token input returns `null`
  - `buildFtsMatchQuery("??!!...") === null`; `buildFtsMatchQuery("") === null`; whitespace-only returns `null`.
  - Evidence: `tests/core/domain/fts-sanitize.test.ts::A5_zero_tokens_returns_null(vitest)`

- [x] **A6** — Over-length input is capped at 64 unique tokens
  - Given 100 unique words, the returned expression contains exactly 64 `"…"` tokens joined by ` OR `.
  - Evidence: `tests/core/domain/fts-sanitize.test.ts::A6_64_term_cap(vitest)`

### Phase Y: Binding & stack compliance

- [x] **Y1** — **(binding)** `IDocumentStore` contract: punctuation-only input returns `[]` without error
  - Contract test runs against any `IDocumentStore`; in-memory fakes and the real `SqliteDocumentStore` both pass.
  - Evidence: `tests/contract/documentStore.searchContentKeyword.contract.ts::Y1_punctuation_only_returns_empty(vitest)` — covers S5 / S6 behavior at the port level.

- [x] **Y2** — **(binding)** `IDocumentStore` contract: keyword input returns ranked hits
  - Seed a known corpus; query with keywords only; assert nonempty results in BM25 order.
  - Evidence: `tests/contract/documentStore.searchContentKeyword.contract.ts::Y2_keyword_input_returns_hits(vitest)`

- [x] **Y3** — **(binding)** Real SQLite + FTS5: `searchContentKeyword("What did I do yesterday?", 10)` completes without throwing and returns a (possibly empty) ranked list
  - Evidence: `tests/integration/SqliteDocumentStore.fts-sanitize.integration.test.ts::Y3_real_fts_no_syntax_error(vitest)` — covers S5 at the real adapter boundary.

- [x] **Y4** — **(binding)** Real SQLite + FTS5: `searchContentKeyword("\`foo\` bar?", 10)` completes without throwing
  - Evidence: `tests/integration/SqliteDocumentStore.fts-sanitize.integration.test.ts::Y4_backticks_and_punctuation(vitest)` — covers S6.

- [x] **Y5** — **(binding)** Real SQLite + FTS5: zero-token input short-circuits to `[]` without calling `MATCH`
  - Attach a spy to the underlying `db.prepare` or similar; assert the FTS prepared statement is **not** executed for pure-punctuation input.
  - Evidence: `tests/integration/SqliteDocumentStore.fts-sanitize.integration.test.ts::Y5_zero_token_short_circuit(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — No relative imports where the project alias applies
- [x] **Z5** — Zero-token short-circuit emits a `debug`-level log (`{ scope: 'searchContentKeyword', reason: 'zero_tokens', rawLength: n }`) per [§20 Logging](../../README.md#20-logging-and-observability); no `error`-level noise on ordinary punctuation
- [x] **Z6** — `/review-story BUG-4` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface

---

## 8a. Test Plan

| # | Level | File::test name | Covers AC | Covers Sn | Notes |
|---|-------|------------------|-----------|-----------|-------|
| 1 | unit | `tests/core/domain/fts-sanitize.test.ts::A1_basic_tokens_or_joined` | A1 | — | Basic case. |
| 2 | unit | `tests/core/domain/fts-sanitize.test.ts::A2_punctuation_stripped` | A2 | S5 | `?` handled. |
| 3 | unit | `tests/core/domain/fts-sanitize.test.ts::A3_backticks_stripped` | A3 | S6 | Backticks handled. |
| 4 | unit | `tests/core/domain/fts-sanitize.test.ts::A4_reserved_keywords_dropped` | A4 | — | Reserved keywords. |
| 5 | unit | `tests/core/domain/fts-sanitize.test.ts::A5_zero_tokens_returns_null` | A5 | S5, S6 | `null` fallback. |
| 6 | unit | `tests/core/domain/fts-sanitize.test.ts::A6_64_term_cap` | A6 | — | Length cap. |
| 7 | contract | `tests/contract/documentStore.searchContentKeyword.contract.ts::Y1_punctuation_only_returns_empty` | Y1 | S5, S6 | Port-level safety. |
| 8 | contract | `tests/contract/documentStore.searchContentKeyword.contract.ts::Y2_keyword_input_returns_hits` | Y2 | — | Port-level correctness. |
| 9 | integration | `tests/integration/SqliteDocumentStore.fts-sanitize.integration.test.ts::Y3_real_fts_no_syntax_error` | Y3 | S5 | Binding — real SQLite+FTS5. |
| 10 | integration | `tests/integration/SqliteDocumentStore.fts-sanitize.integration.test.ts::Y4_backticks_and_punctuation` | Y4 | S6 | Binding — real SQLite+FTS5. |
| 11 | integration | `tests/integration/SqliteDocumentStore.fts-sanitize.integration.test.ts::Y5_zero_token_short_circuit` | Y5 | S5, S6 | Binding — no MATCH call. |

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Dropping `AND`/`OR`/`NOT` as reserved keywords hurts recall for users whose notes literally use those as content. | They still participate in **vector** retrieval; only the BM25 leg drops them. RRF composition preserves such hits from the vector side. Documented in ADR-017 non-decisions. |
| 2 | The `[^0-9A-Za-z\u0080-\uFFFF]` tokenizer approximation is not byte-identical to SQLite's `unicode61`. | For OR-of-tokens the approximation is sufficient; diacritic-folding corner cases are rare and can be addressed by tightening the regex later. Documented in ADR-017 Consequences. |
| 3 | 64-term cap may truncate a deliberately long search query. | Vector retrieval still sees the full text; recall degrades only for the BM25 leg. Constant is configurable in future if it becomes a pain. |
| 4 | Behavioral change from "any user with a `?` in a prompt got an error" to "normal answer" may hide latent bugs in callers who treated that error as a signal. | Release notes / review-story check on changed surface (`Z6`); search for `fts syntax error` references across the repo during implementation. |

---

## Implementation Order

1. `src/core/domain/fts-sanitize.ts` — implement `buildFtsMatchQuery` per ADR-017 (covers A1–A6).
2. `tests/core/domain/fts-sanitize.test.ts` — red-first for A1–A6.
3. `src/sidecar/adapters/SqliteDocumentStore.ts::searchContentKeyword` — call new helper; handle `null` short-circuit; debug log.
4. `tests/contract/documentStore.searchContentKeyword.contract.ts` — contract rows Y1, Y2 (red-first).
5. `tests/integration/SqliteDocumentStore.fts-sanitize.integration.test.ts` — integration rows Y3, Y4, Y5 (red-first).
6. **Verify** — `npm run test` green; `/review-story BUG-4` clean.
7. **Final verify** — submit `"What did I do yesterday?"`, `` "Use the `foo` command" ``, and `"??!?"` in a populated vault; confirm no error slideout.

---

*Created: 2026-04-21 | Story: BUG-4 | Epic: 11 — Chat accuracy and UX bug fixes (REQ-006)*
