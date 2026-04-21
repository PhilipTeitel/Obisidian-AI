# BUG-3: Natural-language date range resolution with local-time anchor and UTC-offset fallback

**Story**: Resolve natural-language time phrases in chat prompts ("last 2 weeks", "from March 16 onwards", "this month") into concrete `{ start, end }` date ranges on the sidecar — anchored in the machine's local time with a configurable UTC-offset fallback — and compose the result with `dailyNotePathGlobs` onto the retrieval request when the user's `vaultOrganizationPrompt` describes a daily-note layout. Fixes BUG-001 / [REQ-006 S4](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md) (and strengthens S2).
**Epic**: 11 — Chat accuracy and UX bug fixes (REQ-006)
**Size**: Medium
**Status**: Open

---

## 1. Summary

[BUG-001](../requests/BUG-001.md) reports that asking *"List out my job search activities over the last 2 weeks"* returns an insufficient-evidence refusal ("please narrow by folder or tag") even though the user's `vaultOrganizationPrompt` already states daily notes live under `daily/**/YYYY-MM-DD.md` and that time-based questions should filter daily notes by filename date. [REQ-006 S4](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md) sets the fix: when the vault layout is specified, the product must do the date math itself rather than asking the user to re-specify.

This story implements the user-resolved semantics from [REQ-006 §6](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md) Q2a–d, bound in [ADR-016](../decisions/ADR-016-natural-language-date-range-resolution.md):

- Anchor "today" in the **machine's local time** when determinable; fall back to the new `timezoneUtcOffsetHours` setting (integer, default `0`) when not.
- "Last N weeks" = rolling `N × 7` days inclusive of today.
- Open-ended ranges ("from X onwards") are inclusive on the start and end at today inclusive.

A new core module `src/core/domain/dateRangeResolver.ts` parses a user prompt for recognized time phrases and emits a `{ start, end }` in ISO form plus a match-summary for logging. [`runChatStream`](../../src/core/workflows/ChatWorkflow.ts) calls the resolver on the last user message before retrieval; if a phrase is found, the resulting `dateRange` is merged into the `SearchRequest` and — when `vaultOrganizationPrompt` indicates a daily-note layout — `dailyNotePathGlobs` from settings are attached as `pathGlobs` so retrieval targets daily notes by [ADR-014](../decisions/ADR-014-temporal-and-path-filters.md). Unrecognized phrases fall through silently — retrieval proceeds unscoped, and the user sees no new error UX.

**Out-of-scope `Sn` from REQ-006:** S1, S3, S5, S6, S7 (owned by BUG-1, BUG-2, BUG-4). S2 is **covered here** (`from March 16 onwards` is a recognized phrase) even though BUG-1 also partially touches it; this story owns the date-math piece and BUG-1 owns the source-provenance piece of S2.

