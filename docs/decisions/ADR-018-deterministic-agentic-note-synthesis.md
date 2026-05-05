# ADR-018: Deterministic agentic note synthesis loop

**Status:** Accepted
**Date:** 2026-04-30

---

## Context

[REQ-007](../requirements/REQ-007-deterministic-agentic-note-synthesis.md) changes the chat architecture from single-shot RAG toward deterministic topic synthesis. The current flow derives a sanitized retrieval query from the prompt, queries the vector/keyword store, then asks the model to reason over whatever came back. That produces inconsistent and irrelevant responses when the prompt needs planning before retrieval, multiple searches, cross-reference follow-up, or a synthesized note draft.

Existing ADRs still apply:

- [ADR-006](ADR-006-sidecar-architecture.md) keeps heavy workflow orchestration in the sidecar.
- [ADR-011](ADR-011-vault-only-chat-grounding.md) requires vault-only grounding.
- [ADR-014](ADR-014-temporal-and-path-filters.md) and [ADR-016](ADR-016-natural-language-date-range-resolution.md) define retrieval filters and date resolution.
- [ADR-015](ADR-015-source-provenance-contract.md) requires sources to equal notes actually used.
- [ADR-005](ADR-005-provider-abstraction.md) keeps providers behind ports and adapters.

REQ-007 resolves the remaining product choices: default date scope is one week when a date-bounded synthesis request has no explicit range; vault conventions come from `vaultOrganizationPrompt`; prompt-requested output formats should be honored where feasible; bullet lists are the default structure; file writing is deferred; agent budgets are fixed constants for now; actual token usage and retrieval plans are logged; Ollama is the first pre-query reasoning provider, OpenAI follows.

---

## Decision

1. **Chat becomes a bounded agentic synthesis workflow.** `ChatWorkflow` evolves from `retrieve once -> assemble context -> complete once` to:

   ```text
   interpret prompt -> produce retrieval plan -> run bounded note tools -> synthesize answer or draft
   ```

   The workflow remains in `src/core/workflows/` and runs inside the sidecar through the existing transport boundary.

2. **Retrieval plan is explicit and logged.** Before vector or keyword retrieval, the workflow produces a structured retrieval plan containing at least:

   - user task / synthesis intent
   - topic or entities to search
   - effective date range, using one week when a date-bounded synthesis request omits an explicit range
   - path/date/tag scope derived from settings, the prompt, and `vaultOrganizationPrompt`
   - requested output type or format
   - planned tool calls

   The plan is logged with run correlation fields. Logs must not include raw note content or secrets.

3. **Tiered determinism standard.** For the same prompt, settings, model configuration, and vault index state:

   - retrieval plan must be identical
   - source set must be stable except documented ranking ties
   - draft structure must be repeatable for the requested output type
   - prose may vary only if it preserves the same facts and source grounding

4. **Bounded tools, not arbitrary autonomy.** The first tool surface is limited to deterministic note operations such as search, note read, daily-note/path/date scoped discovery, and draft output assembly. Tools call existing retrieval/storage abstractions; they do not bypass `SearchWorkflow`, `IDocumentStore`, grounding, or provenance rules.

5. **Draft-only output in the first core iteration.** The workflow may return synthesized draft content, but it must not write files to the vault. Later file-writing work must use the plugin's existing allowed output folder configuration. A review UI is not required by this ADR.

6. **Output structure.** If the prompt requests a response format, the workflow should honor it where feasible. Otherwise, synthesized output defaults to bullet lists.

7. **Provider rollout.** Ollama is the first provider used for pre-query reasoning. OpenAI follows next. Future providers remain additive through the provider abstraction.

8. **Budgeting and usage logging.** Agent step, tool-call, and token budgets are fixed constants in the first iteration, set high enough for testing and easy to tune later. Do not add token-limit settings yet. If a budget is exceeded, log a `warn` event. Log actual provider token usage when the provider reports it; do not rely only on estimates.

---

## Consequences

**Positive**

- Retrieval is driven by explicit intent rather than raw prompt sanitization.
- Multi-step synthesis can follow cross-references and related notes while staying bounded.
- The same prompt/vault/settings state has a testable determinism bar.
- Users can ask for useful note-like outputs without enabling vault writes.
- Observability improves: debugging can inspect the retrieval plan, tool calls, sources, budgets, and actual token use.

**Negative / costs**

- `ChatWorkflow` becomes more complex and needs contract/integration tests for plan determinism, tool budgets, provenance, and draft output.
- Ollama model behavior varies by local model choice; test fixtures must pin model-compatible expectations where possible.
- Actual token usage may not be available from every provider response; logs must distinguish reported usage from unavailable usage.

---

## Alternatives considered

| Alternative | Why not chosen |
|-------------|----------------|
| Keep single-shot RAG and improve prompt sanitization | Does not satisfy REQ-007's requirement to reason before querying or support multi-query synthesis. |
| Build a generic autonomous vault agent immediately | Too broad for the next iteration; weakens determinism and increases write-safety risk. |
| Add file writing with the first synthesis iteration | User explicitly deferred file writes to preserve the core retrieval/planning/synthesis functionality. |
| Expose token budget configuration immediately | User explicitly chose constants for now, with actual usage logging to inform later tuning. |
| Require byte-for-byte identical prose | Overly brittle for LLM output; tiered determinism focuses on plan, source set, structure, and factual grounding. |

---

## Explicit non-decisions

- This ADR does **not** decide the exact TypeScript shape of the retrieval-plan object; story planning should define the contract and tests.
- This ADR does **not** require file writes, proposed edit application, conflict handling, or a review UI.
- This ADR does **not** add new persistent database tables for agent traces; logs are sufficient for the first iteration.
- This ADR does **not** supersede grounding, date filtering, provenance, or provider ADRs.
- This ADR does **not** require OpenAI pre-query reasoning in the first story slice.

---

## Links

- Requirements: [REQ-007](../requirements/REQ-007-deterministic-agentic-note-synthesis.md)
- Related README section: [Key Design Decisions — Deterministic Agentic Note Synthesis](../../README.md#24-deterministic-agentic-note-synthesis)
- Related ADRs: [ADR-005](ADR-005-provider-abstraction.md), [ADR-006](ADR-006-sidecar-architecture.md), [ADR-011](ADR-011-vault-only-chat-grounding.md), [ADR-014](ADR-014-temporal-and-path-filters.md), [ADR-015](ADR-015-source-provenance-contract.md), [ADR-016](ADR-016-natural-language-date-range-resolution.md)
- Related stories: TBD

---

## File naming

`docs/decisions/ADR-018-deterministic-agentic-note-synthesis.md`
