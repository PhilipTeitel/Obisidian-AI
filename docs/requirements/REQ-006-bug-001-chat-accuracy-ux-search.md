# REQ-006: BUG-001 — Chat source accuracy, selectable messages, vault-organization time queries, and search-safe prompts

**Source material:**

- [`docs/requests/BUG-001.md`](../requests/BUG-001.md) — full ticket: mismatched sources vs reply; non-selectable chat text; vault organization prompt ignored for time-based daily-note questions; FTS syntax errors on punctuation and backticks in user prompts.

**Date:** 2026-04-21
**Status:** Ready for Design

---

## 1. Goals

Each goal traces to BUG-001 (section headings and expected-behavior bullets).

- **Align what the user sees as “sources” with what the assistant actually used in the reply**, so notes listed as sources were referenced in the response and notes referenced in the response appear among sources. (BUG-001 §“Sources returned in chat response don't match the response”.)
- **Respect implied retrieval scope** when sources are shown: notes that appear as sources should not contradict the user’s stated or configured filtering intent described in BUG-001 (outside filtering criteria). (BUG-001 description: sources “outside the filtering criteria”.)
- **Allow normal text selection and copying** for both user and assistant messages in the chat pane. (BUG-001 §“Chat pane text not selectable”.)
- **Honor the vault organization prompt for time-based questions over daily notes**, so phrases like “over the last 2 weeks” narrow to daily notes under the user’s `daily/**` layout by filename date as described in the prompt, instead of refusing with an insufficient-evidence-style narrow-your-query message when the vault layout is already specified. (BUG-001 §“Vault organization prompt not being honored”; expected: notes “filtered by title under any folder within `daily`”.)
- **Treat user chat input as plain language**, including `?`, `!`, `.`, and `` ` ``, without surfacing a full-text search / FTS syntax error to the user for ordinary punctuation or inline code ticks. (BUG-001 §“Punctuation causes exception”.)

## 2. Non-goals

- **Not redefining the vault-only grounding policy or insufficient-evidence behavior in general** — only correcting the case where organization + time hints are already supplied yet the product still asks for folder/tag narrowing. (Contrast REQ-001; this REQ addresses the reported misfire, not the whole policy.)
- **Not specifying exact citation formatting** (inline links vs footnotes vs chips) beyond the consistency rules in §4. (BUG-001 speaks to presence/absence alignment, not UI chrome.)
- **Not introducing a new query language for end users** — the fix should preserve “type a sentence” ergonomics. (Implied by BUG-001 expected behavior for punctuation.)

## 3. Personas / actors

- **Vault owner using chat** — uses the chat pane to query structured daily notes (e.g. job search under `daily/**`). They rely on sources to open the right notes and expect the source list to match the answer. They copy text from chat for use elsewhere. (BUG-001 reproductions and expected behaviors.)
- **Vault owner who configured `vaultOrganizationPrompt`** — describes daily note paths, headings, tags, and that time-based questions should use filename dates. They expect natural time ranges to apply that layout without extra hand-holding when the prompt already defines it. (BUG-001 vault organization section.)

## 4. User scenarios (Gherkin)

### S1 — Sources list equals the set of notes actually used for the reply

```gherkin
Given the user has indexed their vault
And   the assistant has produced a chat reply
When  the user inspects the sources associated with that reply
Then  every note listed as a source is a note that was used in any way to produce the reply
And   every note used in any way to produce the reply appears among the listed sources
And   no note that failed the turn’s filtering criteria appears among the listed sources
```

*Traces to:* BUG-001 expected behavior bullets under “Sources returned…”. Resolves §6 Q1 (“outside filtering criteria” = “not meeting filtering criteria”) and Q3 (“referenced” = used in any way, including aggregations).

### S2 — Job-search date range query lists matching activities with matching sources

```gherkin
Given the vault contains daily or job-search notes that answer the question
And   the anchor date is "today" in the machine’s local time when determinable, otherwise in the configured UTC-offset fallback
When  the user enters in the message box "List out job search activities from March 16 onwards."
Then  the assistant filters by filename date to the inclusive range [March 16, today]
And   the assistant’s reply describes activities consistent with the user’s vault content in that range
And   the sources for that reply include the notes the answer draws from
And   no source is shown for notes that were not used for that answer
```

*Traces to:* BUG-001 steps to reproduce and expected behavior for sources/response alignment; §6 rows 2a, 2b, 2d.

### S3 — User and assistant chat text can be selected and copied

```gherkin
Given the user has sent a chat message
And   the assistant has replied in the chat pane
When  the user attempts to select text in the user message with the pointer or keyboard
Then  standard text selection works
When  the user attempts to select text in the assistant message with the pointer or keyboard
Then  standard text selection works
And   the user can copy the selected text to the clipboard
```

*Traces to:* BUG-001 “Chat pane text not selectable” and expected “Text should be selected”.

### S4 — “Last two weeks” with daily-note organization prompt uses daily tree by filename date

```gherkin
Given the user’s vaultOrganizationPrompt states that daily notes live under daily/** as YYYY-MM-DD.md
And   the prompt states that time-based questions should filter daily notes by filename date
And   the anchor date is "today" in the machine’s local time when determinable, otherwise in the configured UTC-offset fallback
When  the user enters "List out my job search activities over the last 2 weeks"
Then  the assistant filters daily notes by filename date to the range [today - 13, today] inclusive
And   the assistant retrieves and answers from relevant notes under the daily tree (including nested folders) per that prompt
And   the response is not replaced by a refusal that only asks for folder or tag narrowing when the prompt already defines the daily layout and date rule
```

*Traces to:* BUG-001 vault organization prompt example and expected behavior (“filtered by title under any folder within `daily`”); §6 rows 2a–2c.

### S5 — Sentence punctuation in the prompt does not cause a search-syntax failure

```gherkin
Given the user is composing a chat message
When  the user submits a message that is a normal sentence ending with "?" or "!" or "."
Then  the chat request does not fail with an FTS or full-text-syntax error attributable to that punctuation
And   the product treats the input as the user’s question, not as a raw search operator string
```

*Traces to:* BUG-001 “Punctuation causes exception” and expected “treat that sentence as a question” / “terminate a sentence with punctuation”.

### S6 — Inline backticks in the prompt do not cause a search-syntax failure

```gherkin
Given the user is composing a chat message
When  the user submits a message that contains inline "`" characters around words or phrases
Then  the chat request does not fail with an FTS or full-text-syntax error attributable to those characters
And   the user can use "`" in the prompt as in ordinary markdown-style typing
```

*Traces to:* BUG-001 expected behavior for "`" in the prompt.

### S7 — Aggregation answers still list every contributing source

```gherkin
Given the vault contains multiple daily notes that each contribute to an aggregate answer
When  the user submits a question that requires aggregation across those notes (e.g. "How many job applications did I log this month?")
And   the assistant returns an aggregate answer without naming each note inline
Then  every note that contributed to the aggregate is listed among the sources
And   no note that did not contribute to the aggregate is listed among the sources
```

*Traces to:* BUG-001 source/response alignment; resolves §6 Q3 (aggregation trust: sources must still reflect all used notes).

## 5. Constraints

- Behavior must remain consistent with **vault-only grounding** (no new “off-vault” sources). (Implied by product context in REQ-001; BUG-001 is about correctness of vault sources, not disabling grounding.)
- Fixes must not require users to **escape punctuation** for normal prose. (BUG-001 expected behavior.)
- **Platform:** Obsidian plugin chat UI — selection behavior must match user expectations for desktop (and any officially supported targets the product already claims). (BUG-001 reproduction in chat pane.)

## 6. Resolved questions

| # | Question | Resolution | Source |
|---|----------|------------|--------|
| 1 | What does “outside filtering criteria” mean for Sources? | **“Not meeting filtering criteria.”** If a given note does not appear in the final results used for the response, it must not appear in Sources. Sources is the set of notes actually used, nothing more. | user (2026-04-21) |
| 2a | Time range semantics — timezone anchor for phrases like “last 2 weeks.” | **Machine’s local time when it can be determined at runtime**; otherwise the configured UTC-offset fallback (row 2b). | user (2026-04-21) |
| 2b | Timezone fallback when local time is not determinable at runtime. | **User setting: integer UTC offset in hours** (e.g. `-5`), default `0`. Used only as fallback when local time cannot be determined. | user (2026-04-21) |
| 2c | What does “last N weeks” mean for filename-date filtering? | **Rolling N×7 days inclusive of today.** For “last 2 weeks” that is `[today - 13, today]` (14 days total), evaluated in the anchor timezone from rows 2a/2b. | user (2026-04-21) |
| 2d | Inclusivity of open-ended ranges like “from March 16 onwards.” | **Start date inclusive; end date = today inclusive.** | user (2026-04-21) |
| 3 | What does “referenced in the response” mean? | **“Used in any way for the response.”** Includes aggregation cases where individual notes are not named inline — if a note’s content contributed to the answer, it must be listed as a source. Rationale: aggregations without sources reduce trust. | user (2026-04-21) |

## 7. Open questions

*(All clarifying questions raised during refinement have been resolved — see §6.)*

## 8. Suggested ADR triggers

| Trigger | Why it likely needs an ADR | Related Sn |
|---------|----------------------------|------------|
| Contract for **sources vs retrieval set vs citations** (Sources = notes actually used to produce the reply, including aggregations) | Binding decision on what the UI promises and what the pipeline stores per turn; drives data model for per-turn provenance | S1, S2, S7 |
| **Timezone anchor and fallback** for natural-language date ranges (local time primary; integer UTC-offset setting as fallback) | Long-lived rule that defines "today," "last N weeks," and "from X onwards" across the product; introduces a new user setting | S2, S4 |
| **FTS / hybrid query construction** from user text (escaping, tokenization, pass-through to SQLite FTS5) | Long-lived search semantics and security/consistency | S5, S6 |
| **Chat pane rendering** (selectable text vs custom components) | May affect a11y, copy UX, and future rich widgets | S3 |
| **Applying `vaultOrganizationPrompt` to structured date paths** | How natural-language time maps to index queries and filters | S4 |

## 9. Links

- Source material: see header
- Related REQ files: [REQ-001](REQ-001-grounding-policy.md) (grounding and insufficient evidence), [REQ-002](REQ-002-user-chat-prompts.md) (vault organization prompt composition), [REQ-004](REQ-004-hybrid-and-filters.md) (hybrid retrieval and filters, if applicable)
- Related ADRs (if any already exist): [`ADR-011-vault-only-chat-grounding.md`](../decisions/ADR-011-vault-only-chat-grounding.md), [`ADR-012-hybrid-retrieval-and-coarse-k.md`](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md)

---

*Created: 2026-04-21 | Refined by: architect in Discovery Mode*