**Prerequisites:** [RET-6](RET-6.md) (dateRange + pathGlobs), [CHAT-4](CHAT-4.md) (`vaultOrganizationPrompt` in payload), [PLG-4](PLG-4.md) (settings tab). **Linked REQ:** [REQ-006](../requirements/REQ-006-bug-001-chat-accuracy-ux-search.md).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [`docs/decisions/ADR-016-natural-language-date-range-resolution.md`](../decisions/ADR-016-natural-language-date-range-resolution.md) | Primary ADR — defines anchor, fallback, rolling-weeks, open-ended-range, and the MVP phrase set. |
| [`docs/decisions/ADR-014-temporal-and-path-filters.md`](../decisions/ADR-014-temporal-and-path-filters.md) | Resolved `dateRange` is consumed through this ADR's pathway (`note_meta.note_date`, `pathGlobs`). |
| [`docs/decisions/ADR-011-vault-only-chat-grounding.md`](../decisions/ADR-011-vault-only-chat-grounding.md) | `vaultOrganizationPrompt` composition and per-request transport; no override of grounding policy. |
| [`docs/decisions/ADR-012-hybrid-retrieval-and-coarse-k.md`](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) | Hybrid retrieval composes with the resulting `dateRange`/`pathGlobs`; no retrieval change in this story, but composition must hold. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs (ADR-016, ADR-014, ADR-011, ADR-012) exist and are **Accepted**
- [ ] README §22 (Natural-Language Date Range Resolution), API Contract `chat` row, and Plugin Settings row `timezoneUtcOffsetHours` do not contradict ADR-016 on anchor/fallback/inclusivity rules
- [ ] Section 4 lists 7 bullets restated from ADR-016 Decisions 1–7
- [ ] Section 4b declares "no new adapter" and links the ports/adapters already in play ([ADR-014](../decisions/ADR-014-temporal-and-path-filters.md) already paired)
- [ ] Section 8a Test Plan rows cover A1–A8, B1–B3, Y1–Y6, Z1–Z6; Gherkin S2 and S4 from REQ-006 both appear in at least one row
- [ ] Phase Y contains at least one `(binding)` criterion that uses a **fixed anchor date** (injectable clock) to verify the rolling-14-days formula end-to-end

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Anchor "today" is the machine's local time when `Intl.DateTimeFormat().resolvedOptions().timeZone` is defined at runtime.
2. **Y2** — When local time is not determinable, use `timezoneUtcOffsetHours` (integer, default `0`) as the fallback; no silent UTC.
3. **Y3** — "Last N weeks" resolves to `[today − (N×7 − 1), today]` inclusive; "this week" is `[today − 6, today]`; "last N days" is `[today − (N − 1), today]`.
4. **Y4** — Open-ended "from X onwards" / "since X" resolves to `[X, today]` inclusive on both ends.
5. **Y5** — Resolver is **pure** and accepts an injectable "now" for testing; no hidden `Date.now()` in the domain layer.
6. **Y6** — Unrecognized phrases do not raise errors; the chat flow proceeds without a `dateRange` (no new error UX).
7. **Y7** — When `vaultOrganizationPrompt` declares a daily-note layout (detected by the presence of a daily-note glob in settings), the resolved `dateRange` is paired with `dailyNotePathGlobs` as `pathGlobs` on the retrieval request; otherwise only `dateRange` is attached.

---

## 4b. Ports & Adapters

**Not applicable — this story does not introduce or modify any port or adapter.** The parser is a pure core module; the settings surface extends existing plugin settings (not a port). Composition into `SearchRequest` happens in `ChatWorkflow`, upstream of `IDocumentStore`. The `IDocumentStore.searchSummaryVectors` / `searchContentVectors` surfaces already accept `NodeFilter.dateRange` and `NodeFilter.pathRegex` / `NodeFilter.pathLikes` (from [RET-6](RET-6.md) / [ADR-014](../decisions/ADR-014-temporal-and-path-filters.md)). No adapter integration test is required for binding compliance; binding is asserted on `dateRangeResolver` (unit, with fixed anchor) and end-to-end on the chat path with a known vault fixture (Phase Y).

---

## 5. API Endpoints + Schemas

Extend `ChatRequestPayload` in [`src/core/domain/types.ts`](../../src/core/domain/types.ts):

```ts
export interface ChatRequestPayload {
  messages: ChatMessage[];
  context?: string;
  apiKey?: string;
  timeoutMs?: number;
  systemPrompt?: string;
  vaultOrganizationPrompt?: string;
  groundingPolicyVersion?: string;
  coarseK?: number;
  enableHybridSearch?: boolean;
  pathGlobs?: string[];
  dateRange?: { start?: string; end?: string };
  search?: SearchAssemblyOptions;
  /** BUG-3 / ADR-016: integer UTC offset (−12..+14) used only when local TZ is undetectable in the sidecar. */
  timezoneUtcOffsetHours?: number;
  /** BUG-3 / ADR-016: hints whether the user's vault uses daily notes so the resolver can compose pathGlobs. */
  dailyNotePathGlobs?: string[];
}
```

Extend `SidecarPluginSettings` in [`src/plugin/settings/types.ts`](../../src/plugin/settings/types.ts) with `timezoneUtcOffsetHours: number` (default `0`, validated range `-12..+14`). Extend [`src/plugin/settings/SettingsTab.ts`](../../src/plugin/settings/SettingsTab.ts) with a numeric input under a **"Time and locale"** section, clamped and validated on save.

