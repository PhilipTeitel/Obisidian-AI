# UX-5: Add source pill buttons to chat responses with note navigation

**Story**: Render sources as clickable pill buttons below assistant bubbles and wire an `openSource` callback through ChatPaneModel to open notes using existing search navigation.
**Epic**: Epic 10 — Search and Chat Pane UX Polish
**Size**: Medium
**Status**: Done

---

## 1. Summary

UX-5 makes chat source references interactive. Currently, sources render as plain `<span>` elements showing the note path and heading. This story adds a click handler to each source pill that navigates to the referenced note, using the same `buildSearchResultLink` utility and `workspace.openLinkText` mechanism used by the search pane.

This requires adding an `openSource` dependency to `ChatPaneModelDeps` and wiring it in `main.ts` to reuse the existing `openSearchResult` navigation logic. The `ChatView.renderState()` method binds click handlers on each source pill element.

The CSS for `.obsidian-ai-chat-turn__source-item` (pill styling, cursor pointer, hover underline) is already defined in UX-1's `styles.css`.

---

## 2. API Endpoints + Schemas

No API endpoint or schema changes are required.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
ChatView.renderState()
└── For each ChatTurn with sources:
    └── div.obsidian-ai-chat-turn__sources
        └── span.obsidian-ai-chat-turn__source-item × N  (clickable pill)
            └── click → model.openSource(source)
                       → deps.openSource(source)
                       → openSearchResult({ notePath, heading })
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ChatPaneModelDeps` | `openSource: (source: ChatContextChunk) => Promise<void>` | N/A | New dependency for note navigation |
| `ChatPaneModel.openSource` | `(source: ChatContextChunk) => Promise<void>` | N/A | New public method delegating to deps |
| `ChatView.renderState` | N/A | N/A | Binds click handler on source pills |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| No sources | Sources section not rendered (unchanged) |
| Sources present | Each source renders as a clickable pill; clicking opens the note |

---

## 4. File Touchpoints

### Files to CREATE

None.

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/ui/ChatPaneModel.ts` | Add `openSource` to `ChatPaneModelDeps`; add `openSource()` public method with logging |
| 2 | `src/ui/ChatView.ts` | Bind click handler on source pill elements to call `model.openSource(source)` |
| 3 | `src/main.ts` | Wire `openSource` in ChatPaneModel deps to reuse `openSearchResult` navigation |
| 4 | `src/__tests__/unit/chatView.test.ts` | Add test for clickable source pills |
| 5 | `src/__tests__/unit/chatPaneModel.test.ts` | Add test for `openSource` method |

### Files UNCHANGED (confirm no modifications needed)

- `styles.css` — Source pill CSS already defined in UX-1.
- `src/types.ts` — `ChatContextChunk` already has `notePath` and `heading`.
- `src/ui/searchNavigation.ts` — Reused as-is.

---

## 5. Acceptance Criteria Checklist

### Phase A: Model

- [x] **A1** — `ChatPaneModel` exposes an `openSource(source)` method
  - The method delegates to `deps.openSource(source)`.
  - Errors are caught, normalized, and notified.
  - Evidence: `src/__tests__/unit/chatPaneModel.test.ts::A1_openSource_delegates_to_deps(vitest)`

### Phase B: View

- [x] **B1** — Source pills are clickable and trigger `model.openSource`
  - Each `.obsidian-ai-chat-turn__source-item` element has a click handler.
  - Evidence: `src/__tests__/unit/chatView.test.ts::B1_source_pills_are_clickable(vitest)`

### Phase C: Wiring

- [x] **C1** — `main.ts` wires `openSource` to reuse search result navigation
  - The `openSource` callback in ChatPaneModel deps calls `openSearchResult` with `{ notePath, heading }`.
  - Evidence: `src/main.ts::C1_openSource_wired(code review)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/ui/ChatPaneModel.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Not applicable — no new shared imports.
  - Evidence: `src/ui/ChatPaneModel.ts::Z4_import_path_consistency(n/a)`
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines
  - `openSource` logs start/completed/failed events.
  - Evidence: `src/ui/ChatPaneModel.ts::Z5_logging(code review)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Adding `openSource` to `ChatPaneModelDeps` is a breaking change for existing test factories | All test factories are updated in this story |
| 2 | Source navigation reuses the same `openLinkText` path as search results | This is intentional — consistent navigation behavior across search and chat |

---

## Implementation Order

1. `src/ui/ChatPaneModel.ts` — Add `openSource` to deps interface; add public `openSource()` method with logging.
   - (covers A1)
2. `src/main.ts` — Wire `openSource` in ChatPaneModel constructor to call `openSearchResult`.
   - (covers C1)
3. `src/ui/ChatView.ts` — Bind click handler on source pills to call `model.openSource(source)`.
   - (covers B1)
4. `src/__tests__/unit/chatPaneModel.test.ts` — Add `A1_openSource_delegates_to_deps` test.
5. `src/__tests__/unit/chatView.test.ts` — Add `B1_source_pills_are_clickable` test.
6. **Verify** — Run `npx vitest run src/__tests__/unit/chatView.test.ts src/__tests__/unit/chatPaneModel.test.ts`
7. **Final verify** — Run `npm run build && npm run lint && npm run test`

---

*Created: 2026-03-20 | Story: UX-5 | Epic: Epic 10 — Search and Chat Pane UX Polish*
