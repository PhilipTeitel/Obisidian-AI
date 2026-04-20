# REQ-003: Configurable coarse-K and content-only fallback for recall tuning

**Source material:**

- [`docs/requirements/REQUIREMENTS.md`](REQUIREMENTS.md) — §5 ("Retrieval phases", "Hybrid retrieval (iter-2)", "Content-only fallback"), §6 ("Retrieval configuration is honored by chat"), §7 ("Chat retrieval settings (iter-2)" — `chatCoarseK`), §15 ("Hybrid retrieval weighting").
- [`docs/decisions/ADR-012-hybrid-retrieval-and-coarse-k.md`](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) — Accepted. Binding ADR: configurable `chatCoarseK` (default 32, range 1–256), content-only fallback, chat/search parity.
- [`docs/decisions/ADR-003-phased-retrieval-strategy.md`](../decisions/ADR-003-phased-retrieval-strategy.md) — Accepted. Three-phase retrieval contract; iter-2 amendments state the coarse-K cap is superseded and the content-only fallback is part of the contract.
- [`docs/features/RET-4.md`](../features/RET-4.md) — legacy in-flight story (consulted for scope only; not authoritative on UX copy or wording).
- [`docs/requirements/REQ-001-grounding-policy.md`](REQ-001-grounding-policy.md) — related refined REQ; governs what happens when retrieval (including after fallback) is still empty.

**Date:** 2026-04-20
**Status:** Draft

---

## 1. Goals

Each goal traces to a line in the source material cited inline.

- **Let the user control how many coarse-phase summary candidates retrieval retains, instead of being silently capped at 8.** (REQUIREMENTS §5 *"The number of candidates retained at this phase must be configurable (`chatCoarseK` / equivalent setting); a hard cap of 8 is not acceptable"*; ADR-012 Decision 1 *"Remove the coarse-K cap; make it configurable"*; ADR-003 Amendments *"Coarse-K cap superseded"*.)
- **Recover recall when the summary phase fails to match**, by running an unrestricted content-vector ANN so relevant notes outside the top summary hits still surface. (REQUIREMENTS §5 *"When the coarse phase returns zero or too few candidates relative to a configurable floor, retrieval must fall back to an unrestricted content-vector ANN"*; ADR-012 Decision 2; ADR-003 Amendments *"Content-only fallback"*.)
- **Make chat retrieval honor the same recall tuning as semantic search**, so the user's `chatCoarseK` setting behaves identically in both panes. (REQUIREMENTS §6 *"Retrieval configuration is honored by chat … Chat must not ignore user retrieval tuning"*; ADR-012 Decision 6 *"No chat-vs-search divergence"*.)
- **Expose `chatCoarseK` as a visible, user-editable setting with defaults and bounds the user can see**, not a hidden constant. (REQUIREMENTS §7 *"`chatCoarseK` — number of candidate summary hits retained in the coarse phase"*; ADR-012 Decision 1 *"default 32, range 1–256"*.)
- **Preserve vault-only grounding when retrieval (including the fallback) is still empty.** The insufficient-evidence response from REQ-001 must still fire; the fallback must not weaken that guarantee, only reduce how often it is triggered spuriously. (REQUIREMENTS §1 *"Vault-only grounding is enforced, not conditional"*; ADR-012 Decision 2 *"This replaces RET-1 Y4's 'return empty' behavior with a graceful degradation path"*; REQ-001 S2.)

## 2. Non-goals

