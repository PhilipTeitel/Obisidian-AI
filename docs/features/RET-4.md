# RET-4: Configurable coarse-K + content-only fallback

**Story**: Replace the hard-coded `kSummary = Math.min(k, 8)` in [`SearchWorkflow.mapSearchK`](../../src/core/workflows/SearchWorkflow.ts) with a user-configurable `chatCoarseK` setting threaded through plugin settings → sidecar → workflow; add a **content-only fallback** ANN when the coarse phase returns fewer usable hits than a configurable floor; apply the same retrieval options to `ChatWorkflow` so chat and search do not diverge.
**Epic**: 5 — Retrieval, search workflow, and chat workflow
**Size**: Medium
**Status**: Complete

---

## 1. Summary

This story implements the refined requirement [REQ-003 — Configurable coarse-K and content-only fallback for recall tuning](../requirements/REQ-003-recall-tuning.md). It removes the silent `Math.min(k, 8)` ceiling on the coarse (summary) phase of retrieval, introduces a user-visible `chatCoarseK` setting (default **32**, range **1–256**) threaded from plugin settings through the sidecar into the workflow, and adds an unrestricted content-vector fallback that fires when the coarse phase under-delivers. Chat and semantic search must route through the same retrieval path so the user's tuning behaves identically in both panes.

The binding decision is [ADR-012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) — it fixes the default/range of `chatCoarseK`, the fallback-floor formula `max(4, floor(chatCoarseK / 4))`, the unrestricted `vec_content` ANN target, and the chat/search parity rule. [ADR-003](../decisions/ADR-003-phased-retrieval-strategy.md) is the phased-retrieval contract and its iter-2 amendments record that (a) the 8-cap is superseded and (b) the content-only fallback replaces the original "return empty when Phase 1 is empty" policy from RET-1 Y4. This story does **not** introduce hybrid retrieval / FTS5 / RRF (that is [RET-5](RET-5.md)) or temporal/path filters (that is [RET-6](RET-6.md)); ADR-012's decisions 3–5 are explicitly out of scope here. The content-only fallback is specified (per ADR-012 Decision 5) to run **independently of the hybrid toggle**, so this story ships the fallback in a vector-only world and it continues to work once hybrid lands.

All ten Gherkin scenarios S1–S10 from REQ-003 are in scope for this story and are mapped in §8a. The interaction with the insufficient-evidence response (REQ-003 S8 → REQ-001 S2 / ADR-011) is verified here by the **no-regression** criterion that, when both coarse and fallback are empty, retrieval still hands the chat workflow an empty context set and the existing grounding path fires unchanged; the actual deterministic reply surface is owned by REQ-001 / CHAT-3 and is not redefined here.

