# CHAT-5: Build Chat pane UI with streaming responses and source context display

**Story**: Implement a functional chat pane with conversation history, streaming assistant responses, source context display, and user-controlled cancellation.
**Epic**: Epic 5 — Chat Completions and Agent File Operations
**Size**: Medium
**Status**: Done

---

## 1. Summary

CHAT-5 turns the existing chat view shell into an interactive UI connected to runtime chat/search services. Users must be able to enter prompts, see incremental assistant output as tokens stream in, view source context used for grounding, and cancel in-progress generations without restarting the plugin.

This story depends on CHAT-4 retrieval orchestration and provider integrations from CHAT-2/CHAT-3. It also establishes the base interaction surface for upcoming agent file-operation stories (CHAT-6, CHAT-7), which will extend the same conversation workflow.

The key design principle is model-view separation: a pane model manages async chat state transitions and cancellation, while `ChatView` remains a rendering and event-wiring layer.

---

## 2. API Endpoints + Schemas

No external HTTP/API endpoint changes are required.

Internal runtime contracts used by this story:

```ts
chatService.chat(request: ChatRequest): AsyncIterable<ChatStreamEvent>
searchService.search(request: SearchRequest): Promise<SearchResult[]>
```

No `shared/types.ts` changes are required.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
ChatView (ItemView)
└── ChatPaneModel
    ├── send(draft)
    │   ├── searchService.search(query) -> source context preview
    │   └── chatService.chat(request) -> token/done/error stream
    ├── cancelStreaming()
    └── subscribe(state => render)
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ChatPaneModel.send` | `(draft?: string) => Promise<boolean>` | `idle` -> `streaming` -> terminal | Appends conversation turn and streams assistant text |
| `ChatPaneModel.cancelStreaming` | `() => boolean` | Streaming cancellation flag + iterator return | Stops in-progress stream consumption and marks turn cancelled |
| `ChatView` | `(leaf, model)` | Stateless render layer | Renders input/buttons/status/history/sources from model snapshot |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Disable send, enable cancel, show streaming status |
| Error   | Show normalized error message in status and latest turn |
| Empty   | Initial pane shows prompt to start conversation |
| Success | Render updated conversation history, assistant response text, and source list |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/ui/ChatPaneModel.ts` | Stateful chat pane orchestrator for send/stream/cancel/source mapping |
| 2 | `src/__tests__/unit/chatPaneModel.test.ts` | Unit coverage for conversation lifecycle, streaming, source display, and cancellation |
| 3 | `src/__tests__/unit/chatView.test.ts` | View-level rendering coverage for controls, conversation rows, and sources |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/ui/ChatView.ts` | Replace shell content with bound UI controls + conversation/source rendering |
| 2 | `src/main.ts` | Construct `ChatPaneModel`, inject into `ChatView`, and clean up on unload |
| 3 | `src/__tests__/integration/plugin.runtime.test.ts` | Ensure chat view registration/wiring remains valid after constructor contract changes |

### Files UNCHANGED (confirm no modifications needed)

- `src/services/ChatService.ts` — retrieval/provider orchestration behavior is already in CHAT-4.
- `src/providers/chat/*` — provider transport logic remains unchanged in CHAT-5.
- `src/settings.ts` — no new settings fields required for basic chat pane behavior.

---

## 5. Acceptance Criteria Checklist

### Phase A: Chat Pane State Model

- [x] **A1** — Pane model tracks conversation turns and draft input deterministically
  - New user sends append a turn with user text and assistant placeholder.
  - State snapshot includes draft, status, turn history, and control flags.
  - Evidence: `src/__tests__/unit/chatPaneModel.test.ts::A1_state_and_history_contract(vitest)`

- [x] **A2** — Pane model streams assistant responses and finalizes turns
  - `token` events append assistant text incrementally.
  - `done` marks turn complete and returns pane to idle.
  - Evidence: `src/__tests__/unit/chatPaneModel.test.ts::A2_streaming_updates_assistant_turn(vitest)`

- [x] **A3** — Pane model displays source context for each turn
  - Before chat stream, model runs semantic search and maps results into displayed sources.
  - Source metadata includes note path, optional heading, and snippet.
  - Evidence: `src/__tests__/unit/chatPaneModel.test.ts::A3_maps_and_persists_sources(vitest)`

### Phase B: Cancellation + Error Handling

- [x] **B1** — Cancellation control stops active stream consumption
  - `cancelStreaming()` is available only while streaming and transitions turn to cancelled.
  - Partial assistant text remains visible.
  - Evidence: `src/__tests__/unit/chatPaneModel.test.ts::B1_cancels_active_stream(vitest)`

- [x] **B2** — Streaming errors are surfaced without losing conversation state
  - Turn is marked error and user receives normalized notification.
  - Prior successful turns remain intact.
  - Evidence: `src/__tests__/unit/chatPaneModel.test.ts::B2_stream_failures_set_error_state(vitest)`

### Phase C: Chat View Rendering

- [x] **C1** — Chat view renders input/send/cancel controls and status line
  - Required elements exist with stable class names for future styling.
  - Evidence: `src/__tests__/unit/chatView.test.ts::C1_renders_chat_controls(vitest)`

- [x] **C2** — Chat view renders conversation history and source context rows
  - User/assistant messages and source entries appear after model updates.
  - Evidence: `src/__tests__/unit/chatView.test.ts::C2_renders_history_and_sources(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/ui/ChatPaneModel.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - This repository currently has no `@shared/types` workspace package; CHAT-5 introduces no client import paths that conflict with this alias rule.
  - Evidence: `src/ui/ChatPaneModel.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Streaming/cancel race conditions can corrupt pane state | Keep single active stream guard and centralize transition logic in model |
| 2 | Duplicating source lookup in pane model can drift from service retrieval | Use same query/top-k defaults and deterministic mapping helpers |
| 3 | UI complexity in ItemView can become hard to maintain | Keep rendering logic thin and move async orchestration to `ChatPaneModel` |

---

## Implementation Order

1. `src/ui/ChatPaneModel.ts` — implement send/stream/cancel/source state management (covers A1, A2, A3, B1, B2).
2. `src/ui/ChatView.ts` — implement model-bound controls, status text, and history/source rendering (covers C1, C2).
3. `src/main.ts` — wire `ChatPaneModel` into runtime and `ChatView` construction (covers C1).
4. `src/__tests__/unit/chatPaneModel.test.ts` and `src/__tests__/unit/chatView.test.ts` — add focused unit coverage (covers A1, A2, A3, B1, B2, C1, C2).
5. `src/__tests__/integration/plugin.runtime.test.ts` — confirm plugin runtime wiring remains valid (covers C1).
6. **Verify** — run `npm run test -- chatPaneModel chatView plugin.runtime`.
7. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-24 | Story: CHAT-5 | Epic: Epic 5 — Chat Completions and Agent File Operations*