- **Not introducing hybrid retrieval (vector + FTS5 / RRF).** ADR-012 decisions 3–5 are layered in a separate story (RET-5 family) and are not part of this REQ. This REQ assumes vector-only recall at both the coarse and fallback phases unless hybrid is already enabled elsewhere. (ADR-012 Decision 5 *"The content-only fallback (decision 2) is independent of the hybrid toggle"*; RET-4 §1 *"does not introduce FTS5 (that is RET-5)"*.)
- **Not introducing temporal or path filters.** `pathGlobs` / `dateRange` filters are covered by ADR-014 / REQUIREMENTS §5 *"Temporal and path filters"* and are out of scope here.
- **Not redefining Phase 3 context assembly.** Token budgets, sibling context, heading-trail rendering remain as in REQ-001 / RET-2. (ADR-012 *Explicit non-decisions* *"This ADR does not change Phase 3 context assembly"*.)
- **Not re-deciding the default value of `chatCoarseK` or the fallback-floor formula.** Both are fixed by ADR-012 and are treated here as resolved; this REQ only specifies the observable behavior that follows from them.
- **Not redefining the insufficient-evidence response.** That surface is owned by REQ-001 and ADR-011; this REQ only asserts that it still fires when the fallback is also empty.
- **Not specifying internal implementation** (route handlers, dedup algorithm, logging fields, retrieval helper structure). Those are design/implementation concerns for the downstream story.

## 3. Personas / actors

- **Vault owner with a growing vault** — the Obsidian user whose vault has outgrown the 8-summary ceiling. They ask questions that touch many notes (e.g. "what did I write about Acme Corp this quarter?") and need recall that scales with their vault, not a hardcoded small constant. (Implied by REQUIREMENTS §4 *"vaults on the order of hundreds to thousands of notes"* and ADR-012 Context *"For vaults with hundreds of daily notes, 8 summary hits are not enough"*.)
- **Vault owner tuning retrieval** — the same user, acting in their configuration capacity. They expect to find `chatCoarseK` in the settings surface, see a sensible default, see the permitted range, and get feedback if they enter something invalid. (REQUIREMENTS §7 *"Chat retrieval settings (iter-2)"*; ADR-012 Decision 1.)
- **Vault owner whose summary phase missed** — the same user, asking a question where the summary vectors happen not to have captured the entity or phrasing in their query. They expect retrieval to still try, not silently give up. (ADR-012 Context *"Summary misses are terminal … Phase 2 is skipped entirely and the search returns empty"*; ADR-003 Amendments *"replaces the original 'return empty when Phase 1 is empty' policy"*.)

## 4. User scenarios (Gherkin)

### S1 — `chatCoarseK` setting controls the coarse-phase ceiling

```gherkin
Given the user has opened plugin settings
And   the user has set chatCoarseK to an integer value within the permitted range (for example 64)
When  the user subsequently submits a query in the chat pane or the semantic search pane
Then  the coarse (summary) phase of retrieval retains at most chatCoarseK candidate summary regions
And   the drill-down phase is executed against the descendants of those candidates
And   the 8-summary ceiling that previously applied no longer applies
```

*Traces to:* REQUIREMENTS §5 *"The number of candidates retained at this phase must be configurable"*; REQUIREMENTS §7 *"`chatCoarseK` — number of candidate summary hits retained in the coarse phase"*; ADR-012 Decision 1; ADR-003 Amendments *"Phase 1 now honors a user-configurable `coarseK`"*.

### S2 — Raising `chatCoarseK` recovers hits previously lost to the hard cap

```gherkin
Given the user has a vault large enough that more than 8 summary regions are relevant to their query
And   a prior version of the product returned zero or too few hits because the coarse phase was capped at 8 summaries
When  the user raises chatCoarseK to a value larger than 8
And   the user re-submits the same query
Then  the drill-down phase considers descendants of more than 8 candidate summary regions
And   relevant notes that were previously unreachable become reachable and can appear in results
```

*Traces to:* REQUIREMENTS §5 *"a hard cap of 8 is not acceptable"*; ADR-012 Context *"Phase 2 then only searches descendants of those 8 regions, so anything outside the top 8 summary matches is unreachable"*; ADR-012 Decision 1 *"kSummary is driven by an explicit, user-visible setting … The 8-cap is superseded"*.

### S3 — Content-only fallback fires when the coarse phase under-delivers

