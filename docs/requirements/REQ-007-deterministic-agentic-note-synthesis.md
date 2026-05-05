# REQ-007: Deterministic agentic note synthesis

**Source material:**

- [`.cursor/plans/agentic_notes_assistant_13ea214e.plan.md`](../../.cursor/plans/agentic_notes_assistant_13ea214e.plan.md) — plan to move from single-shot RAG chat toward a bounded tool-using note assistant that can search, inspect, synthesize, and propose note edits.
- User request in current chat (2026-04-29) — requirement to make chat responses more deterministic by reasoning before retrieval, deriving queries from the prompt before vector search, supporting multiple queries for cross-references, and composing new notes such as a job-hunt activity summary for a workforce commission.
- User follow-up in current chat (2026-04-30) — clarification that job hunt is an example; the assistant should support other requested topics such as project notes, meeting-note summarization, and mentions of people.
- User follow-up in current chat (2026-04-30) — resolved defaults and constraints: default date range is one week; vault organization prompt remains configurable for different vaults; response format can be requested in the prompt; file writing is much later and no review UI is needed now; agent budgets should be fixed constants for now with actual token use logged; Ollama is first for pre-query reasoning, then OpenAI, with future providers behind hexagonal ports; retrieval plans should be logged.

**Date:** 2026-04-29
**Status:** Ready for Design

---

## 1. Goals

- **Make chat responses more deterministic and relevant** by replacing the current flow of programmatic prompt parsing plus immediate vector-store querying with a flow that reasons about the user request before issuing retrieval queries. (User request; plan Direction.)
- **Derive retrieval intent from the user prompt before searching**, including the topic, likely note scope, time range, and expected output type where those can be inferred from the request. (User request.)
- **Support multi-step retrieval when one query is insufficient**, including follow-up searches or note reads when initial results imply cross-references, related notes, or missing context. (User request; plan Epic 4.)
- **Use retrieved results to synthesize useful outputs, not only answer chat questions**, including generated note drafts that compile information scattered across daily notes. (User request; plan first workflow and safe edits.)
- **Enable high-value topic synthesis workflows across note types**, with examples including compiling job-hunt activities from daily notes, summarizing notes for a project, summarizing meeting notes, and collecting mentions of people. (User request and follow-up; plan Practical First Iteration.)

## 2. Non-goals

- **Not building a generic autonomous agent that can do anything in the vault.** The next iteration is constrained to deterministic retrieval planning, bounded tool use, and useful synthesis workflows. (Plan Practical First Iteration.)
- **Not allowing silent, unreviewed vault writes as the baseline behavior.** Note creation or edits are proposed for human review before write capability is allowed. (Plan `safe-edits` todo and Epic 6.)
- **Not replacing the existing index, vector store, or search substrate outright.** Current retrieval and storage pieces remain useful, especially `SearchWorkflow`, `SqliteDocumentStore`, and sidecar runtime wiring. (Plan Direction.)
- **Not relaxing vault-only grounding.** The assistant must continue to answer and synthesize from vault content rather than external knowledge. (Existing product requirement context; user request is about pre-query reasoning, not external sources.)
- **Not requiring exact identical prose across every run.** Determinism in this requirement uses a tiered standard: retrieval plan must be identical for the same prompt/settings/vault state; source set must be stable except documented ranking ties; draft structure must be repeatable for the requested output type; prose may vary if it preserves the same facts and source grounding. (User-resolved tiered determinism standard in §6.)
- **Not implementing vault file writes in the first core iteration.** The plugin may eventually save generated output to files using the existing configurable allowed-write-folder policy, but file writing is explicitly later so retrieval planning and synthesis can stabilize first. (User-resolved scope in §6.)
- **Not requiring a review UI for generated file output.** Since file writing is deferred, the first iteration does not need a proposed-edit review interface. (User-resolved scope in §6.)

## 3. Personas / actors

- **Vault owner synthesizing a topic across scattered notes** — Records information across daily notes, project notes, meeting notes, and people-related notes. They need the plugin to compile a requested topic into a useful note or summary without manually searching each source. Job-hunt reporting is one example, not the only target workflow. (User request and follow-up.)
- **Vault owner using chat for knowledge processing** — Asks the plugin to pull useful information from the vault and transform it into summaries, activity logs, or other notes. They expect the assistant to plan retrieval before searching so responses are relevant and consistent. (User request.)
- **Plugin maintainer / implementer** — Evolves the current single-shot RAG workflow into a bounded agent workflow while preserving useful existing retrieval, sidecar, and storage components. They need testable requirements for query planning, tool use, source provenance, and draft-note output. (Plan Direction and epics.)

## 4. User scenarios (Gherkin)

### S1 — The assistant creates a retrieval plan before querying

```gherkin
Given the user has indexed their vault
And   the chat pane is open
When  the user asks a synthesis or reporting question
Then  the assistant determines a retrieval plan before issuing vector-store or keyword-search requests
And   the retrieval plan includes the inferred topic or task, any inferred path or date scope, and the requested output type when those are present in the prompt
And   the retrieval plan uses a one-week date range when a date-bounded synthesis request lacks an explicit range
And   retrieval requests are derived from that plan rather than from raw prompt sanitization alone
```

