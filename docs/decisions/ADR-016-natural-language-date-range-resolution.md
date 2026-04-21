# ADR-016: Natural-language date range resolution

**Status:** Accepted
**Date:** 2026-04-21

---

## Context

[ADR-014](ADR-014-temporal-and-path-filters.md) introduced `dateRange` as an optional filter on retrieval, keyed off `note_meta.note_date` parsed from daily-note filenames. It does not decide how **natural-language** date phrases in user chat prompts ("last 2 weeks", "from March 16 onwards", "this month") are resolved into the concrete `{ start, end }` pair that ADR-014 consumes.

[BUG-001](../requests/BUG-001.md) / [REQ-006 S4](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md) reports the user-visible failure: with a `vaultOrganizationPrompt` that states daily notes live under `daily/**/YYYY-MM-DD.md` and that time-based questions should filter daily notes by filename date, asking *"List out my job search activities over the last 2 weeks"* returns an "insufficient evidence — please narrow by folder or tag" response. The layout is already fully specified by the user; the product simply is not doing the date math.

The user resolved the ambiguities explicitly in REQ-006 §6:

- **Q2a** — "today" is anchored to the **machine's local time** when determinable at runtime.
- **Q2b** — when not determinable, fall back to a **user-configured integer UTC offset in hours**, default `0`.
- **Q2c** — "last N weeks" means a **rolling `N × 7` days inclusive of today** (`[today − (N×7 − 1), today]`).
- **Q2d** — open-ended ranges like "from March 16 onwards" are **inclusive on the start and inclusive on the end (= today)**.

This ADR binds those rules so the behavior is consistent across `ChatWorkflow`, `SearchWorkflow`, and any future slash-command UI surface.

---

## Decision

1. **Anchor "today" in local time when available.** The sidecar resolves the current date via `new Date()` and formats `YYYY-MM-DD` in the process's local timezone. When running inside Obsidian's Electron environment this matches the user's OS timezone. No third-party tz database is bundled.

2. **Introduce a plugin setting `timezoneUtcOffsetHours`** (integer, range `-12..+14`, default `0`). The sidecar consults this setting **only** when the machine's local time is not determinable (deterministically: when `Intl.DateTimeFormat().resolvedOptions().timeZone` is undefined or when the running process has no usable `TZ`). The offset is in hours (whole numbers); partial-hour offsets (e.g. India +5:30) are an explicit non-decision for MVP and documented as a known limitation.

3. **"Last N weeks" = rolling `N × 7` days inclusive of today.** For `N = 2` on anchor `2026-04-21`: `start = 2026-04-08`, `end = 2026-04-21`. Locale-independent; no week-start consideration.

4. **Open-ended "from X onwards" = inclusive on both ends, end pinned to today.** `"from March 16"` with anchor year `2026` → `{ start: '2026-03-16', end: '2026-04-21' }` inclusive. When the year is ambiguous in the user text, the sidecar assumes the most recent past occurrence; if the resolved start would be in the future, clamp `start = end = today` (defensive) and log a debug line.

5. **Pluggable natural-language phrase set (MVP minimal).** The initial set of recognized phrases is:

   | Phrase | Resolves to (anchor = today) |
   |--------|------------------------------|
   | `last N weeks` / `past N weeks` / `last N days` / `past N days` | `[today − (N × 7 − 1), today]` / `[today − (N − 1), today]` |
   | `this week` | `[today − 6, today]` (rolling 7 days) |
   | `this month` | `[first-of-this-calendar-month, today]` |
   | `last month` | `[first-of-previous-calendar-month, last-day-of-previous-calendar-month]` |
   | `yesterday` | `[today − 1, today − 1]` |
   | `today` | `[today, today]` |
   | `from <date> onwards` / `since <date>` | `[<date>, today]` |
   | `from <date> to <date>` / `between <date> and <date>` | `[<date1>, <date2>]` inclusive |

   Unrecognized phrases fall through with no `dateRange` injected — the retrieval proceeds as a plain vault-wide query. This is a non-blocking fallback, not an error.