```gherkin
Given retrieval has run the coarse (summary) phase for the user's query
And   the coarse phase returned fewer usable candidate summary regions than the fallback floor defined by ADR-012 (max(4, floor(chatCoarseK / 4)))
When  the workflow proceeds to gather candidates for the drill-down phase
Then  retrieval additionally runs an unrestricted content-vector ANN against vec_content (no subtree filter)
And   the results of that content-only search are merged into the candidate set alongside any drill-down matches from the coarse regions
And   no single note content fragment appears twice in the merged candidate set (deduplicated by node identity)
```

*Traces to:* REQUIREMENTS §5 *"When the coarse phase returns zero or too few candidates relative to a configurable floor, retrieval must fall back to an unrestricted content-vector ANN (no subtree filter) so recall does not collapse when summaries failed to match"*; ADR-012 Decision 2 *"fallbackFloor … default: coarseK / 4, minimum 4 … runs an additional unrestricted vec_content ANN (no subtreeRootNodeIds filter) and merges its results into the candidate set"*; ADR-003 Amendments *"Content-only fallback"*.

### S4 — Coarse phase completely empty: fallback still runs

```gherkin
Given the user submits a query
And   the coarse (summary) phase returns zero candidate summary regions
When  retrieval proceeds
Then  the content-only fallback still runs against vec_content without a subtree filter
And   if the fallback returns matches, those matches are the candidate set handed to subsequent retrieval phases
And   the previous "summary empty ⇒ return empty" behavior no longer occurs
```

*Traces to:* ADR-012 Decision 2 *"This replaces RET-1 Y4's 'return empty' behavior with a graceful degradation path"*; ADR-003 Amendments *"replaces the original 'return empty when Phase 1 is empty' policy from RET-1 Y4"*; ADR-012 Context *"Summary misses are terminal".*

### S5 — Chat pane and search pane honor `chatCoarseK` identically

```gherkin
Given the user has configured a specific chatCoarseK value
When  the user submits the same query in the chat pane and in the semantic search pane
Then  both retrieval paths honor the same chatCoarseK ceiling on the coarse phase
And   both retrieval paths apply the same fallback-floor rule for the content-only fallback
And   chat retrieval does not silently revert to a different (e.g. hardcoded) coarse-K or assembly preset
```

*Traces to:* REQUIREMENTS §6 *"Retrieval configuration is honored by chat: Chat retrieval must apply the same user-configured retrieval settings … that the search pane uses. Chat must not ignore user retrieval tuning"*; ADR-012 Decision 6 *"Both SearchWorkflow and ChatWorkflow route retrieval through the same shared path and both respect chatCoarseK … The previous DEFAULT_SEARCH_ASSEMBLY hardcoded in SidecarRuntime.handleChatStream is replaced with the user's configured retrieval options".*

### S6 — Default `chatCoarseK` applies when the user has not set one

```gherkin
Given the user has not edited chatCoarseK in plugin settings
When  the user submits a query in the chat pane or the semantic search pane
Then  retrieval behaves as if chatCoarseK were set to the default value defined by ADR-012 (32)
And   the 8-summary ceiling does not reappear as an effective limit
```

*Traces to:* ADR-012 Decision 1 *"chatCoarseK, default 32, range 1–256"*; ADR-003 Amendments *"Phase 1 now honors a user-configurable coarseK (default 32); there is no hard cap at 8"*; REQUIREMENTS §7 *"chatCoarseK".*

### S7 — Invalid `chatCoarseK` values do not silently break recall

```gherkin
Given the user attempts to set chatCoarseK to a value outside the permitted range (<= 0, a non-integer, or larger than 256)
When  the user commits the setting
Then  the product either rejects the input or clamps it into the permitted range (1–256) as defined by ADR-012
And   the user receives visible feedback explaining what value will actually be used
And   no subsequent query silently falls back to 0, to an absurdly large value, or to a hidden legacy constant such as 8
```

