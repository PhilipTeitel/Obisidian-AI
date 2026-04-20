# RET-6: Temporal and path filters for retrieval

**Story**: Extend `SearchRequest` and chat retrieval options with optional `pathGlobs` and `dateRange` filters; compile globs to SQL `LIKE`/regex predicates in `SqliteDocumentStore`; parse daily-note filenames into a new `note_meta.note_date` column and apply date-range filters against it; surface the filters in the chat UI via lightweight slash-commands or a scope selector.
**Epic**: 5 — Retrieval, search workflow, and chat workflow
**Size**: Medium
**Status**: Planned

---

## 1. Summary

Users who keep daily notes cannot currently ask "what job-search activities did I do in the last two weeks?" with any reliability: semantic search over entire vaults is too broad, and the phased retrieval has no way to pre-filter by path or date. [ADR-014](../decisions/ADR-014-temporal-and-path-filters.md) defines the filter contract; this story implements it end-to-end.

Filter application:

- `pathGlobs`: applied at Phase 1 and Phase 2 in the SQL predicate (prevents FTS5/vector from returning out-of-scope rows).
- `dateRange`: applied via a new `note_meta.note_date DATE NULL` column populated during indexing from daily-note filename matches; filter becomes `AND note_meta.note_date BETWEEN ? AND ?`.

**Prerequisites:** [RET-4](RET-4.md) (shared retrieval helper), [ADR-014](../decisions/ADR-014-temporal-and-path-filters.md) **Accepted**, [STO-4](STO-4.md) (migration adds `note_date` column alongside FTS5).

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                                                             | Why it binds this story                                                           |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [docs/decisions/ADR-014-temporal-and-path-filters.md](../decisions/ADR-014-temporal-and-path-filters.md)         | Defines filter surface, daily-note parsing, and application rules.                |
| [docs/decisions/ADR-003-phased-retrieval-strategy.md](../decisions/ADR-003-phased-retrieval-strategy.md)         | Filter is an additional predicate in Phase 1 and Phase 2.                         |
| [docs/decisions/ADR-002-hierarchical-document-model.md](../decisions/ADR-002-hierarchical-document-model.md)     | `note_meta` is the canonical home for per-note scalar metadata.                   |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted**
- [ ] README, requirements, and ADRs do not contradict each other
- [ ] Section 4 (Binding constraints) is filled
- [ ] Phase Y has at least one criterion with non-mock evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — `SearchRequest` gains `pathGlobs?: string[]` and `dateRange?: { start?: string; end?: string }` (ISO `YYYY-MM-DD`). `ChatWorkflowOptions` mirrors the same.
2. **Y2** — Path-glob matching uses a small compile step (`src/core/domain/pathGlob.ts`) that turns globs like `Daily/**/*.md` into a regex + SQL `LIKE` fragment pair. `**` → any, `*` → non-slash, `?` → single non-slash.
3. **Y3** — Every Phase 1 and Phase 2 SQL query built for a filtered call includes the glob predicate on `notes.path` and the date predicate on `note_meta.note_date`. Tests must assert SQL (via spy) or verify through integration that out-of-scope rows are absent.
4. **Y4** — Daily-note date parsing runs during indexing: for each note whose path matches `settings.dailyNotePathGlobs` (default `['Daily/**/*.md']`), extract a date using `settings.dailyNoteDatePattern` (default `YYYY-MM-DD`) from the basename; store in `note_meta.note_date`. Non-matching notes get `NULL`.
5. **Y5** — When `dateRange` is present and a note's `note_date` is NULL, that note is excluded from the filter's candidate set (NULL is not within any range).
6. **Y6** — Filters are **additive**: both `pathGlobs` and `dateRange` may appear in the same request; results must satisfy both.

---

## 5. API Endpoints + Schemas

Type additions (in [`src/core/domain/types.ts`](../../src/core/domain/types.ts)):

```ts
export interface SearchRequest {
  query: string;
  k?: number;
  apiKey?: string;
  tags?: string[];
  coarseK?: number;
  pathGlobs?: string[];
  dateRange?: { start?: string; end?: string };
}
```

Sidecar protocol: extend `search` and `chat` payloads (documented in README §Protocol) with the same two optional fields.

Schema (authored by [STO-4](STO-4.md)):

```sql
ALTER TABLE note_meta ADD COLUMN note_date TEXT; -- ISO YYYY-MM-DD, NULL when not parsed
CREATE INDEX IF NOT EXISTS idx_note_meta_note_date ON note_meta(note_date);
```

New settings: `dailyNotePathGlobs: string[]`, `dailyNoteDatePattern: string`.

---

## 6. Frontend Flow

Slash-command parsing in [`ChatView`](../../src/plugin/ui/ChatView.ts) extracts simple `path:` and `date:` prefixes from the input box and routes them to structured filters before sending.

### 6a. Component / Data Hierarchy

```
ChatView
└── input box
    └── parseChatInput(raw) → { text, pathGlobs, dateRange }
```

### 6b. Props & Contracts

| Component / Hook    | Props / Signature                                                   | State | Notes                                                                                  |
| ------------------- | ------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------- |
| `parseChatInput`    | `(raw: string) => { text: string; pathGlobs?: string[]; dateRange?: { start?: string; end?: string } }` | pure  | Accepts `path:Daily/**/*.md`, `since:2026-04-01`, `before:2026-04-10`, `last:14d`.     |
| `SettingsTab`       | `dailyNotePathGlobs`, `dailyNoteDatePattern`                        | save  | Advanced section; sensible defaults.                                                   |

### 6c. States

