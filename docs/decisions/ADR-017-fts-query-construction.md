# ADR-017: FTS query construction from free-form user text

**Status:** Accepted
**Date:** 2026-04-21

---

## Context

[BUG-001](../requests/BUG-001.md) / [REQ-006 S5–S6](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md) reports that submitting a chat prompt containing `?`, `!`, `.`, or inline backticks (`` ` ``) surfaces an error slideout like `Chat failed: fts syntax error near ?`. The user expects to type English prose — including punctuation and occasional inline code fences — and have the product handle it.

There is already a sanitizer at [`src/core/domain/fts-sanitize.ts`](../../src/core/domain/fts-sanitize.ts) that replaces `"`, `*`, `(`, `)`, `:`, `-`, `^` with spaces. That covers some FTS5 operators but **not** the characters that triggered the bug. SQLite FTS5's query parser defines a "bareword" as `{0-9, A-Z, a-z, and any character with code ≥ U+0080}`; every other character must be a separator or part of a recognized token (`"…"`, `()`, `*`, `AND`, `OR`, `NOT`, `NEAR`). Characters like `?`, `!`, `.`, and `` ` `` don't fit any of those categories and cause a parse error when they sit adjacent to a bareword.

The sanitizer also does not address three other real failure modes:

- **All-punctuation queries.** If every character gets stripped, the resulting empty string is passed to `MATCH`, which also errors.
- **Reserved keywords.** `AND`, `OR`, `NOT`, `NEAR` as tokens in a sentence (e.g. "pros and cons") are parsed as operators.
- **Tokenization mismatch.** The query parser and the content tokenizer (`unicode61 remove_diacritics 1/2`) have different rules. A sanitizer that just strips characters still leaves the parser to split the remainder in ways that diverge from how the content was indexed.

The failure path is user-visible and grounding-unrelated, so it shows up as a plugin bug rather than an insufficient-evidence state.

---

## Decision

Replace the current string-strip sanitizer with a **tokenize → quote → OR-combine** builder, and make the hybrid-retrieval leg zero-token-safe.

1. **Tokenize first.** Split user text on any character not in `[0-9A-Za-z\u0080-\uFFFF]`. This is a conservative approximation of FTS5's `unicode61` tokenizer output and is safe to run in core without linking SQLite. Discard empty tokens.

2. **Lowercase and drop reserved keywords.** Remove tokens equal (case-insensitive, after lowercasing) to FTS5 reserved keywords: `AND`, `OR`, `NOT`, `NEAR`. Do not try to preserve intent ("AND" as a joiner is rarely semantically important in vault search).

3. **Quote each token as a phrase.** Emit each surviving token as `"token"` (FTS5 phrase syntax). Phrase quoting neutralizes any residual edge case in the parser's grammar and makes explicit that we are matching the literal token.

4. **Combine with `OR`.** Join with ` OR ` into a disjunction. A conjunction (`AND`) would over-filter for casual questions; `OR` preserves recall and lets reciprocal-rank fusion downstream ([ADR-012](ADR-012-hybrid-retrieval-and-coarse-k.md)) compose with vector results.

5. **Zero-token fallback.** If tokenization yields an empty list (pure punctuation, emoji-only, whitespace), **skip the BM25 leg entirely** and rely on vector retrieval alone. Do not emit an empty `MATCH` expression. Never surface an FTS syntax error to the user.

6. **Length guard.** Cap the number of terms in the disjunction at `64` (configurable constant, not user-visible in MVP). Longer user texts can still be embedded for the vector leg; the BM25 leg uses the first 64 unique tokens after lowercasing and dedup. This prevents pathological 500-token prompts from producing massive OR queries.

7. **Apply at the adapter boundary.** Tokenize/quote/join lives in `src/core/domain/fts-sanitize.ts` (renamed or co-located as `buildFtsMatchQuery`); `SqliteDocumentStore.searchContentKeyword(...)` calls it and handles the zero-token case by returning `[]` immediately.

8. **Log, don't throw.** When a query reduces to zero tokens, log at `debug` with `scope: 'searchContentKeyword'` and return an empty hit list; the workflow continues with vector-only retrieval.

---

## Consequences

**Positive**

- `?`, `!`, `.`, `` ` ``, and every other non-alphanumeric character in user text stop producing FTS syntax errors — they simply don't contribute to the BM25 leg.
- Behavior is testable with one unit suite on `buildFtsMatchQuery` (pure function) and one integration suite on `SqliteDocumentStore.searchContentKeyword` (real SQLite + FTS5).
- Zero-token queries degrade gracefully to vector-only retrieval; no new error UX to design.
- `AND`/`OR`/`NOT`/`NEAR` no longer behave as magic operators when they appear naturally in prose.

**Negative / costs**

- Conjunction-style precision (`"Acme Corp" AND "contract"`) is not supported. Users who want that behavior need a future explicit search-operator syntax. Acceptable for MVP where recall-over-precision is appropriate.
- Very long prompts truncate to the first 64 tokens for the BM25 leg; vector retrieval still sees the full prompt so the overall quality impact is minor.
- The tokenizer approximation is not byte-identical to SQLite's `unicode61` (diacritic handling differs slightly). Close enough for OR-of-tokens; mismatch only affects rare diacritic edge cases and can be addressed by tightening the regex later.

---

## Alternatives considered

| Alternative | Why not chosen |
|-------------|----------------|
| Keep current character-strip approach and add `?`, `!`, `.`, `` ` `` to the stripped set | Fragile — the set will grow every time a new character breaks the parser. Doesn't handle reserved keywords or zero-token fallback. |
| Always wrap the whole query in FTS5 phrase syntax (`"the full query"`) | One-giant-phrase matches only exact substring; destroys recall. |
| Pass user text through SQLite's own tokenizer via `fts5_tokenize_*` helper functions | Couples core to SQLite; not reusable in tests that don't bind the native module. |
| Error out to the UI with a "try rephrasing" message | Worse UX; REQ-006 expected behavior says ordinary punctuation must be accepted silently. |
| Parse user queries with a custom query-syntax grammar (support `AND`/`OR`/`-term`/`"phrase"`) | Feature-grade work, not a bug fix. Out of scope for MVP. |

---

## Explicit non-decisions

- This ADR does **not** introduce a user-visible query language. There is no `AND`/`OR`/`-term` support.
- This ADR does **not** change the vector leg. Embeddings receive the raw user text verbatim.
- This ADR does **not** change the FTS5 tokenizer configured on `nodes_fts` (`unicode61 remove_diacritics 1/2` per [STO-4](../features/STO-4.md) / [ADR-012](ADR-012-hybrid-retrieval-and-coarse-k.md)).
- This ADR does **not** replace Reciprocal Rank Fusion ([ADR-012](ADR-012-hybrid-retrieval-and-coarse-k.md) Decision 4); it only fixes the input to the BM25 leg.
- This ADR does **not** address stemming, synonym expansion, or prefix matching; all future work.

---

## Links

- Requirements: [REQ-006 S5, S6](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md)
- Related README sections: [§23 User-Text Safety for Full-Text Search](../../README.md#23-user-text-safety-for-full-text-search), [§9 Three-Phase Retrieval](../../README.md#9-three-phase-retrieval)
- Related stories: BUG-4 (this ADR's primary consumer)
- Related ADRs: [ADR-012](ADR-012-hybrid-retrieval-and-coarse-k.md), [STO-4](../features/STO-4.md)