*Traces to:* ADR-012 Decision 1 *"range 1–256"*; REQUIREMENTS §7 *"`chatCoarseK`"* (surfaced as a setting, implying user-visible validation). See Open question 1 for the precise reject-vs-clamp choice and feedback copy.

### S8 — Fallback still empty after running: insufficient-evidence response still fires

```gherkin
Given the user submits a chat query
And   the coarse phase returns fewer candidates than the fallback floor (including zero)
And   the content-only fallback against vec_content also returns zero usable matches
When  the chat workflow assembles its response
Then  the retrieval path hands an empty context set to the chat workflow
And   the built-in grounding policy causes the chat pane to emit the deterministic insufficient-evidence reply defined by REQ-001 / ADR-011
And   the assistant does not answer from general knowledge, does not fabricate sources, and does not instruct the user to paste their notes
```

*Traces to:* REQ-001 S2 (insufficient-evidence reply on empty retrieval); ADR-011 Decision 3 (vault-only grounding); ADR-012 Decision 2 *"graceful degradation path"* (fallback reduces but does not eliminate the empty-retrieval case); REQUIREMENTS §1 *"Vault-only grounding is enforced, not conditional".*

### S9 — Coarse phase above the floor: fallback does not run

```gherkin
Given the user submits a query
And   the coarse (summary) phase returns at least fallbackFloor usable candidate summary regions
When  retrieval proceeds
Then  the content-only fallback does not run on this query
And   the candidate set handed to subsequent phases is drawn from the coarse candidates' descendants only
```

*Traces to:* ADR-012 Decision 2 *"When the coarse phase returns fewer than a configurable floor of usable summary hits … the workflow runs an additional unrestricted vec_content ANN"* — implying the fallback does not run when the floor is met.

### S10 — Changing `chatCoarseK` takes effect without reindexing

```gherkin
Given the user has an indexed vault
And   the user changes chatCoarseK in plugin settings
When  the user submits a query after the setting has been saved
Then  the new chatCoarseK value governs that query and subsequent queries
And   the user does not have to reindex the vault, clear a cache, or restart Obsidian for the change to apply
```

*Traces to:* REQUIREMENTS §7 *"Chat retrieval settings (iter-2)"* (settings govern retrieval, not indexing); REQUIREMENTS §5 retrieval-phase behavior is separable from the indexing pipeline; ADR-012 Decision 1 *"threaded from plugin settings through the sidecar into the workflow"* — a runtime parameter, not a build-time constant.

## 5. Constraints

- **No hard cap of 8.** The `Math.min(k, 8)` cap previously applied to `kSummary` is removed. `kSummary` is driven by `chatCoarseK` (or the ADR-012 default when unset). (ADR-012 Decision 1; ADR-003 Amendments *"Coarse-K cap superseded".*)
- **`chatCoarseK` range and default are fixed by ADR-012.** Default 32; permitted range 1–256. This REQ does not re-decide those values. (ADR-012 Decision 1.)
- **Fallback-floor formula is fixed by ADR-012.** `fallbackFloor = max(4, floor(chatCoarseK / 4))`. This REQ does not re-decide the formula. (ADR-012 Decision 2.)
- **Content-only fallback is unrestricted over content vectors.** It runs against `vec_content` with no subtree/parent filter. Its results are merged with coarse-derived drill-down results and deduplicated by node identity. (ADR-012 Decision 2; REQUIREMENTS §5 *"unrestricted content-vector ANN".*)
- **Chat and search parity.** Both retrieval paths honor `chatCoarseK`, the fallback floor, and the fallback mechanism identically. Chat must not use a hidden preset in place of user settings. (REQUIREMENTS §6; ADR-012 Decision 6.)
- **Fallback independence from hybrid retrieval.** The content-only fallback runs regardless of whether hybrid retrieval (ADR-012 decisions 3–5) is enabled. (ADR-012 Decision 5 *"The content-only fallback (decision 2) is independent of the hybrid toggle".*)
- **Vault-only grounding preserved.** If retrieval (including the fallback) is still empty, the insufficient-evidence behavior from REQ-001 / ADR-011 still applies. The fallback shrinks the empty-retrieval case; it does not replace the grounding guarantee. (REQUIREMENTS §1; ADR-011 Decision 3; REQ-001 S2.)
- **Settings change at runtime.** `chatCoarseK` is a retrieval-time parameter; changing it does not require reindexing. (REQUIREMENTS §7; ADR-012 Decision 1 *"threaded from plugin settings through the sidecar into the workflow".*)
- **Invalid values do not silently drop recall.** Invalid `chatCoarseK` values must not cause silent coercion to 0, to a hidden legacy constant, or to an absurd value. The user is informed of the effective value. (ADR-012 Decision 1 range; see Open question 1.)