Legacy story (this file's prior revision) is superseded in place by this rewrite. Open questions from REQ-003 §7 (reject-vs-clamp policy wording, "usable" definition for the floor comparison, fallback-fired affordance, telemetry surface, upper-bound warning) are not resolved by the source material; this story adopts the minimum viable defaults recorded in §9 and flags any deviation as a risk there rather than silently deciding product policy.

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [`docs/decisions/ADR-012-hybrid-retrieval-and-coarse-k.md`](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) | **Accepted.** Binding source of truth for the configurable `chatCoarseK` (default 32, range 1–256), the fallback-floor formula `max(4, floor(chatCoarseK / 4))`, the unrestricted `vec_content` ANN target, the "fallback independent of hybrid toggle" rule (Decision 5), and the chat/search parity rule (Decision 6 — `DEFAULT_SEARCH_ASSEMBLY` is replaced by user settings). |
| [`docs/decisions/ADR-003-phased-retrieval-strategy.md`](../decisions/ADR-003-phased-retrieval-strategy.md) | **Accepted (amended for iter-2).** The three-phase retrieval contract (coarse summary → drill-down → assembly). Its iter-2 amendments record that the `min(k, 8)` cap is superseded and that the content-only fallback replaces the original "return empty when Phase 1 is empty" policy from RET-1 Y4 — both behaviors this story is required to deliver. |
| [`docs/decisions/ADR-011-vault-only-chat-grounding.md`](../decisions/ADR-011-vault-only-chat-grounding.md) | **Accepted.** Cross-feature constraint: when retrieval (including the fallback) is still empty, the vault-only grounding / insufficient-evidence reply defined by REQ-001 must still fire. This story must not weaken that guarantee; verified as a no-regression criterion in Phase Y. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (ADR-012, ADR-003, ADR-011 are all Accepted; this story is not a spike)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries (ADR-012 and ADR-003 amendments agree on `chatCoarseK`, the floor formula, and the fallback target; REQ-003 §2 and §5 mirror them; README §9 / Plugin Settings do not contradict)
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Section 4b (Ports & Adapters) lists every port/adapter this story creates or modifies, or states explicitly that no integration boundaries are touched
- [ ] Section 8a (Test Plan) is filled and **every AC ID** (including Phase Y and Phase Z) is referenced by at least one planned test row
- [ ] For every adapter in Section 4b, Section 8a contains both a **contract test against the port** and an **integration test against the real backing service** (no mock of the boundary the adapter owns), and Phase Y has a `(binding)` criterion citing the integration test file
- [ ] Every Gherkin `Sn` ID from [REQ-003](../requirements/REQ-003-recall-tuning.md) (S1–S10) is mapped to at least one acceptance test row in Section 8a — or the story explicitly states why a given `Sn` is out of scope here
- [ ] Phase Y includes at least one criterion with **non-mock** evidence where wrong-stack substitution is a risk (integration test against real SQLite `SqliteDocumentStore` exercising the fallback path)

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `mapSearchK` no longer applies `Math.min(k, 8)`. `kSummary` is driven by an explicit `coarseK` parameter on the search options, with a default constant (`DEFAULT_COARSE_K = 32`) used only when the caller does not provide one. (ADR-012 Decision 1; ADR-003 Amendments *"Coarse-K cap superseded"*.)
2. **Y2** — `SearchRequest` (and the chat options passed to `runChatStream`) accept optional `coarseK?: number`. Sidecar route handlers map `settings.chatCoarseK` onto the workflow option for `chat`; the search route does the same. Default and range (default 32, range 1–256) are documented in README Plugin Settings. (ADR-012 Decision 1.)
3. **Y3** — Content-only fallback fires when `coarseHits.length < fallbackFloor` where `fallbackFloor = max(4, Math.floor(coarseK / 4))`. The fallback runs `IDocumentStore.searchContentVectors(queryVector, coarseK, /* filter without subtreeRootNodeIds */)` and merges its results with Phase 2 descendants from the original coarse hits (dedup by `nodeId`). (ADR-012 Decision 2; REQ-003 S3.)
4. **Y4** — `ChatWorkflow` + [`SidecarRuntime`](../../src/sidecar/runtime/SidecarRuntime.ts) route retrieval through the **same shared helper** used by `SearchWorkflow`; the previously-hardcoded `DEFAULT_SEARCH_ASSEMBLY` in `SidecarRuntime.handleChatStream` is replaced with options derived from settings. Chat retrieval must not silently revert to a different (hardcoded) coarse-K or assembly preset. (ADR-012 Decision 6; REQ-003 S5.)
5. **Y5** — Empty-retrieval no-regression: if **even after fallback** the candidate set is empty, the existing empty-results path ([CHAT-3](CHAT-3.md) B1) fires unchanged and the deterministic insufficient-evidence reply from [REQ-001](../requirements/REQ-001-grounding-policy.md) S2 / [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md) is emitted. This story does not redefine that surface. (REQ-003 S8.)
6. **Y6** — The content-only fallback is gated **only** by the fallback-floor comparison, not by `enableHybridSearch`. Whether hybrid retrieval is enabled or disabled has no effect on whether the fallback runs. (ADR-012 Decision 5; REQ-003 §2 non-goal, §5 constraint.)
7. **Y7** — `chatCoarseK` is a retrieval-time parameter; changing it must take effect on the next query without reindexing, cache-clearing, or an Obsidian restart. (ADR-012 Decision 1 *"threaded from plugin settings through the sidecar into the workflow"*; REQ-003 S10.)
8. **Y8** — No forbidden imports introduced in `src/core/workflows/` (`npm run check:boundaries` continues to pass).

---

## 4b. Ports & Adapters

This story does **not** create a new port, but it puts the existing `IDocumentStore` port under new behavioral contract obligations (the fallback requires `searchContentVectors` to be callable **without** a `subtreeRootNodeIds` filter, against `vec_content`, and to return deduplicable `VectorMatch[]`). The only adapter is the existing `SqliteDocumentStore`, which is the real backing for the fallback path. Per the hexagonal pairing rule, the test plan below contains (a) a contract test row asserting the port's fallback-relevant behavior against any adapter, and (b) an integration test row exercising `SqliteDocumentStore` against a real SQLite database so silent substitution of the persistence boundary is detectable.

| Port name | Port file | Adapter(s) | Real backing service / fixture | Notes |
|-----------|-----------|------------|--------------------------------|-------|
| `IDocumentStore` | [`src/core/ports/IDocumentStore.ts`](../../src/core/ports/IDocumentStore.ts) | `SqliteDocumentStore` ([`src/sidecar/adapters/SqliteDocumentStore.ts`](../../src/sidecar/adapters/SqliteDocumentStore.ts)) | Local SQLite DB + `sqlite-vec` loaded in-process (hermetic fixture under `var/test/ret-4/*.db`, created and torn down per test run) | **Contract** — `searchContentVectors` must honor an absent `subtreeRootNodeIds` filter (unrestricted ANN) and return `VectorMatch[]` deduplicable by `nodeId`. **Integration** — real SQLite must return unrestricted content-vector matches when the filter is omitted, and the story's fallback code path must reach the real adapter end-to-end (no mocked boundary). No schema changes; no new port methods. |

---

## 5. API Endpoints + Schemas

No new HTTP/route endpoints. The sidecar's existing `chat` and `search` handlers gain an optional `coarseK` payload override and a settings-derived default. The domain types change as follows — both additions go in [`src/core/domain/types.ts`](../../src/core/domain/types.ts):

```ts
export interface SearchRequest {
  query: string;
  k?: number;
  apiKey?: string;
  tags?: string[];
  coarseK?: number; // new; clamped to [1, 256]; default DEFAULT_COARSE_K (32) when omitted
}

export interface ChatWorkflowOptions {
  search: SearchAssemblyOptions;
  apiKey?: string;
  coarseK?: number; // new; same clamp/default as SearchRequest.coarseK
}
```

Plugin settings gain one field, persisted and mirrored into the sidecar settings payload and into the message-protocol `chat` / `search` payload as an optional override:

```ts
export interface PluginSettings {
  // ...existing fields...
  chatCoarseK: number; // new; default 32; persisted as an integer in [1, 256]
}
```

No new port methods on `IDocumentStore`: the fallback reuses `searchContentVectors(queryVector, coarseK, filter)` with `filter.subtreeRootNodeIds` omitted (i.e. unrestricted over `vec_content`).

---

## 6. Frontend Flow

The settings tab gains one integer field; the search and chat panes do not change visually. Fallback firing is **transparent** to the user in MVP (REQ-003 Open question 3 — no affordance added here; revisit via a future story if users are confused by occasional recall jumps).

### 6a. Component / Data Hierarchy

```
SettingsTab
└── Retrieval section (existing)
    ├── Search result count (existing)
    └── Coarse candidate count `chatCoarseK` (new)
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `SettingsTab` (Retrieval section) | reads/writes `settings.chatCoarseK: number` | debounced save | Integer input; min 1, max 256; default 32; persisted on blur / debounce. |

### 6c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | N/A — settings render synchronously from persisted plugin data. |
| Error (non-integer / out of range) | Clamp the value into `[1, 256]` on commit and show an inline warning explaining the effective value (e.g. *"Value clamped to 256"*). Do not silently drop to 0, to a hidden legacy constant such as 8, or to an absurdly large value. (REQ-003 S7; REQ-003 Open question 1 recorded as a risk in §9.) |
| Empty (field blank) | Fall back to `DEFAULT_COARSE_K` (32) at retrieval time — equivalent to the user never having set it. (REQ-003 S6.) |
| Success (valid value) | Persist; next query uses the new value without reindexing. (REQ-003 S10.) |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `tests/core/workflows/SearchWorkflow.coarseK.test.ts` | Cap removed; default honored; override honored; fallback triggers at floor; fallback does not trigger above floor; empty-after-fallback returns `[]`. Covers S1, S2, S3, S4, S6, S9. |
| 2 | `tests/core/workflows/ChatWorkflow.coarseK.test.ts` | Chat uses shared retrieval helper and the same settings-derived `coarseK` as search. Covers S5. |
| 3 | `tests/sidecar/runtime/SidecarRuntime.chatRetrieval.test.ts` | `DEFAULT_SEARCH_ASSEMBLY` no longer hardcoded in `handleChatStream`; retrieval options come from settings; new `chatCoarseK` propagates into workflow on next request without restart. Covers S5, S10. |
| 4 | `tests/plugin/settings/SettingsTab.chatCoarseK.test.ts` | Settings field validation: clamp with inline feedback; empty → default. Covers S7. |
| 5 | `tests/contract/document-store.contract.ts` | Generic port contract suite: `searchContentVectors` with and without `subtreeRootNodeIds`; unrestricted call returns rows; results deduplicable by `nodeId`. Runs against every `IDocumentStore` adapter. Covers Y3 (port behavior). |
| 6 | `tests/integration/sqlite-document-store.fallback.test.ts` | Integration test against a real SQLite DB at `var/test/ret-4/fallback.db`: seeds `vec_content`, invokes `SqliteDocumentStore.searchContentVectors` without a subtree filter, and exercises the `SearchWorkflow` fallback end-to-end through the real adapter (no mocked boundary). Covers Y3 (binding integration evidence). |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/workflows/SearchWorkflow.ts` | Remove `Math.min(k, 8)` in `mapSearchK`; add `coarseK` option (and `DEFAULT_COARSE_K = 32`); implement fallback merge path (unrestricted `searchContentVectors` when `coarseHits.length < fallbackFloor`); dedup merged candidates by `nodeId`. |
| 2 | `src/core/workflows/ChatWorkflow.ts` | Accept and forward `coarseK`; route retrieval through the shared helper used by `SearchWorkflow` (per RET-1 Y5). |
| 3 | `src/core/domain/types.ts` | Extend `SearchRequest` and `ChatWorkflowOptions` with optional `coarseK?: number` (see §5). |
| 4 | `src/plugin/settings/SettingsTab.ts` | Add `chatCoarseK` field + clamp-and-warn validation; persist on debounce. |
| 5 | `src/plugin/settings/types.ts` (or equivalent plugin-settings schema file) | Add `chatCoarseK: number` with default 32 and migration-safe default for existing user configs. |
| 6 | `src/sidecar/runtime/SidecarRuntime.ts` | Replace `DEFAULT_SEARCH_ASSEMBLY` hardcode in `handleChatStream`; thread settings-derived retrieval options through both chat and search handlers; accept `coarseK` payload override. |
| 7 | `src/sidecar/http/httpServer.ts` | Pass `coarseK` from request payload to the sidecar runtime. |
| 8 | `src/sidecar/stdio/stdioServer.ts` | Same for the stdio transport. |
| 9 | `tests/core/workflows/SearchWorkflow.test.ts` | Update any existing assertion that asserted the `min(k, 8)` behavior; keep only assertions consistent with the new contract. |
| 10 | `README.md` | Plugin Settings section: document `chatCoarseK` (default 32, range 1–256); §9 Three-Phase Retrieval: note the fallback path. (No design-decision rewrite; summary-only to match ADR-012.) |

### Files UNCHANGED (confirm no modifications needed)

- `src/sidecar/adapters/SqliteDocumentStore.ts` — `searchContentVectors` already accepts an optional filter; omitting `subtreeRootNodeIds` is the fallback path. No schema changes.
- `src/sidecar/db/migrate.ts` — no new migration; `chatCoarseK` is a retrieval-time parameter, not persisted in the DB.
- `src/core/ports/IDocumentStore.ts` — no new methods; the fallback reuses the existing `searchContentVectors` signature.

---

## 8. Acceptance Criteria Checklist

### Phase A: Coarse-K configurability

- [x] **A1** — `chatCoarseK` setting controls the coarse-phase ceiling
  - With a fake store returning 40 summary hits and `coarseK = 25`, Phase 2 is invoked with descendants of exactly 25 candidate subtrees. The 8-summary ceiling does not re-enter.
  - Evidence: `tests/core/workflows/SearchWorkflow.coarseK.test.ts::A1_respects_coarseK_S1_S2(vitest)`

- [x] **A2** — Default `coarseK` is `DEFAULT_COARSE_K = 32`
  - When neither the caller nor the settings override `coarseK`, retrieval behaves as if `coarseK = 32`; `kSummary` is 32, not 8.
  - Evidence: `tests/core/workflows/SearchWorkflow.coarseK.test.ts::A2_default_32_S6(vitest)`

- [x] **A3** — `Math.min(k, 8)` cap is gone
  - Static check: `src/core/workflows/SearchWorkflow.ts` no longer contains the expression `Math.min(k, 8)` or any equivalent hardcoded 8-cap on `kSummary`.
  - Evidence: `rg -n "Math\.min\(k,\s*8\)" src/core/workflows/SearchWorkflow.ts` returns no matches.

### Phase B: Content-only fallback

- [x] **B1** — Fallback fires when coarse hits are below the floor
  - When coarse returns `< fallbackFloor` hits (where `fallbackFloor = max(4, floor(coarseK / 4))`), `IDocumentStore.searchContentVectors` is invoked with a filter that **lacks** `subtreeRootNodeIds`.
  - Evidence: `tests/core/workflows/SearchWorkflow.coarseK.test.ts::B1_fallback_fires_below_floor_S3(vitest)`

- [x] **B2** — Fallback results merged and deduplicated
  - Fallback results are merged with Phase 2 descendants from the coarse hits; no `nodeId` appears twice in the merged candidate set.
  - Evidence: `tests/core/workflows/SearchWorkflow.coarseK.test.ts::B2_merge_dedup_S3(vitest)`

- [x] **B3** — Coarse empty → fallback still runs; empty-after-fallback returns `[]`
  - When coarse returns zero hits, the fallback runs unconditionally. If the fallback is also empty, the workflow returns `results: []` (feeds the CHAT-3 insufficient-evidence path rather than a "terminal summary miss").
  - Evidence: `tests/core/workflows/SearchWorkflow.coarseK.test.ts::B3_coarse_empty_fallback_runs_S4_S8(vitest)`

- [x] **B4** — Fallback does **not** run when coarse is above the floor
  - When coarse returns `≥ fallbackFloor` hits, `searchContentVectors` is **not** invoked without a subtree filter; the candidate set is drawn from coarse descendants only.
  - Evidence: `tests/core/workflows/SearchWorkflow.coarseK.test.ts::B4_above_floor_no_fallback_S9(vitest)`

- [x] **B5** — Fallback is independent of `enableHybridSearch`
  - Toggling `enableHybridSearch` off (or leaving it off in the RET-4 vector-only world) does not disable the fallback; the fallback fires based only on the floor comparison.
  - Evidence: `tests/core/workflows/SearchWorkflow.coarseK.test.ts::B5_fallback_independent_of_hybrid_toggle_Y6(vitest)`

### Phase C: Chat/search parity

- [x] **C1** — `ChatWorkflow` uses settings-derived retrieval options
  - `ChatWorkflow` invoked from the sidecar runtime uses retrieval options derived from settings (including `coarseK`), not the legacy `DEFAULT_SEARCH_ASSEMBLY` constant. The same query in chat and search applies the same coarse-K ceiling and the same fallback rule.
  - Evidence: `tests/sidecar/runtime/SidecarRuntime.chatRetrieval.test.ts::C1_settings_propagate_to_chat_S5(vitest)`

- [x] **C2** — Chat and search share the same retrieval helper
  - Static/behavioral check: chat and search route through the same shared retrieval helper (per RET-1 Y5), so a change to retrieval behavior affects both paths identically.
  - Evidence: `tests/core/workflows/ChatWorkflow.coarseK.test.ts::C2_shared_retrieval_helper_S5(vitest)`

### Phase D: Settings surface & runtime changes

- [x] **D1** — Invalid `chatCoarseK` values are clamped with inline feedback
  - Committing a value `<= 0`, a non-integer, or a value `> 256` clamps to `[1, 256]` (or rejects the input at the control) and surfaces inline feedback stating the effective value. No subsequent query falls back to 0, to 8, or to an absurdly large value.
  - Evidence: `tests/plugin/settings/SettingsTab.chatCoarseK.test.ts::D1_clamp_and_warn_S7(vitest)`

- [x] **D2** — Changing `chatCoarseK` takes effect on the next query without reindexing
  - After the user saves a new `chatCoarseK` value, the next chat/search request uses the new value. No vault reindex, cache clear, or Obsidian restart is required.
  - Evidence: `tests/sidecar/runtime/SidecarRuntime.chatRetrieval.test.ts::D2_runtime_setting_change_S10(vitest)`

### Phase Y: Binding & stack compliance

- [x] **Y1** — **(binding)** No `min(k, 8)` cap remains in `SearchWorkflow`
  - The hardcoded 8-cap on `kSummary` is gone; `kSummary` is `coarseK` (or the default 32 when unset).
  - Evidence: `rg -n "Math\.min\(k,\s*8\)" src/core/workflows/SearchWorkflow.ts` returns no matches; also cross-checked by `tests/core/workflows/SearchWorkflow.coarseK.test.ts::A1_respects_coarseK_S1_S2`.

- [x] **Y2** — **(binding)** `SearchRequest` and `ChatWorkflowOptions` expose `coarseK?: number`; sidecar threads settings → workflow
  - Type check + runtime check: both interfaces accept `coarseK`; the sidecar passes `settings.chatCoarseK` into both workflows when no per-request override is supplied.
  - Evidence: `tests/sidecar/runtime/SidecarRuntime.chatRetrieval.test.ts::Y2_sidecar_threads_chatCoarseK(vitest)`

- [x] **Y3** — **(binding)** Content-only fallback is served by the real `SqliteDocumentStore`
  - Integration test against a real SQLite database (no mocked persistence) seeds `vec_content`, invokes `SearchWorkflow` with a query whose coarse phase returns below the floor, and asserts the fallback reaches `SqliteDocumentStore.searchContentVectors` with an **absent** `subtreeRootNodeIds` filter and returns merged, deduplicated candidates. This is the hexagonal pairing check for the `IDocumentStore` port — silent swapping of the persistence boundary for an in-memory fake would cause this test to fail.
  - Evidence: `tests/integration/sqlite-document-store.fallback.test.ts::Y3_fallback_hits_real_sqlite_S3_S4(vitest)`

- [x] **Y4** — **(binding)** `SidecarRuntime.handleChatStream` no longer uses `DEFAULT_SEARCH_ASSEMBLY`
  - Static + behavioral check: the `DEFAULT_SEARCH_ASSEMBLY` hardcode is removed from `handleChatStream`; retrieval options are derived from plugin settings. `rg -n "DEFAULT_SEARCH_ASSEMBLY" src/sidecar/runtime/SidecarRuntime.ts` returns no matches (or only an import removal).
  - Evidence: `tests/sidecar/runtime/SidecarRuntime.chatRetrieval.test.ts::Y4_no_default_search_assembly_hardcode_S5(vitest)` plus the grep above.

- [x] **Y5** — **(binding)** Empty-after-fallback preserves the insufficient-evidence path
  - When both coarse and fallback return zero usable matches, the workflow hands an empty context set to the chat path and the CHAT-3 / ADR-011 / REQ-001 S2 insufficient-evidence reply fires unchanged.
  - Evidence: `tests/core/workflows/ChatWorkflow.coarseK.test.ts::Y5_empty_after_fallback_keeps_grounding_S8(vitest)`

- [x] **Y6** — **(binding)** Fallback independent of hybrid toggle
  - Toggling `enableHybridSearch` has no effect on whether the content-only fallback runs; the gate is the floor comparison only.
  - Evidence: `tests/core/workflows/SearchWorkflow.coarseK.test.ts::B5_fallback_independent_of_hybrid_toggle_Y6(vitest)` (shared with B5).

- [x] **Y7** — **(binding)** `chatCoarseK` is a runtime parameter, not a build-time constant
  - Changing `chatCoarseK` between two requests changes the effective `kSummary` on the second request without any reindex / restart.
  - Evidence: `tests/sidecar/runtime/SidecarRuntime.chatRetrieval.test.ts::D2_runtime_setting_change_S10(vitest)` (shared with D2).

- [x] **Y8** — **(binding)** `IDocumentStore` contract covers the unrestricted `searchContentVectors` call
  - Contract test asserts that any adapter for `IDocumentStore` accepts `searchContentVectors(query, k)` with no filter (or filter lacking `subtreeRootNodeIds`) and returns `VectorMatch[]` with unique `nodeId`s suitable for dedup-merge. Guards against silent substitution of the port semantics.
  - Evidence: `tests/contract/document-store.contract.ts::Y8_unrestricted_content_search_contract(vitest)`

- [x] **Y9** — **(binding)** No forbidden imports in `src/core/workflows/`
  - `npm run check:boundaries` passes; core workflows do not import sidecar-only modules.
  - Evidence: `npm run check:boundaries`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths) — **N/A** for this story; no new client-side shared-type imports are introduced beyond existing conventions. If any new such import is added by the Implementer, it must use the alias.
