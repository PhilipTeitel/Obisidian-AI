# Tuning chat behavior: system prompt + vault organization

This guide explains how to use the two user-editable settings that shape chat behavior in the Obsidian AI plugin:

- **Chat system prompt** (`chatSystemPrompt`) — persona, tone, and style preferences.
- **Vault organization prompt** (`vaultOrganizationPrompt`) — how _your_ notes are organized, so the assistant can target retrieval correctly.

Both are optional, are sent with every chat request, and are appended after the built-in vault-only grounding policy (see [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md)). They cannot override the grounding policy — the assistant will still answer only from your vault and will still return an insufficient-evidence response when retrieval finds nothing.

## Why two prompts?

The built-in grounding policy tells the assistant **how to behave** (answer only from the vault, don't invent sources, don't ask the user to paste notes). It does **not** know anything about your vault, because no default assumption would be correct for everyone.

- `vaultOrganizationPrompt` fills that gap with **factual, user-specific conventions** — a short description of how you write notes. This lets the assistant translate natural-language questions into the right retrieval intent.
- `chatSystemPrompt` expresses **stylistic preferences** that are independent of your vault — tone, output format, language.

Keep them short. Both together should be at most a few hundred tokens; long prompts crowd out retrieval context and are truncated when the combined system-message budget is exceeded.

## Vault organization prompt — what to include

Write it like you would brief a new assistant joining your team. Useful elements:

- **Where daily notes live** and their filename pattern.
- **Folder conventions** — what lives where.
- **Tag conventions** — what each tag means.
- **Section headings** you reuse (e.g. `## Job search`, `## Meetings`, `## Retrospective`).
- **Recurring entry types** — journals, meetings, reading notes, interview prep.

Avoid:

- Vague preferences ("be thorough"). Use `chatSystemPrompt` for those.
- Secrets or credentials. This prompt is sent with every chat request and may be logged at `debug`.
- Instructions that contradict the grounding policy ("use web search", "answer from general knowledge"). These will be ignored.

### Examples

**Daily-notes vault (job search + journal)**

```
Daily notes live in `Daily/YYYY-MM-DD.md`. Each day I use these headings when relevant:
- `## Job search` — applications, networking, interviews, follow-ups. Tagged `#jobsearch`.
- `## Journal` — personal reflection, mood, energy. Tagged `#journal`.
- `## Work` — meetings and project status from $EMPLOYER. Tagged `#work`.

Interview notes live in `Job Search/Interviews/{company}.md`. Application tracking lives in `Job Search/Applications/{company}.md`.

Time-based questions ("last two weeks", "this month") should filter daily notes by filename date.
```

**Research vault**

```
Notes are organized by project in `Projects/{project}/`. Each project has:
- `Notes.md` — running thoughts and TODOs.
- `Reading/{paper-slug}.md` — one note per paper, with frontmatter `doi:`, `authors:`, `year:`. I summarize the abstract in `## Summary` and my own takeaways in `## Notes`.
- `Writing/` — draft fragments; tagged `#draft`.

Tags: `#method/{name}` for methodology mentions; `#dataset/{name}` for datasets; `#open-question` for things I want to revisit.
```

**Work vault**

```
Meeting notes live in `Meetings/YYYY-MM-DD - {topic}.md` with frontmatter `attendees:` (list) and `project:` (string). Action items are bulleted under `## Actions` and tagged with the owner, e.g. `#alex`.
1:1s are in `1-1/{person}/YYYY-MM-DD.md`. Performance-review drafts live under `Reviews/{cycle}/{person}.md`.
Project status updates live in `Projects/{project}/Status/YYYY-Wnn.md` (ISO week).
```

## Chat system prompt — what to include

Use this for style only. Examples:

- `"Answer in British English. Prefer short paragraphs over bullet lists unless the user asks for a list."`
- `"When summarizing daily notes, produce a compact bulleted report grouped by tag."`
- `"If asked for a draft email, write it in a warm but concise register and keep it under 150 words."`

Don't use it to redefine what the assistant is. The grounding policy is authoritative; the assistant will ignore style instructions that conflict with vault-only answering.

## Interaction with the insufficient-evidence response

When retrieval returns nothing usable, the assistant emits a product-owned **insufficient-evidence response** that explains what was searched and suggests how to narrow the query. Your `chatSystemPrompt` does **not** affect that response text — it is fixed per policy version. If you see insufficient-evidence replies on questions you believe are answered in your vault:

1. Check the **vault organization prompt** — does it describe where the answer should live?
2. Try a more specific query ("in my daily notes from the last two weeks, what did I log under Job search?").
3. Confirm indexing completed for those notes (Progress pane).
4. Consider tuning retrieval settings (result count, coarse-K, hybrid toggle) — see Plugin Settings.

## Related

- [ADR-011 — Vault-only chat grounding](../decisions/ADR-011-vault-only-chat-grounding.md)
- [Authoring notes for better semantic search and chat](authoring-for-ai-indexing.md)
- [REQUIREMENTS §6 — Chat and agent](../requirements/REQUIREMENTS.md)

---

_Part of Epic 10 (DOC-3). Authored alongside CHAT-3 / CHAT-4._