The plugin's chat dispatch reads both `timezoneUtcOffsetHours` and the existing `dailyNotePathGlobs` from settings and includes them on every chat payload ([ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md) Decision 4 per-request transport).

New core module interface:

```ts
// src/core/domain/dateRangeResolver.ts
export interface ResolverClock {
  now(): Date;
  timeZone(): string | undefined;
}

export interface ResolveOptions {
  utcOffsetHoursFallback: number; // Y2
  dailyNotePathGlobs?: string[];  // Y7 — when present, returned alongside dateRange
}

export interface ResolverMatch {
  dateRange: { start: string; end: string };
  pathGlobs?: string[];
  matchedPhrase: string;
  matchRuleId: 'last_n_weeks' | 'last_n_days' | 'this_week' | 'this_month' | 'last_month' | 'yesterday' | 'today' | 'from_onwards' | 'between_and';
}

export function resolveDateRangeFromPrompt(
  userText: string,
  clock: ResolverClock,
  options: ResolveOptions,
): ResolverMatch | null;
```

No changes to `IChatPort`, `IDocumentStore`, or any port signature.

---

## 6. Frontend Flow

### 6a. Component / Data Hierarchy

```
SettingsTab
└── Time and locale (new section)
    └── Timezone UTC offset (hours) — numeric input, default 0, range −12..+14

ChatView
└── streamChat(payload)
    └── payload.timezoneUtcOffsetHours ← settings.timezoneUtcOffsetHours
    └── payload.dailyNotePathGlobs     ← settings.dailyNotePathGlobs (existing)
    └── [sidecar resolves dateRange from last user message]
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `SettingsTab` Time-and-locale section | read/write `settings.timezoneUtcOffsetHours` | debounced save; validation error banner on out-of-range input | Reuses existing settings save pattern. |
| `ChatView.streamChat` caller | reads `timezoneUtcOffsetHours` and `dailyNotePathGlobs` on each dispatch | none | Per-request transport (Y2, Y7). |
| `dateRangeResolver.resolveDateRangeFromPrompt` | `(text, clock, options) → ResolverMatch \| null` | pure | Accepts injectable clock for tests (Y5). |

### 6c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Setting valid, phrase recognized | Chat reply is scoped to the resolved `dateRange`; no visible UI change beyond improved answers. |
| Setting valid, phrase unrecognized | Chat reply is unscoped (Y6); no error. |
| Setting invalid (out of range) | Settings tab shows a non-blocking validation warning; last valid value remains in use until corrected. |
| Sidecar cannot determine local TZ | Falls back to `timezoneUtcOffsetHours` silently (Y2); debug log entry in sidecar. |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/core/domain/dateRangeResolver.ts` | Pure resolver per [ADR-016](../decisions/ADR-016-natural-language-date-range-resolution.md) Decisions 3–6. |
| 2 | `tests/core/domain/dateRangeResolver.test.ts` | Red-first tests for each phrase rule with a fixed anchor (A1–A6, Y3, Y4, Y6). |
| 3 | `tests/core/workflows/ChatWorkflow.dateRange.test.ts` | Composition test: resolved `dateRange` + `pathGlobs` reach `runSearch` (A7, A8, Y7). |
| 4 | `tests/integration/chat-last-two-weeks.integration.test.ts` | Binding — full chat turn with fixed clock, known daily-notes vault, verifies REQ-006 S4. |
| 5 | `tests/plugin/settings/SettingsTab.timezone.test.ts` | Settings UI: default, round-trip, validation clamp (B1–B3). |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/core/domain/types.ts` | Extend `ChatRequestPayload` with `timezoneUtcOffsetHours?: number` and `dailyNotePathGlobs?: string[]`. |
| 2 | `src/core/workflows/ChatWorkflow.ts` | Call `resolveDateRangeFromPrompt` on the last user message using an injected clock; merge returned `dateRange` and `pathGlobs` into the `runSearch` request when non-null. |
| 3 | `src/sidecar/runtime/SidecarRuntime.ts` | Build a concrete `ResolverClock` (uses `new Date()` and `Intl.DateTimeFormat().resolvedOptions().timeZone`); fall back to `timezoneUtcOffsetHours` when TZ is undefined. Forward the two new payload fields into `runChatStream` options. |
| 4 | `src/plugin/settings/types.ts` | Add `timezoneUtcOffsetHours: number` to `SidecarPluginSettings`. |
| 5 | `src/plugin/settings/defaults.ts` | Default `timezoneUtcOffsetHours: 0`. |
| 6 | `src/plugin/settings/SettingsTab.ts` | Add Time-and-locale section with numeric input, range `-12..+14`, validated clamp on save. |
| 7 | `src/plugin/ui/ChatView.ts` | Include `timezoneUtcOffsetHours` and `dailyNotePathGlobs` on every `streamChat` payload. |

### Files UNCHANGED (confirm no modifications needed)

- `src/sidecar/adapters/SqliteDocumentStore.ts` — consumes `NodeFilter.dateRange` / `pathRegex` already (RET-6); unchanged.
- `src/core/workflows/SearchWorkflow.ts` — already accepts `pathGlobs` and `dateRange` on `SearchRequest`.
- `src/sidecar/adapters/chatProviderMessages.ts` — grounding policy + user prompts are already composed correctly; no change.

---

## 8. Acceptance Criteria Checklist

### Phase A: Resolver (pure, anchor-driven)

- [ ] **A1** — `resolveDateRangeFromPrompt("List out my job search activities over the last 2 weeks", clockAt("2026-04-21"))` returns `dateRange: { start: '2026-04-08', end: '2026-04-21' }`, `matchRuleId: 'last_n_weeks'`
  - Evidence: `tests/core/domain/dateRangeResolver.test.ts::A1_last_2_weeks_rolling_14_days(vitest)` — covers S4.

- [ ] **A2** — `"from March 16 onwards"` at anchor `2026-04-21` resolves to `{ start: '2026-03-16', end: '2026-04-21' }`, `matchRuleId: 'from_onwards'`
  - Evidence: `tests/core/domain/dateRangeResolver.test.ts::A2_from_onwards_inclusive(vitest)` — covers S2.

- [ ] **A3** — `"this month"` at anchor `2026-04-21` resolves to `{ start: '2026-04-01', end: '2026-04-21' }`
  - Evidence: `tests/core/domain/dateRangeResolver.test.ts::A3_this_month(vitest)`

- [ ] **A4** — `"last month"` at anchor `2026-04-21` resolves to `{ start: '2026-03-01', end: '2026-03-31' }`
  - Evidence: `tests/core/domain/dateRangeResolver.test.ts::A4_last_month(vitest)`

- [ ] **A5** — `"yesterday"` / `"today"` resolve to single-day ranges
  - Evidence: `tests/core/domain/dateRangeResolver.test.ts::A5_today_and_yesterday(vitest)`

- [ ] **A6** — `"between March 1 and March 15"` resolves to `{ start: '2026-03-01', end: '2026-03-15' }` inclusive
  - Evidence: `tests/core/domain/dateRangeResolver.test.ts::A6_between_and_inclusive(vitest)`

### Phase B: Settings UI and transport

- [ ] **B1** — `timezoneUtcOffsetHours` default is `0`
  - Evidence: `tests/plugin/settings/SettingsTab.timezone.test.ts::B1_default_zero(vitest)`

- [ ] **B2** — Settings round-trip: write `-5`, reload plugin data, read back `-5`
  - Evidence: `tests/plugin/settings/SettingsTab.timezone.test.ts::B2_round_trip(vitest)`

- [ ] **B3** — Out-of-range input (e.g. `99`) is clamped or rejected with a visible validation state; last-valid value persists
  - Evidence: `tests/plugin/settings/SettingsTab.timezone.test.ts::B3_validation_clamp(vitest)`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** Anchor is local time when `Intl.DateTimeFormat().resolvedOptions().timeZone` is defined
  - Evidence: `tests/integration/chat-last-two-weeks.integration.test.ts::Y1_anchor_local_tz_when_defined(vitest)` — runs a chat turn in a process with defined TZ and verifies the resulting `dateRange.end` matches the host's local calendar date.

- [ ] **Y2** — **(binding)** Fallback uses `timezoneUtcOffsetHours` when TZ is undefined
  - Force `Intl.DateTimeFormat().resolvedOptions().timeZone === undefined` via a test harness and verify the resolver shifts "now" by `timezoneUtcOffsetHours` hours before computing the date.
  - Evidence: `tests/integration/chat-last-two-weeks.integration.test.ts::Y2_fallback_uses_utc_offset(vitest)`

- [ ] **Y3** — **(binding)** "Last 2 weeks" = 14-day rolling window inclusive of today
  - Evidence: `tests/core/domain/dateRangeResolver.test.ts::A1_last_2_weeks_rolling_14_days(vitest)` (shared with A1) — covers S4.

- [ ] **Y4** — **(binding)** "From X onwards" and similar open-ended phrases are inclusive on both ends
  - Evidence: `tests/core/domain/dateRangeResolver.test.ts::A2_from_onwards_inclusive(vitest)` (shared with A2) — covers S2.

- [ ] **Y5** — **(binding)** Resolver is pure: identical inputs produce identical outputs
  - Evidence: `tests/core/domain/dateRangeResolver.test.ts::Y5_pure_with_injected_clock(vitest)` — runs the same input against two clocks at the same anchor and asserts equality.

- [ ] **Y6** — **(binding)** Unrecognized phrases return `null` (no error, no `dateRange` attached)
  - Evidence: `tests/core/domain/dateRangeResolver.test.ts::Y6_unrecognized_phrase_returns_null(vitest)` — covers S4 fallback expectation.

- [ ] **Y7** — **(binding)** When `dailyNotePathGlobs` is set, the resolver returns `pathGlobs` alongside `dateRange`, and `ChatWorkflow` passes both into `runSearch`
  - Evidence: `tests/core/workflows/ChatWorkflow.dateRange.test.ts::Y7_compose_pathGlobs_with_dateRange(vitest)` — covers S4 composition.

- [ ] **Y8** — **(binding)** REQ-006 S4 end-to-end: asking "List out my job search activities over the last 2 weeks" against a vault fixture returns a non-refusal reply with `dateRange` and `pathGlobs` applied
  - Evidence: `tests/integration/chat-last-two-weeks.integration.test.ts::Y8_req006_s4_end_to_end(vitest)` — covers S4.

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [ ] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [ ] **Z3** — No `any` types in any new or modified file
- [ ] **Z4** — No relative imports where the project alias applies
- [ ] **Z5** — New or modified code emits `debug`-level logs on resolver hits with `{ matchRuleId, dateRange, pathGlobs }` and an `info`-level count of turns that applied natural-language date filters per [§20 Logging](../../README.md#20-logging-and-observability)
- [ ] **Z6** — `/review-story BUG-3` reports zero `high` or `critical` `TEST-#`, `SEC-#`, `REL-#`, or `API-#` findings on the changed surface