## 6. Resolved questions

| # | Question                                                                                                                                | Resolution                                                                                                                                                                                                      | Source                                                                                                                              |
|---|-----------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| 1 | Should the coarse phase keep its hard cap of 8 summary regions?                                                                         | No. The cap is removed; coarse-K is user-configurable via `chatCoarseK`.                                                                                                                                        | REQUIREMENTS §5 *"a hard cap of 8 is not acceptable"*; ADR-012 Decision 1; ADR-003 Amendments.                                      |
| 2 | What is the default value of `chatCoarseK`?                                                                                             | 32, with a permitted range of 1–256.                                                                                                                                                                            | ADR-012 Decision 1.                                                                                                                 |
| 3 | When should the content-only fallback fire?                                                                                             | When the coarse phase returns fewer than `max(4, floor(chatCoarseK / 4))` usable candidate summary regions, including zero.                                                                                     | REQUIREMENTS §5 *"fewer than a defined floor"*; ADR-012 Decision 2.                                                                 |
| 4 | Where does the fallback search?                                                                                                         | Against `vec_content` with no subtree/parent filter (unrestricted ANN).                                                                                                                                         | REQUIREMENTS §5 *"unrestricted content-vector ANN (no subtree filter)"*; ADR-012 Decision 2.                                        |
| 5 | Do chat and semantic search apply `chatCoarseK` and the fallback the same way?                                                          | Yes. Chat retrieval routes through the same shared retrieval path as search and honors the same settings.                                                                                                       | REQUIREMENTS §6 *"Chat must not ignore user retrieval tuning"*; ADR-012 Decision 6.                                                 |
| 6 | Does the fallback depend on whether hybrid retrieval is enabled?                                                                        | No. The content-only fallback is independent of the hybrid toggle.                                                                                                                                              | ADR-012 Decision 5 *"The content-only fallback (decision 2) is independent of the hybrid toggle".*                                  |
| 7 | If the fallback is also empty, does the assistant answer from general knowledge?                                                        | No. Retrieval returns an empty context set; REQ-001 / ADR-011's insufficient-evidence reply fires exactly as it does when retrieval was empty without a fallback.                                               | REQUIREMENTS §1; ADR-011 Decision 3; REQ-001 S2; ADR-012 Decision 2.                                                                |
| 8 | Does changing `chatCoarseK` require reindexing?                                                                                         | No. It is a retrieval-time parameter threaded from settings through the sidecar into the workflow.                                                                                                              | ADR-012 Decision 1 *"threaded from plugin settings through the sidecar into the workflow"*; REQUIREMENTS §7.                        |

## 7. Open questions

These are not resolved by the source material and block downstream story planning for the areas they touch.