- [x] **Z5** — New or modified code logs `coarseK`, the `fallback_fired` flag, and the final merged result count at `debug` level for each chat/search request (per the implementer's logging guidelines)
- [x] **Z6** — `/review-story RET-4` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface (machine-checkable summary line in the review output)

---

## 8a. Test Plan

Every AC ID in §8 (including Phase Y and Phase Z) appears in the **Covers AC** column of at least one row. Every Gherkin `Sn` from [REQ-003](../requirements/REQ-003-recall-tuning.md) (S1–S10) appears in **Covers Sn** of at least one row. Per the hexagonal pairing rule, `IDocumentStore` gets a **contract** row (#9) and `SqliteDocumentStore` gets an **integration** row against a real SQLite DB (#10); Phase Y1/Y3/Y8 cite them.

| # | Level | File::test name | Covers AC | Covers Sn | Notes |
|---|-------|------------------|-----------|-----------|-------|
| 1 | unit | `tests/core/workflows/SearchWorkflow.coarseK.test.ts::A1_respects_coarseK_S1_S2` | A1, Y1 | S1, S2 | Fake store w/ 40 summary hits; `coarseK = 25` → Phase 2 uses 25 subtrees; raising past 8 recovers previously unreachable notes. |
| 2 | unit | `tests/core/workflows/SearchWorkflow.coarseK.test.ts::A2_default_32_S6` | A2 | S6 | No override → `kSummary = 32`; 8-ceiling does not reappear. |
| 3 | unit | `tests/core/workflows/SearchWorkflow.coarseK.test.ts::B1_fallback_fires_below_floor_S3` | B1 | S3 | Coarse hits < `max(4, floor(coarseK/4))` → unrestricted `searchContentVectors` called. |
| 4 | unit | `tests/core/workflows/SearchWorkflow.coarseK.test.ts::B2_merge_dedup_S3` | B2 | S3 | Merged candidate set is deduplicated by `nodeId`. |
| 5 | unit | `tests/core/workflows/SearchWorkflow.coarseK.test.ts::B3_coarse_empty_fallback_runs_S4_S8` | B3 | S4, S8 | Coarse = 0 → fallback runs; fallback = 0 → `results: []` (feeds grounding path). |
| 6 | unit | `tests/core/workflows/SearchWorkflow.coarseK.test.ts::B4_above_floor_no_fallback_S9` | B4 | S9 | Coarse ≥ floor → unrestricted fallback call not made. |
| 7 | unit | `tests/core/workflows/SearchWorkflow.coarseK.test.ts::B5_fallback_independent_of_hybrid_toggle_Y6` | B5, Y6 | S3, S4 | `enableHybridSearch` on/off has no effect on fallback firing. |
| 8 | unit | `tests/core/workflows/ChatWorkflow.coarseK.test.ts::C2_shared_retrieval_helper_S5` | C2 | S5 | Chat routes through the same helper as search; same `coarseK` → same candidate set. |
| 9 | contract | `tests/contract/document-store.contract.ts::Y8_unrestricted_content_search_contract` | Y8 | S3, S4 | Generic port suite: `searchContentVectors` with/without `subtreeRootNodeIds`; unique `nodeId`s; runs against every `IDocumentStore` adapter. |
| 10 | integration | `tests/integration/sqlite-document-store.fallback.test.ts::Y3_fallback_hits_real_sqlite_S3_S4` | Y3 | S3, S4 | **Binding** — real SQLite DB at `var/test/ret-4/fallback.db`; no mocked persistence; exercises full fallback path through `SqliteDocumentStore`. |
| 11 | integration | `tests/sidecar/runtime/SidecarRuntime.chatRetrieval.test.ts::C1_settings_propagate_to_chat_S5` | C1 | S5 | Sidecar runtime test: settings-derived `coarseK` reaches `ChatWorkflow`; both panes get the same tuning. |
| 12 | integration | `tests/sidecar/runtime/SidecarRuntime.chatRetrieval.test.ts::Y2_sidecar_threads_chatCoarseK` | Y2 | S5 | `settings.chatCoarseK` is threaded into both chat and search handlers. |
| 13 | integration | `tests/sidecar/runtime/SidecarRuntime.chatRetrieval.test.ts::Y4_no_default_search_assembly_hardcode_S5` | Y4 | S5 | `handleChatStream` no longer references `DEFAULT_SEARCH_ASSEMBLY`. |
| 14 | integration | `tests/sidecar/runtime/SidecarRuntime.chatRetrieval.test.ts::D2_runtime_setting_change_S10` | D2, Y7 | S10 | Two sequential requests with different `chatCoarseK` — second request reflects the new value with no reindex/restart. |
| 15 | unit | `tests/plugin/settings/SettingsTab.chatCoarseK.test.ts::D1_clamp_and_warn_S7` | D1 | S7 | Out-of-range inputs clamp into `[1, 256]` with inline feedback; no silent drop to 0 / 8. |
| 16 | unit | `tests/core/workflows/ChatWorkflow.coarseK.test.ts::Y5_empty_after_fallback_keeps_grounding_S8` | Y5 | S8 | Empty after fallback → chat workflow receives empty context set → CHAT-3 / REQ-001 S2 path unchanged. |
| 17 | script | `rg -n "Math\.min\(k,\s*8\)" src/core/workflows/SearchWorkflow.ts` (returns no matches) | A3, Y1 | S1 | Manifest/source grep: 8-cap removed. |
| 18 | script | `npm run check:boundaries` | Y9 | — | No forbidden imports in `src/core/workflows/`. |
| 19 | script | `npm run build` | Z1 | — | Zero TS errors across workspaces. |
| 20 | script | `npm run lint` | Z2, Z3 | — | Lint clean; no new `any`. |
| 21 | script | `/review-story RET-4` | Z6 | — | Machine-checkable review summary, zero `high`/`critical` findings. |

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Larger `coarseK` raises Phase 2 work proportional to subtree fanout; at the permitted upper bound (256) queries may be noticeably slow on representative hardware. (REQ-003 Open question 5.) | Bound `kContent` separately from `coarseK`; default `coarseK = 32` is safe in measured vaults; revisit after telemetry. Upper-bound warning UX is out of scope here (flagged as REQ-003 OQ5). |
| 2 | Fallback masks genuinely empty vaults or genuinely-unanswerable queries. | Fallback returns empty when the content ANN returns empty; CHAT-3 / REQ-001 S2 insufficient-evidence path still fires (verified by Y5). |
| 3 | Existing tests asserting `Math.min(k, 8)` break. | Update assertions in RET-1 tests explicitly; RET-1 §5 already flagged this as implementer-defined. See File 9 in §7. |
| 4 | "Reject vs clamp" UX policy for out-of-range `chatCoarseK` is not decided by ADR-012 or REQUIREMENTS. (REQ-003 Open question 1.) | This story adopts **clamp-with-inline-warning** as the minimum viable default (matches legacy RET-4 §6c, keeps user's workflow uninterrupted, meets REQ-003 S7's "does not silently break recall" constraint). If Product decides to reject instead, the change is local to `SettingsTab.ts` and `tests/plugin/settings/SettingsTab.chatCoarseK.test.ts`. |
| 5 | Definition of "usable" coarse candidates for the floor comparison is not resolved. (REQ-003 Open question 2.) | This story treats "usable" == "returned by the coarse phase" (no additional similarity threshold). This is the conservative reading that keeps the fallback from over-firing or under-firing unpredictably. If Product later adds a score threshold, it plugs into the same comparison site. |
| 6 | Fallback firing is transparent — users may be confused by occasional recall jumps. (REQ-003 Open question 3.) | MVP ships with no user-visible affordance; `fallback_fired` is logged at `debug` (Z5) so support can triage. Revisit via a follow-up story if needed. |
| 7 | `DEFAULT_SEARCH_ASSEMBLY` removal from `handleChatStream` is a wide-blast-radius change; an accidental regression would silently diverge chat from search. | Phase Y4 `(binding)` criterion plus the dedicated integration test (row 13) catches this on every run. |

---

## Implementation Order

1. `src/core/domain/types.ts` — add `coarseK?: number` to `SearchRequest` and `ChatWorkflowOptions` (covers Y2 types; no behavior yet).
2. `src/plugin/settings/types.ts` + `src/plugin/settings/SettingsTab.ts` — add `chatCoarseK` field with default 32 and clamp-and-warn validation (covers D1; S7).
3. **Verify** — `npm run build` passes; settings UI renders the new field.
4. `src/core/workflows/SearchWorkflow.ts` — remove `Math.min(k, 8)` in `mapSearchK`; add `DEFAULT_COARSE_K`; thread `coarseK` into `kSummary`. Run `tests/core/workflows/SearchWorkflow.coarseK.test.ts` with just A1/A2/A3/Y1 to confirm the cap is gone before wiring the fallback. (covers A1, A2, A3, Y1; S1, S2, S6.)
5. `src/core/workflows/SearchWorkflow.ts` — implement fallback: compute `fallbackFloor = max(4, floor(coarseK / 4))`; when `coarseHits.length < fallbackFloor`, call `searchContentVectors(queryVector, coarseK)` with a filter lacking `subtreeRootNodeIds`; merge with Phase 2 descendants; dedup by `nodeId`. (covers B1, B2, B3, B4, B5, Y6; S3, S4, S8, S9.)
6. **Verify** — run `tests/core/workflows/SearchWorkflow.coarseK.test.ts` in full.
7. `src/core/workflows/ChatWorkflow.ts` — accept and forward `coarseK`; route retrieval through the same shared helper as search. (covers C2, Y5; S5, S8.)
8. `src/sidecar/runtime/SidecarRuntime.ts` — replace `DEFAULT_SEARCH_ASSEMBLY` in `handleChatStream`; derive retrieval options from plugin settings; accept per-request `coarseK` override. (covers C1, Y2, Y4, Y7; S5, S10.)
9. `src/sidecar/http/httpServer.ts`, `src/sidecar/stdio/stdioServer.ts` — pass `coarseK` from payload through to the runtime. (covers Y2; S5, S10.)
10. **Verify** — run `tests/sidecar/runtime/SidecarRuntime.chatRetrieval.test.ts` in full; confirm D2 (next-request takes effect without restart).
11. `tests/contract/document-store.contract.ts` — write the generic contract suite for the unrestricted `searchContentVectors` call. (covers Y8; S3, S4.)
12. `tests/integration/sqlite-document-store.fallback.test.ts` — write the integration test exercising the full fallback path through a real SQLite DB. (covers Y3; S3, S4.)
13. **Verify** — run contract + integration rows 9 and 10 against the real adapter; confirm no mocked persistence is involved in the binding evidence path.
14. `tests/core/workflows/SearchWorkflow.test.ts` — update any legacy assertion that still asserted `min(k, 8)`.
15. `README.md` — document `chatCoarseK` in Plugin Settings (default 32, range 1–256); note the fallback in §9 Three-Phase Retrieval.
16. **Verify** — `npm run check:boundaries` (Y9), `npm run build` (Z1), `npm run lint` (Z2/Z3).
17. **Final verify** — `/review-story RET-4` → zero `high`/`critical` `TEST-#`, `SEC-#`, `REL-#`, `API-#` findings (Z6); smoke-test chat + search panes in Obsidian with `chatCoarseK` set to 8, 32, 128 and observe behavior matches REQ-003 S1/S2/S5/S6/S10.

---

*Created: 2026-04-20 | Story: RET-4 | Epic: 5 — Retrieval, search workflow, and chat workflow*
