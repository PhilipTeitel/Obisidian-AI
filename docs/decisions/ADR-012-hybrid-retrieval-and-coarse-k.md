# ADR-012: Hybrid retrieval (vector + FTS5) and configurable coarse-K

**Status:** Accepted  
**Date:** 2026-04-16

---

## Context

[ADR-003](ADR-003-phased-retrieval-strategy.md) established a three-phase retrieval strategy: coarse summary ANN → drill-down content ANN → context assembly. Two implementation choices made for [RET-1](../features/RET-1.md) have turned out to dominate false-negative behavior in practice:

1. **Coarse-K is hard-capped at 8.** [`mapSearchK`](../../src/core/workflows/SearchWorkflow.ts) computes `kSummary = Math.min(k, 8)`, so the coarse phase retains at most 8 candidate summary regions no matter how large the user's `k` or vault is. For vaults with hundreds of daily notes, 8 summary hits are not enough to cover recall for entity, date, or action queries. Phase 2 then only searches descendants of those 8 regions, so anything outside the top 8 summary matches is unreachable.
2. **Summary misses are terminal.** When the coarse phase returns nothing (summaries failed to capture the query's angle), Phase 2 is skipped entirely ([RET-1 Y4](../features/RET-1.md)) and the search returns empty — even when `vec_content` has close matches globally.

Additionally, current retrieval is **vector-only**. Exact-keyword queries (proper nouns, dates, tag-like tokens, code identifiers) often fail on cosine similarity when the surrounding note prose dilutes the signal. Hybrid retrieval (keyword + vector, fused) is a standard fix but has no place to live in the schema yet.

These issues compound with [ADR-011](ADR-011-vault-only-chat-grounding.md)'s insufficient-evidence response: an empty retrieval leads the user to a deterministic "nothing found" reply, so low recall shows up directly as perceived plugin quality.

---

## Decision

1. **Remove the coarse-K cap; make it configurable.** `mapSearchK` no longer applies `Math.min(k, 8)`. Instead, `kSummary` is driven by an explicit, user-visible setting (`chatCoarseK`, default **32**, range 1–256) threaded from plugin settings through the sidecar into the workflow. `kContent` continues to be derived from the final `k` requested by the caller. The `8`-cap is **superseded**; existing tests that assert `Math.min(k, 8)` must be updated.

2. **Content-only fallback on coarse misses.** When the coarse phase returns **fewer than a configurable floor** of usable summary hits (default: `coarseK / 4`, minimum 4), the workflow runs an additional **unrestricted `vec_content` ANN** (no `subtreeRootNodeIds` filter) and merges its results into the candidate set. This replaces RET-1 **Y4**'s "return empty" behavior with a graceful degradation path.

3. **Hybrid retrieval (vector + FTS5).** Add a SQLite **FTS5 virtual table** over `nodes.content`:
   - New migration `002_fts.sql` creates:
     ```sql
     CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
       content,
       content='nodes',
       content_rowid='rowid',
       tokenize='unicode61 remove_diacritics 2'
     );
     ```
   - Triggers mirror inserts/updates/deletes from `nodes` into `nodes_fts`.
   - `002_fts.sql` bumps `RELATIONAL_USER_VERSION` in [`src/sidecar/db/migrate.ts`](../../src/sidecar/db/migrate.ts). For existing databases the migration is additive; FTS5 content is backfilled either by a one-shot `INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')` on migration or by reindex — both are acceptable and documented in [user-storage-and-uninstall.md](../guides/user-storage-and-uninstall.md).
   - `IDocumentStore` gains a `searchContentKeyword(query: string, k: number, filter?: NodeFilter)` method that returns BM25-ranked `VectorMatch`-compatible rows.

4. **Reciprocal rank fusion (RRF).** Coarse-phase candidate ranking is produced by merging:
   - vector summary ANN results, and
   - BM25 keyword hits (from `nodes_fts` restricted to `type IN ('note','topic','subtopic')` for the coarse phase; all node types for the drill-down phase).

   Using reciprocal rank fusion with constant `k = 60`:
   \[
   \mathrm{score}(d) = \sum_{r \in \mathrm{rankings}} \frac{1}{k + \mathrm{rank}_r(d)}
   \]
   The top `coarseK` items by fused score drive Phase 2. RRF is preferred over learned rerankers because it is zero-parameter, deterministic, and cheap; weights are fixed in MVP per [REQUIREMENTS §15](../requirements/REQUIREMENTS.md) open question.

5. **Toggleable.** Hybrid retrieval is gated by a user setting `enableHybridSearch` (default **true**). When disabled, the workflow runs vector-only and neither the FTS5 query nor the RRF merge runs. The content-only fallback (decision 2) is independent of the hybrid toggle.

6. **No chat-vs-search divergence.** Both `SearchWorkflow` and `ChatWorkflow` route retrieval through the same shared path and both respect `chatCoarseK`, `enableHybridSearch`, and the content-only fallback. The previous `DEFAULT_SEARCH_ASSEMBLY` hardcoded in [`SidecarRuntime.handleChatStream`](../../src/sidecar/runtime/SidecarRuntime.ts) is replaced with the user's configured retrieval options.

---

## Consequences

**Positive**

- Coarse recall scales with vault size and user tuning, not an arbitrary constant 8.
- Entity/date queries that previously missed on vector similarity alone (e.g. "Acme Corp", "2026-02-14", `#jobsearch`) land via BM25.
- Summary-miss queries degrade gracefully via content-only fallback instead of returning empty.
- Chat and search behave consistently; one place to tune retrieval.

**Negative / costs**

- FTS5 doubles the write path on `nodes` inserts/updates (triggers). Still O(log N) per write; negligible vs embedding cost.
- Slightly larger DB (FTS5 index; roughly 30–80% of `nodes.content` depending on tokenizer options).
- RRF merges are additional CPU per query, but bounded: `coarseK` candidates from each side, single pass.
- Settings surface grows; defaults must be good.

---

## Alternatives considered

| Alternative                                                      | Why not chosen                                                                                                                      |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Raise `kSummary` cap to a larger constant (e.g. 64) without user control | Hides the tuning knob; still too small for large vaults and wastes budget on tiny ones.                                             |
| Replace phased retrieval with flat content ANN                   | Reintroduces the decontextualization problem [ADR-002](ADR-002-hierarchical-document-model.md) and [ADR-003](ADR-003-phased-retrieval-strategy.md) solved. |
| External keyword index (e.g. MeiliSearch)                        | Adds another process, breaks [ADR-006](ADR-006-sidecar-architecture.md) single-sidecar simplicity, duplicates persistence layer.    |
| Learned cross-encoder reranker                                   | Large model dependency, latency cost, and training/calibration complexity not warranted for MVP.                                    |
| Linear-combination fusion with tunable α                         | Requires score normalization across incomparable metrics (cosine vs BM25); RRF side-steps this with rank-only input.                |

---

## Explicit non-decisions

- This ADR does **not** define `nodes_fts` tokenizer details beyond unicode61 with diacritic folding; porter-stemmed or language-specific tokenizers are a later improvement.
- This ADR does **not** define a reranker step; candidates feed Phase 2 directly.
- This ADR does **not** change Phase 3 context assembly — token budgets and snippet formatting continue per [RET-2](../features/RET-2.md).
- RRF weights are fixed in MVP; user-tunable weights are an open question per [REQUIREMENTS §15](../requirements/REQUIREMENTS.md).

---

## Links

- Requirements: [REQUIREMENTS §5](../requirements/REQUIREMENTS.md), [§7](../requirements/REQUIREMENTS.md), [§8](../requirements/REQUIREMENTS.md), [§15](../requirements/REQUIREMENTS.md)
- Supersedes: coarse-K cap in [`src/core/workflows/SearchWorkflow.ts::mapSearchK`](../../src/core/workflows/SearchWorkflow.ts); `DEFAULT_SEARCH_ASSEMBLY` hardcoded in [`SidecarRuntime.handleChatStream`](../../src/sidecar/runtime/SidecarRuntime.ts)
- Related README sections: [§9 Three-Phase Retrieval](../../README.md#9-three-phase-retrieval), [§8 SQLite Schema](../../README.md#8-sqlite-schema), [Plugin Settings](../../README.md#plugin-settings)
- Related stories: [RET-1](../features/RET-1.md), [RET-2](../features/RET-2.md), RET-4, RET-5, STO-4
- Related ADRs: [ADR-002](ADR-002-hierarchical-document-model.md), [ADR-003](ADR-003-phased-retrieval-strategy.md), [ADR-011](ADR-011-vault-only-chat-grounding.md)