- [ ] **Invalid-value UX: reject vs. clamp, and the exact user-visible feedback copy.** ADR-012 Decision 1 defines the range (1–256) but does not specify whether out-of-range entries are rejected at the input, silently clamped, or clamped with an inline warning. RET-4 §6c implies "clamp and warn inline", but RET-4 is a legacy story and is not authoritative. Product must confirm the policy and the exact feedback wording.
- [ ] **Definition of "usable" coarse candidates** for the purpose of the fallback-floor comparison. ADR-012 Decision 2 says "fewer than a configurable floor of **usable** summary hits" without defining whether usability is "any returned row" or requires a similarity / score threshold. Until decided, the observable behavior in S3/S4 assumes "usable" == "returned by the coarse phase". Interacts with REQ-001 Open question 3 ("Definition of 'usable context'").
- [ ] **Visibility of the fallback firing in the chat/search UI.** ADR-012 logs the decision internally, but whether the user should see any affordance indicating "we broadened the search because the summary phase under-delivered" is not specified. Default assumption: no user-visible affordance; fallback is transparent. Product may want to revisit if users are confused by occasional recall jumps.
- [ ] **Telemetry/observability of `chatCoarseK` and fallback frequency.** No requirement source specifies whether `chatCoarseK` effective value or the `fallback_fired` rate must be exposed to the user (debug info, log surface, etc.). RET-4 Z5 suggests debug logging at implementation level but does not specify user-visible surface.
- [ ] **Upper-bound tuning guidance.** ADR-012 permits `chatCoarseK` up to 256 but does not state at what point Phase 2 work makes queries noticeably slow on representative hardware. Whether the settings surface should warn the user for very high values (e.g. >128) is unspecified. Interacts with REQUIREMENTS §15 (telemetry / defaults).

## 8. Suggested ADR triggers

| Trigger | Why it likely needs an ADR | Related Sn |
|---------|----------------------------|------------|
| Configurable coarse-K, fallback-floor formula, content-only fallback against `vec_content`, chat/search parity. **Already satisfied by [ADR-012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) (Accepted, 2026-04-16)** — do not propose a new ADR. Downstream stories must cite ADR-012 in Linked ADRs and Binding constraints. | ADR-012 is the binding decision for `chatCoarseK` default/range, the fallback-floor formula, and the chat/search parity constraint. Easy to regress silently in any retrieval, sidecar-runtime, or settings path if not bound by ADR. | S1, S2, S3, S4, S5, S6, S7, S8, S9, S10 |
| Three-phase retrieval contract including the fallback amendment. **Already satisfied by [ADR-003](../decisions/ADR-003-phased-retrieval-strategy.md) (Accepted, amended for iter-2)** — do not propose a new ADR. Downstream stories cite ADR-003 for the retrieval-phase contract and its amendments. | ADR-003 fixes the coarse → drill-down → assembly sequence and, in its iter-2 amendments, records that the fallback replaces the original "return empty" policy and that the 8-cap is superseded. | S1, S3, S4, S9 |
| Interaction with vault-only grounding when retrieval (including fallback) is still empty. **Already satisfied by [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md) (Accepted)** via REQ-001 — no new ADR. | The fallback reduces but does not eliminate the empty-retrieval case; ADR-011 is the binding decision for what happens when retrieval is empty. Referenced here for cross-feature traceability only. | S8 |

## 9. Links

- Source material: see header.
- Related REQ files: [REQ-001 — Always-on vault-only chat grounding policy and insufficient-evidence response](REQ-001-grounding-policy.md) (governs the empty-retrieval path that this REQ's fallback feeds into).
- Related ADRs (already exist): [ADR-012 — Hybrid retrieval and configurable coarse-K](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) (Accepted); [ADR-003 — Phased retrieval strategy](../decisions/ADR-003-phased-retrieval-strategy.md) (Accepted, amended); indirectly: [ADR-011 — Vault-only chat grounding](../decisions/ADR-011-vault-only-chat-grounding.md) (Accepted, governs fallback-still-empty behavior via REQ-001).
- Related in-flight / legacy story: [RET-4 — Configurable coarse-K + content-only fallback](../features/RET-4.md) (consulted for scope only).

---

*Created: 2026-04-20 | Refined by: architect in Discovery Mode*