6. **Date-math is server-side in the sidecar.** The chat workflow performs the phrase parse and sets `ChatRequestPayload.dateRange` and — when the vault-organization prompt's `dailyNotePathGlobs` apply — `pathGlobs` before calling retrieval. The LLM never sees the resolved dates, and the user's prompt is treated as a retrieval hint, not a query to the model. This is what allows REQ-006 S4's expectation — "not replaced by a refusal that only asks for folder or tag narrowing" — to be met deterministically.

7. **Wire the setting through the payload.** `ChatRequestPayload` gains `timezoneUtcOffsetHours?: number`; the plugin reads it from settings and sends it per request ([ADR-011](ADR-011-vault-only-chat-grounding.md) Decision 4 per-request transport). No sidecar-side caching.

---

## Consequences

**Positive**

- REQ-006 S2 ("from March 16 onwards") and S4 ("last 2 weeks") are deterministic and testable with fixed anchor dates.
- `vaultOrganizationPrompt` becomes actionable for time queries without LLM heuristics.
- Users in non-UTC environments get correct rolling-window behavior out of the box; users whose sidecars cannot determine timezone have a documented escape hatch.
- No new third-party dependency: stdlib `Date` + trivial arithmetic is sufficient for whole-hour offsets.

**Negative / costs**

- Phrase set grows over time; each new phrase needs a parser branch and a test.
- Half-hour / quarter-hour timezones (India, Nepal, etc.) are not correctly handled by the integer offset. Documented limitation until a future ADR introduces IANA tz support.
- Ambiguous year parsing ("from March 16") has an implicit rule (most recent past occurrence); users with historical questions must write `from 2024-03-16`.

---

## Alternatives considered

| Alternative | Why not chosen |
|-------------|----------------|
| Ship a bundled IANA tz database | Larger sidecar bundle, new dependency, slower install — overkill for MVP when the primary anchor is always "today". |
| Let the LLM resolve the date range in its response, then parse it back | Violates [ADR-011](ADR-011-vault-only-chat-grounding.md); reintroduces hallucination risk ("last week" → wrong dates). |
| Calendar-week semantics (Monday-start) | User explicitly chose rolling 14 days (REQ-006 Q2c) because it is locale-independent and deterministic. |
| Start-exclusive range for "from X onwards" | User explicitly chose start-inclusive (REQ-006 Q2d) because it matches natural-language "onwards". |
| Silent UTC fallback with no setting | Loses testability and misleads users near midnight; user rejected the option. |

---

## Explicit non-decisions

- This ADR does **not** define half-hour or quarter-hour timezone offsets. `timezoneUtcOffsetHours` is integer-only in MVP.
- This ADR does **not** define parsing for relative phrases beyond the table in Decision 5. Extending that table is additive and does not require re-opening this ADR.
- This ADR does **not** override [ADR-014](ADR-014-temporal-and-path-filters.md)'s raw `{ start, end }` contract — explicit ISO dates from the UI (e.g. slash-command inputs) bypass natural-language parsing and go straight to `dateRange`.
- This ADR does **not** change how `note_meta.note_date` is populated; that stays with [ADR-014](ADR-014-temporal-and-path-filters.md) and [STO-4](../features/STO-4.md).
- This ADR does **not** define localization of phrase parsing. English-only for MVP.

---

## Links

- Requirements: [REQ-006 S2, S4, §6 Q2a–d](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md)
- Related README sections: [§22 Natural-Language Date Range Resolution](../../README.md#22-natural-language-date-range-resolution), [Plugin Settings](../../README.md#plugin-settings)
- Related stories: BUG-3 (this ADR's primary consumer)
- Related ADRs: [ADR-011](ADR-011-vault-only-chat-grounding.md), [ADR-014](ADR-014-temporal-and-path-filters.md), [ADR-015](ADR-015-source-provenance-contract.md)
