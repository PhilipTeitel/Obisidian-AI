# CHAT-6: Implement agent create-note workflow with allowed-folder enforcement

**Story**: Implement `AgentService.createNote` so chat-driven note creation writes to vault files only within configured allowed output folders.
**Epic**: Epic 5 — Chat Completions and Agent File Operations
**Size**: Medium
**Status**: Done

---

## 1. Summary

CHAT-6 converts agent note creation from placeholder notices into real vault write behavior. The service must validate requested output paths against `agentOutputFolders`, enforce note-size limits, and create files through Obsidian's vault APIs.

This story is a prerequisite for safe agent-assisted writing workflows and pairs with CHAT-7 (update-note workflow). Together they form the controlled write surface for file operations initiated via chat.

The guiding constraint is safety-first writes: agent output must never create files outside explicit allowlists, and all blocked operations should produce actionable notices instead of silent failures.

---

## 2. API Endpoints + Schemas

No external HTTP/API endpoint changes are required.

Internal contract remains:

```ts
export interface AgentServiceContract {
  createNote(path: string, content: string): Promise<void>;
  updateNote(path: string, content: string): Promise<void>;
}
```

No `shared/types.ts` changes are needed.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Chat/agent caller
└── AgentService.createNote(path, content)
    ├── normalize + validate path
    ├── enforce allowed output folders
    ├── enforce maxGeneratedNoteSize
    ├── guard against existing target path
    └── app.vault.create(path, content)
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `AgentService.createNote` | `(path: string, content: string) => Promise<void>` | Stateless + disposed guard | Executes validated vault create operation |
| `AgentServiceDeps.getSettings` | `() => ObsidianAISettings` | Runtime settings snapshot | Source of allowed folders + size limits |
| `AgentServiceDeps.notify` | `(message: string) => void` | User feedback channel | Reports blocked/success outcomes |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Caller awaits create operation |
| Error   | Invalid path/folder/size/existing-file conditions emit blocked notice |
| Empty   | Empty path is rejected with blocked notice |
| Success | Note is created in allowed folder and success notice is emitted |

No direct UI rendering changes are required in CHAT-6.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/agentService.create.test.ts` | Unit coverage for folder enforcement, path validation, and vault create calls |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/services/AgentService.ts` | Implement validated `createNote` workflow with allowed-folder and vault-write enforcement |
| 2 | `src/bootstrap/bootstrapRuntimeServices.ts` | Provide `app` dependency to `AgentService` for vault access |
| 3 | `src/__tests__/unit/services.runtime.test.ts` | Align runtime expectations with real create-note behavior |

### Files UNCHANGED (confirm no modifications needed)

- `src/ui/ChatView.ts` — UI triggers for create operations are outside CHAT-6 scope.
- `src/services/ChatService.ts` — chat retrieval/stream behavior remains unchanged.
- `src/settings.ts` — `agentOutputFolders` and `maxGeneratedNoteSize` settings already exist.

---

## 5. Acceptance Criteria Checklist

### Phase A: Path + Folder Enforcement

- [x] **A1** — `createNote` rejects writes outside allowed output folders
  - Path validation normalizes folder comparisons and blocks traversal/absolute paths.
  - Empty allowlist blocks all create attempts.
  - Evidence: `src/__tests__/unit/agentService.create.test.ts::A1_blocks_disallowed_paths(vitest)`

- [x] **A2** — `createNote` enforces max generated note size
  - Content exceeding `maxGeneratedNoteSize` is blocked with notice.
  - Evidence: `src/__tests__/unit/agentService.create.test.ts::A2_blocks_oversized_content(vitest)`

### Phase B: Vault Create Workflow

- [x] **B1** — Allowed create requests write through vault API
  - Calls `app.vault.create(path, content)` exactly once for valid allowed paths.
  - Evidence: `src/__tests__/unit/agentService.create.test.ts::B1_creates_note_in_allowed_folder(vitest)`

- [x] **B2** — Existing target paths are not overwritten by create workflow
  - If target exists, operation is blocked with notice and no create call.
  - Evidence: `src/__tests__/unit/agentService.create.test.ts::B2_blocks_when_target_exists(vitest)`

- [x] **B3** — Disposed guard remains enforced
  - `createNote` after dispose throws clear service-disposed error.
  - Evidence: `src/__tests__/unit/agentService.create.test.ts::B3_disposed_guard(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/services/AgentService.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - This repository currently has no `@shared/types` workspace package; CHAT-6 introduces no client import paths that conflict with this alias rule.
  - Evidence: `src/services/AgentService.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Path normalization bugs can allow folder escape | Reject traversal segments and absolute paths; cover with explicit tests |
| 2 | Behavior differences across vault adapters may affect existence checks | Use minimal adapter contract (`getAbstractFileByPath` + `create`) and defensive guards |
| 3 | Blocking too aggressively may frustrate users | Emit clear notices describing why creation was blocked and what folder constraints apply |

---

## Implementation Order

1. `src/services/AgentService.ts` — implement safe create-note validation + vault create logic (covers A1, A2, B1, B2, B3).
2. `src/bootstrap/bootstrapRuntimeServices.ts` — inject app dependency into AgentService (covers B1).
3. `src/__tests__/unit/agentService.create.test.ts` and `src/__tests__/unit/services.runtime.test.ts` — add/adjust coverage for create workflow and runtime compatibility (covers A1, A2, B1, B2, B3).
4. **Verify** — run `npm run test -- agentService.create services.runtime`.
5. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-24 | Story: CHAT-6 | Epic: Epic 5 — Chat Completions and Agent File Operations*