*Traces to:* User request: "reasoning is needed before the query" and "The query needs to be determined from the prompt, then sent to the vector store."

### S2 — Planning failure does not degrade into irrelevant broad search

```gherkin
Given the user submits a prompt whose retrieval intent cannot be determined with enough specificity
When  the assistant attempts to plan retrieval
Then  the assistant does not issue an unconstrained broad vault search merely because the prompt text can be sanitized
And   the assistant either asks for the missing scope or returns an insufficient-evidence-style response that identifies what scope is missing
```

*Traces to:* User request: current prompt parsing and retrieval produces "inconsistent and irrelevant responses"; goal is more deterministic and useful behavior.

### S3 — The assistant can run multiple retrieval steps for cross-referenced context

```gherkin
Given the first retrieval step returns notes that reference related notes, people, projects, tags, or dates
And   the user request cannot be answered or synthesized completely from the first result set
When  the assistant continues the run
Then  it may issue additional planned searches or note-read operations for the related context
And   each additional retrieval step is tied to the original user task rather than an unrelated topic drift
And   the run remains bounded by fixed step, token, and tool budgets
```

*Traces to:* User request: "This might even require multiple queries in case there is cross-referencing"; plan Epic 4: bounded loop with max steps, max tokens, tool budget.

### S4 — A requested topic can be compiled from scattered notes into one draft note

```gherkin
Given the vault contains information about a user-requested topic scattered across multiple notes
And   the topic may appear in daily notes, project notes, meeting notes, or people-related notes
And   the user asks the assistant to compile or summarize that topic into one note
When  the assistant runs the workflow
Then  it searches or reads the relevant notes for the requested topic and any requested period or scope
And   it produces a draft note that consolidates the discovered information
And   if the prompt requests a response format, the draft follows that format where feasible
And   otherwise the draft uses a default structure appropriate to the detected synthesis task
```

*Traces to:* User request: job-hunt activity compilation example; user follow-up that other topics may include project notes, meeting-note summarization, and mentions of people.

### S5 — Synthesized note drafts include traceable vault sources

```gherkin
Given the assistant composes a draft note from retrieved vault content
When  the user reviews the draft
Then  the draft or its review metadata identifies the notes that contributed to the synthesized content
And   no source is listed unless its content contributed to the draft
And   the user can inspect the contributing sources before applying or copying the draft
```

*Traces to:* User request for useful compilation from search results; plan UX for agent runs and safe write/edit mode.

### S6 — Retrieval results are processed before final output generation

```gherkin
Given the assistant has executed one or more planned retrieval steps
When  it generates the final chat response or draft note
Then  the output is based on the retrieved notes and any note reads completed during the run
And   the output does not claim facts, activities, or sources that were not present in the retrieved vault context
And   if retrieved context is insufficient, the assistant states the gap instead of fabricating missing activities
```

*Traces to:* User request: "The results will then need to be used to generate the output"; existing vault-only grounding context.

### S7 — Repeated runs use stable retrieval intent for the same prompt and vault state

```gherkin
Given the vault index, settings, model configuration, and user prompt are unchanged
When  the user runs the same synthesis request more than once
Then  the assistant produces the same retrieval intent and equivalent search scopes
And   the same relevant source set is eligible for synthesis, subject only to documented ranking ties
And   the output follows the same requested structure for the requested output type
And   prose wording may vary only if it preserves the same facts and source grounding
```

*Traces to:* User request: "main objective for this plugin is to make the chat responses more deterministic"; resolved tiered determinism standard in §6.

### S8 — Retrieval plan and agent activity are logged

```gherkin
Given the assistant performs a multi-step retrieval and synthesis run
When  the run is complete
Then  the plugin logs the retrieval plan derived from the prompt
And   the logs include the searches performed, notes read, and source set used for synthesis
And   the logs include actual provider token usage when the provider reports it
And   the logged activity is sufficient to explain why the assistant used those sources during debugging
```

*Traces to:* Plan Epic 7 observability intent; user follow-up that the retrieval plan should go into logs.

### S9 — Generated output remains draft-only until later file-writing work

```gherkin
Given the assistant has generated a note draft or edit based on retrieved vault content
When  the first core iteration is in scope
Then  the plugin does not write the generated note or edit into the vault
And   the generated output is returned as draft content in the chat or workflow result
And   later file-writing work must use the plugin's configured allowed-write-folder policy
```

*Traces to:* User follow-up: file writing can eventually save to configured folders, but should be much later and does not need a review UI now.

## 5. Constraints

