# CMD-4: Update `Getting Started` command reference aligned with registered command names

**Story**: Ensure the `Getting Started` command reference documents exact command palette display names, IDs, behavior, and usage context for all user-facing plugin commands.
**Epic**: Epic 8 — Command Palette Pane Access and Command UX
**Size**: Small
**Status**: Done

---

## 1. Summary

CMD-4 brings command documentation into strict alignment with the command names and IDs currently registered by the plugin. Users rely on the `Getting Started` section as the first runbook for command palette usage, so names and behavior descriptions must be exact.

This story follows CMD-1, CMD-2, and CMD-3 so documentation reflects the newly introduced pane-open commands alongside existing indexing/search commands. Accurate command docs reduce discovery friction and prevent mismatch between UI labels and README guidance.

The guiding constraint is source-of-truth consistency: the README table must match `COMMAND_NAMES` and `COMMAND_IDS` values and describe expected behavior without implying side effects that do not occur.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes are required.

No shared TypeScript schema changes are required because this story updates documentation only.

```ts
type CommandReferenceDoc = {
  displayName: string;
  commandId: string;
  purpose: string;
  typicalUsage: string;
};
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
README Getting Started
└── Command reference table
    ├── Display Name (command palette label)
    ├── Command ID (registered constant)
    ├── Purpose / Expected Behavior
    └── Typical Usage
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `README.md` command table | Markdown table rows | Static docs | Must include all user-facing command palette actions |
| `COMMAND_NAMES` mapping | const object | Runtime constants | Documentation values must match exactly |
| `COMMAND_IDS` mapping | const object | Runtime constants | Documentation IDs must match exactly |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Not applicable; this story is documentation-only. |
| Error | Mismatched docs can cause user confusion and failed command discovery. |
| Empty | Missing row means a user-facing command is undocumented. |
| Success | Table includes all commands with exact names, IDs, and accurate behavior notes. |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/features/CMD-4-update-getting-started-command-reference-aligned-with-registered-command-names.md` | Story spec and acceptance criteria |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `README.md` | Align `Getting Started` command reference wording with registered command names/IDs |

### Files UNCHANGED (confirm no modifications needed)

- `src/constants.ts` — command names/IDs already implemented; this story documents them.
- `src/main.ts` — command registration behavior already covered in CMD-2/CMD-3.

---

## 5. Acceptance Criteria Checklist

### Phase A: Command Reference Completeness

- [x] **A1** — `Getting Started` command table lists all user-facing plugin commands
  - Rows include `Reindex vault`, `Index changes`, `Semantic search selection`, `Open semantic search pane`, and `Open chat pane`.
  - No user-facing command from `registerCommands` is omitted.
  - Evidence: `README.md::A1_getting_started_command_rows(markdown-review)`

- [x] **A2** — Each row documents display name, command ID, expected behavior, and typical usage
  - Command IDs are shown and behavior descriptions are explicit about side effects.
  - Pane-open commands explicitly note that they open/reveal panes without executing search/chat.
  - Evidence: `README.md::A2_command_reference_columns(markdown-review)`

### Phase B: Source-of-Truth Alignment

- [x] **B1** — Display names and IDs in `Getting Started` align with registered constants
  - `README.md` entries match `COMMAND_NAMES` and `COMMAND_IDS` values exactly.
  - No stale aliases or mismatched capitalization remain.
  - Evidence: `src/constants.ts::B1_command_constants_alignment(manual-compare)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `README.md::Z3_no_any_types(n/a_docs_only)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Docs-only story; no import statements are introduced.
  - Evidence: `README.md::Z4_import_path_consistency(n/a_docs_only)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Command docs may drift from constants over time | Add explicit statement that table reflects registered names/IDs |
| 2 | Behavior descriptions could overpromise side effects | Keep wording precise for open/reveal vs execute semantics |
| 3 | Duplicate command tables can become inconsistent | Prioritize `Getting Started` as onboarding source and keep language synchronized |

---

## Implementation Order

1. `README.md` — audit `Getting Started` command table rows against `src/constants.ts` and refine wording for exact registration alignment (covers A1, A2, B1).
2. **Verify** — run quick markdown review for table completeness and accuracy.
3. **Final verify** — run `npm run lint && npm run build` to ensure no repository regression.

---

*Created: 2026-02-25 | Story: CMD-4 | Epic: Epic 8 — Command Palette Pane Access and Command UX*
