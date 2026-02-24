# CHAT-7: Implement agent update-note workflow with max-size enforcement

**Story**: Implement `AgentService.updateNote` to safely update existing vault notes within allowed folders while enforcing max generated note size.
**Epic**: Epic 5 — Chat Completions and Agent File Operations
**Size**: Medium
**Status**: Done

---

## 1. Summary

CHAT-7 completes the MVP agent write surface by replacing update-note placeholders with validated vault modify operations. The service must ensure paths are valid, restricted to allowed output folders, and mapped to existing notes before applying content updates.

This story builds on CHAT-6's create-note enforcement and reuses the same safety model (folder allowlist + size limit). Together they provide a complete, constrained create/update workflow suitable for chat-driven note editing.

The guiding constraint is explicit safety guarantees: no updates outside configured folders, no oversized writes, no implicit file creation during update.

---

## 2. API Endpoints + Schemas

No external HTTP/API endpoint changes are required.

Internal contract remains:

```ts
updateNote(path: string, content: string): Promise<void>
```

No `shared/types.ts` updates are required.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Chat/agent caller
└── AgentService.updateNote(path, content)
    ├── normalize + validate path
    ├── enforce allowed output folders
    ├── enforce maxGeneratedNoteSize
    ├── resolve existing file via vault lookup
    └── app.vault.modify(file, content)
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `AgentService.updateNote` | `(path: string, content: string) => Promise<void>` | Stateless + disposed guard | Performs validated modify workflow |
| `Vault.getAbstractFileByPath` | `(path: string) => TAbstractFile \| null` | Existence guard | Prevents update path from creating implicit new files |
| `Vault.modify` | `(file, content) => Promise<void>` | Existing note mutation | Applies update only for resolved file target |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Caller awaits modify operation |
| Error   | Invalid path/disallowed folder/oversized/missing-file conditions emit blocked notice |
| Empty   | Empty/invalid path is rejected with blocked notice |
| Success | Existing note is updated and success notice is emitted |

No direct UI rendering changes are required in CHAT-7.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/agentService.update.test.ts` | Unit coverage for update-path validation, existing-file checks, and vault modify behavior |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/services/AgentService.ts` | Implement validated update-note workflow with allowed-folder and max-size enforcement |
| 2 | `src/__tests__/unit/services.runtime.test.ts` | Align runtime service expectations with update workflow behavior |

### Files UNCHANGED (confirm no modifications needed)

- `src/bootstrap/bootstrapRuntimeServices.ts` — app dependency wiring for `AgentService` already exists from CHAT-6.
- `src/ui/ChatView.ts` — UI trigger wiring for update actions is outside CHAT-7 scope.
- `src/services/ChatService.ts` — chat retrieval/stream behavior remains unchanged.

---

## 5. Acceptance Criteria Checklist

### Phase A: Update Validation + Enforcement

- [x] **A1** — `updateNote` blocks invalid/disallowed paths
  - Rejects malformed/traversal paths and paths outside allowed output folders.
  - Evidence: `src/__tests__/unit/agentService.update.test.ts::A1_blocks_invalid_or_disallowed_paths(vitest)`

- [x] **A2** — `updateNote` enforces max generated note size
  - Content exceeding `maxGeneratedNoteSize` is blocked with notice.
  - Evidence: `src/__tests__/unit/agentService.update.test.ts::A2_blocks_oversized_content(vitest)`

### Phase B: Vault Modify Workflow

- [x] **B1** — Existing notes in allowed folders are updated through vault API
  - Resolves file via `getAbstractFileByPath` and calls `vault.modify(file, content)`.
  - Evidence: `src/__tests__/unit/agentService.update.test.ts::B1_updates_existing_note(vitest)`

- [x] **B2** — Missing target notes are blocked (no implicit create)
  - When lookup returns null, no modify call occurs and notice explains block.
  - Evidence: `src/__tests__/unit/agentService.update.test.ts::B2_blocks_missing_target(vitest)`

- [x] **B3** — Disposed guard remains enforced
  - `updateNote` after dispose throws clear service-disposed error.
  - Evidence: `src/__tests__/unit/agentService.update.test.ts::B3_disposed_guard(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/services/AgentService.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - This repository currently has no `@shared/types` workspace package; CHAT-7 introduces no client import paths that conflict with this alias rule.
  - Evidence: `src/services/AgentService.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Update path rules drifting from create path rules | Reuse shared normalization/allowlist helpers in `AgentService` |
| 2 | Modify call invoked on non-note abstract files | Require successful lookup and rely on vault adapter shape checks in tests |
| 3 | Confusing blocked messages for users | Emit explicit notices for each block category (size, path, folder, missing file) |

---

## Implementation Order

1. `src/services/AgentService.ts` — implement update workflow using shared validation and vault modify behavior (covers A1, A2, B1, B2, B3).
2. `src/__tests__/unit/agentService.update.test.ts` and `src/__tests__/unit/services.runtime.test.ts` — add/adjust coverage for update enforcement and runtime compatibility (covers A1, A2, B1, B2, B3).
3. **Verify** — run `npm run test -- agentService.update services.runtime`.
4. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-24 | Story: CHAT-7 | Epic: Epic 5 — Chat Completions and Agent File Operations*