- The assistant must preserve the existing local-vault retrieval model: notes are retrieved from the indexed vault, not from external knowledge bases. (Existing project context; user request concerns retrieval order.)
- The current retrieval and storage pieces remain valid inputs to the next iteration; the main behavioral replacement is the single-shot chat orchestration. (Plan Direction.)
- Agent runs must be bounded by step, token, and tool budgets before any broad tool-using workflow is considered acceptable. (Plan Epic 4.)
- Agent run budgets should be fixed constants for now, set high enough for adequate testing and easy to tweak later. Do not add token-limit configurability yet. (User follow-up.)
- If an agent budget is exceeded, the event must be logged as a warning. (User follow-up.)
- The first pre-query reasoning implementation targets Ollama. OpenAI follows next; future providers should remain practical through the existing hexagonal architecture. (User follow-up.)
- Note creation or edits are out of scope for the first core iteration. Later file writing must honor the plugin's configured allowed-write-folder policy. (User follow-up.)
- The existing vault organization prompt configuration is the source for vault-specific conventions such as tags, headings, folders, daily-note filename dates, wikilinks, keywords, and other topic-identification hints. (User follow-up.)
- Bullet lists are the default output structure when the prompt does not request a different response format. (User follow-up.)
- Topic synthesis workflows must support information scattered across multiple note types rather than requiring the user to pre-assemble a single source note. Job-hunt reporting is an example, alongside projects, meetings, and people. (User request and follow-up.)

## 6. Resolved questions

| # | Question | Resolution | Source |
|---|----------|------------|--------|
| 1 | Is job-hunt activity compilation the required workflow, or only an example of the synthesis capability? | Job hunt is only an example. The assistant should support other requested topics such as project notes, meeting-note summarization, and mentions of people. | user (2026-04-30) |
| 2 | What measurable determinism bar is required for acceptance? | Use a tiered standard: retrieval plan must be identical for the same prompt/settings/vault state; source set must be stable except documented ranking ties; draft structure must be repeatable for the requested output type; prose may vary if it preserves the same facts and source grounding. | user (2026-04-30) |
| 3 | What default date range should topic synthesis use when the user does not state one? | Use one week as the default date range. | user (2026-04-30) |
| 4 | Should the vault organization prompt remain part of this feature? | Yes. Keep the existing vault organization prompt because different users or vaults may organize notes differently. | user (2026-04-30) |
| 5 | Can the response format be given in the prompt? | Yes. The assistant should honor an explicit response-format request in the prompt where feasible; otherwise it should use a default structure appropriate to the detected synthesis task. | user (2026-04-30) |
| 6 | Should generated output be saved to files in this iteration? | No. Output can eventually be saved to files using the plugin's existing allowed-write-folder configuration, but file writing should be left for much later so core functionality is preserved. No review UI is needed now. | user (2026-04-30) |
| 7 | What should the agent budget be? | The exact budget is not known yet. Skip token-limit configurability for now. Use constants set high enough for adequate testing and easy later tweaking. If a budget is exceeded, log it as a warning. Log actual token use, not just estimated use, when provider usage data is available. | user (2026-04-30) |
| 8 | Which provider should support pre-query reasoning first? | Ollama first, OpenAI next, with possible future providers behind the existing hexagonal architecture. | user (2026-04-30) |
| 9 | Where should the retrieval plan be exposed? | Put the retrieval plan into logs. | user (2026-04-30) |
| 10 | What identifies vault conventions for common synthesis targets? | Use the existing vault organization prompt configuration to describe conventions for a given vault. | user (2026-04-30) |
| 11 | What default output structure should synthesis use when the prompt does not request one? | Use bullet lists by default. | user (2026-04-30) |

## 7. Open questions

*(All clarifying questions raised during refinement have been resolved — see §6.)*

## 8. Suggested ADR triggers

| Trigger | Why it likely needs an ADR | Related Sn |
|---------|----------------------------|------------|
| Query-planning contract before retrieval | Defines the durable boundary between user prompt interpretation and search execution; replaces raw prompt sanitization as the primary retrieval driver. | S1, S2, S7 |
| Agent tool contract for search, note reads, daily-note discovery, and draft output | Introduces new internal tool interfaces and adapter contracts beyond the existing chat port. File-writing tools are deferred. | S3, S4, S8, S9 |
| Bounded agent loop policy | Step limits, token budgets, retry behavior, and stop conditions are long-lived reliability constraints. | S3, S6, S8 |
| Synthesis provenance contract | Generated notes need traceable contributing sources and rules for source inclusion/exclusion. | S4, S5, S6 |
| Future file-writing mode | Later decision on how generated output becomes vault files, including allowed folders, conflicts, and write safety. Review UI is not required by current scope. | S5, S9 |
| Provider/tool-calling support strategy | Ollama is first and OpenAI follows; tool-calling support may affect adapter contracts and future provider scope. | S1, S3, S7 |

## 9. Links

- Source material: see header
- Related REQ files: [REQ-001](REQ-001-grounding-policy.md) (vault-only grounding), [REQ-004](REQ-004-hybrid-and-filters.md) (path/date filters), [REQ-006](REQ-006-bug-001-chat-accuracy-ux-search.md) (source accuracy and daily-note time queries)
- Related ADRs (if any already exist): [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md), [ADR-012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md), [ADR-014](../decisions/ADR-014-temporal-and-path-filters.md), [ADR-015](../decisions/ADR-015-source-provenance-contract.md), [ADR-016](../decisions/ADR-016-natural-language-date-range-resolution.md)

---

*Created: 2026-04-29 | Refined by: architect in Discovery Mode*