| State                         | UI Behavior                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Glob parse failure            | Show inline warning in chat, send query unfiltered.                              |
| Date parse failure            | Same as glob parse failure.                                                      |
| Filter reduces results to zero | Insufficient-evidence response from [CHAT-3](CHAT-3.md) fires unchanged.        |

---

## 7. File Touchpoints

### Files to CREATE

| #   | Path                                                         | Purpose                                                                  |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 1   | `src/core/domain/pathGlob.ts`                                | Glob → regex + SQL LIKE fragment; pure.                                  |
| 2   | `src/core/domain/dailyNoteDate.ts`                           | Parse daily-note basename into ISO date; pure; unit-tested.              |
| 3   | `src/core/domain/chatInputParser.ts`                         | `parseChatInput` — slash-command-style filter extraction.                |
| 4   | `tests/core/domain/pathGlob.test.ts`                         | Glob translation cases.                                                  |
| 5   | `tests/core/domain/dailyNoteDate.test.ts`                    | Date parsing cases (YYYY-MM-DD, custom patterns, non-matching).          |
| 6   | `tests/core/domain/chatInputParser.test.ts`                  | Input parsing edge cases.                                                |
| 7   | `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts` | Integration: filtered queries exclude out-of-scope rows.                 |

### Files to MODIFY

| #   | Path                                               | Change                                                                                       |
| --- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | `src/core/domain/types.ts`                         | Extend `SearchRequest`, `ChatWorkflowOptions`.                                               |
| 2   | `src/core/workflows/SearchWorkflow.ts`             | Thread filters into store calls; pass to fallback path too.                                  |
| 3   | `src/core/workflows/ChatWorkflow.ts`               | Accept filters; forward through retrieval helper.                                            |
| 4   | `src/sidecar/adapters/SqliteDocumentStore.ts`      | Extend `NodeFilter` with `pathRegex?` / `dateRange?`; append predicates in SQL.              |
| 5   | `src/sidecar/adapters/IndexWorkflow` path         | During indexing, populate `note_meta.note_date` using `dailyNoteDate` parser.                 |
| 6   | `src/plugin/ui/ChatView.ts`                        | Call `parseChatInput`; include filters in `chat` payload.                                    |
| 7   | `src/plugin/settings/SettingsTab.ts`               | Add `dailyNotePathGlobs` + `dailyNoteDatePattern` (advanced section).                        |
| 8   | `src/sidecar/runtime/SidecarRuntime.ts`, transport layer | Thread filters from payload to workflow options.                                        |

### Files UNCHANGED

- `src/sidecar/db/migrations/002_fts.sql` — STO-4 extends this migration to add `note_date` column & index.

---

## 8. Acceptance Criteria Checklist

### Phase A: Pure helpers

- [ ] **A1** — `compilePathGlob('Daily/**/*.md')` produces regex matching `Daily/2026-04-16.md` and rejecting `Other/notes.md`.
  - Evidence: `tests/core/domain/pathGlob.test.ts::A1`
- [ ] **A2** — `parseDailyNoteDate('Daily/2026-04-16.md', 'YYYY-MM-DD')` → `'2026-04-16'`; a non-matching basename → `null`.
  - Evidence: `tests/core/domain/dailyNoteDate.test.ts::A2`
- [ ] **A3** — `parseChatInput('what did I do? path:Daily/**/*.md last:14d')` extracts glob + computed `dateRange.start` (today − 14 days).
  - Evidence: `tests/core/domain/chatInputParser.test.ts::A3`

### Phase B: Store filtering

- [ ] **B1** — Vector search with `pathRegex` present returns only rows whose `notes.path` matches.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::B1`
- [ ] **B2** — Vector search with `dateRange` returns only rows whose `note_meta.note_date` lies within the range; NULL dates excluded.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::B2`

### Phase C: Workflow integration

- [ ] **C1** — `SearchWorkflow` passes combined filters to both Phase 1 and Phase 2 (including fallback content ANN).
  - Evidence: `tests/core/workflows/SearchWorkflow.filters.test.ts::C1_propagation`
- [ ] **C2** — `ChatView` sends `pathGlobs` and `dateRange` inside `chat` payload when user input contains slash commands.
  - Evidence: `tests/plugin/ui/ChatView.filters.test.ts::C2`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — Pure domain helpers live in `src/core/domain/` with no forbidden imports.
  - Evidence: `npm run check:boundaries`
- [ ] **Y2** — **(non-mock)** SQLite integration shows `note_date` populated after indexing a fixture Daily folder.
  - Evidence: `tests/sidecar/adapters/SqliteDocumentStore.filters.test.ts::Y2`

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes
- [ ] **Z2** — `npm run lint` passes
- [ ] **Z3** — No `any` types
- [ ] **Z4** — N/A
- [ ] **Z5** — Log filters at `debug` for each chat/search request (compact form).

---

## 9. Risks & Tradeoffs

| #   | Risk / Tradeoff                                        | Mitigation                                                                                                   |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 1   | Users write globs the parser can't handle              | `compilePathGlob` throws a descriptive error; `ChatView` shows inline warning; workflow unfiltered fallback. |
| 2   | Daily-note date pattern varies widely (e.g. `MM-DD-YYYY`) | Setting is user-configurable; parser is pattern-driven, not hardcoded.                                       |
| 3   | `note_date` stays NULL until reindex                   | Documented in release notes / CHAT behavior guide; reindex prompt triggered automatically after migration.  |

---

## Implementation Order

1. Pure helpers + tests.
2. Store-level `NodeFilter` extensions + SQL.
3. Indexer hook to populate `note_date`.
4. Workflow + transport plumbing.
5. UI slash-command parser.
6. Settings.
7. Full verify.

---

_Created: 2026-04-16 | Story: RET-6 | Epic: 5 — Retrieval, search workflow, and chat workflow_