---

## 8a. Test Plan

| # | Level | File::test name | Covers AC | Covers Sn | Notes |
|---|-------|------------------|-----------|-----------|-------|
| 1 | unit | `tests/core/domain/dateRangeResolver.test.ts::A1_last_2_weeks_rolling_14_days` | A1, Y3 | S4 | Fixed anchor. |
| 2 | unit | `tests/core/domain/dateRangeResolver.test.ts::A2_from_onwards_inclusive` | A2, Y4 | S2 | Fixed anchor. |
| 3 | unit | `tests/core/domain/dateRangeResolver.test.ts::A3_this_month` | A3 | — | |
| 4 | unit | `tests/core/domain/dateRangeResolver.test.ts::A4_last_month` | A4 | — | |
| 5 | unit | `tests/core/domain/dateRangeResolver.test.ts::A5_today_and_yesterday` | A5 | — | |
| 6 | unit | `tests/core/domain/dateRangeResolver.test.ts::A6_between_and_inclusive` | A6 | — | |
| 7 | unit | `tests/core/domain/dateRangeResolver.test.ts::Y5_pure_with_injected_clock` | Y5 | — | Purity. |
| 8 | unit | `tests/core/domain/dateRangeResolver.test.ts::Y6_unrecognized_phrase_returns_null` | Y6 | S4 | Fallback. |
| 9 | unit | `tests/core/workflows/ChatWorkflow.dateRange.test.ts::Y7_compose_pathGlobs_with_dateRange` | Y7 | S4 | Composition with daily-note globs. |
| 10 | unit | `tests/plugin/settings/SettingsTab.timezone.test.ts::B1_default_zero` | B1 | — | |
| 11 | unit | `tests/plugin/settings/SettingsTab.timezone.test.ts::B2_round_trip` | B2 | — | |
| 12 | unit | `tests/plugin/settings/SettingsTab.timezone.test.ts::B3_validation_clamp` | B3 | — | |
| 13 | integration | `tests/integration/chat-last-two-weeks.integration.test.ts::Y1_anchor_local_tz_when_defined` | Y1 | S4 | Binding. |
| 14 | integration | `tests/integration/chat-last-two-weeks.integration.test.ts::Y2_fallback_uses_utc_offset` | Y2 | S4 | Binding. |
| 15 | integration | `tests/integration/chat-last-two-weeks.integration.test.ts::Y8_req006_s4_end_to_end` | Y8 | S4 | Binding — full chat turn, known daily-notes vault fixture. |

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Ambiguous year parsing ("from March 16") — is that 2026 or 2024? | ADR-016 Decision 4: most-recent-past occurrence; if resolved start is in the future, clamp to today. Documented in README §22. |
| 2 | Phrase set is MVP-minimal; users will ask unrecognized phrases. | Y6 makes unrecognized phrases a silent no-op; retrieval still runs. Phrase additions are additive with no new ADR needed. |
| 3 | Integer UTC offset excludes half-hour/quarter-hour zones (India, Nepal). | ADR-016 explicit non-decision; documented as a known limitation. Users there typically get the prior day's date near midnight — acceptable for MVP. |
| 4 | `new Date()` drift between sidecar startup and request time. | Resolver takes `clock.now()` at each request; no cached anchor. |
| 5 | Plugin-side `dailyNotePathGlobs` already exists for [ADR-014](../decisions/ADR-014-temporal-and-path-filters.md); double-application risk. | `ChatWorkflow` merges the resolver's `pathGlobs` with any user-supplied filters via set-union (deduped). Guarded by Y7. |

---

## Implementation Order

1. `src/core/domain/dateRangeResolver.ts` — resolver with `ResolverClock` abstraction (covers A1–A6, Y5, Y6).
2. `tests/core/domain/dateRangeResolver.test.ts` — red-first for A1–A6, Y5, Y6.
3. `src/core/domain/types.ts` — extend `ChatRequestPayload` with the two new fields.
4. `src/core/workflows/ChatWorkflow.ts` — call the resolver on last user message, merge into `runSearch` request (covers Y7).
5. `tests/core/workflows/ChatWorkflow.dateRange.test.ts` — red-first for Y7.
6. `src/plugin/settings/{types,defaults,SettingsTab}.ts` — add `timezoneUtcOffsetHours` (covers B1–B3).
7. `tests/plugin/settings/SettingsTab.timezone.test.ts` — red-first for B1–B3.
8. `src/plugin/ui/ChatView.ts` — include both new fields on every payload.
9. `src/sidecar/runtime/SidecarRuntime.ts` — build concrete `ResolverClock`; forward payload fields; fallback logic (covers Y1, Y2).
10. `tests/integration/chat-last-two-weeks.integration.test.ts` — red-first for Y1, Y2, Y8.
11. **Verify** — `npm run test` green; `/review-story BUG-3` clean.
12. **Final verify** — manual smoke: submit "List out my job search activities over the last 2 weeks" in a populated vault; confirm retrieval scope and reply; toggle `timezoneUtcOffsetHours` and re-confirm.

---

*Created: 2026-04-21 | Story: BUG-3 | Epic: 11 — Chat accuracy and UX bug fixes (REQ-006)*
