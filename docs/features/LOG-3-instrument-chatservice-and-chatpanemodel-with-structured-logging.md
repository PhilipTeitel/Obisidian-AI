# LOG-3: Instrument ChatService and ChatPaneModel with structured logging

**Story**: Add structured operation-scoped logging for chat orchestration and pane streaming lifecycle, including retrieval/context timings and stream outcomes.
**Epic**: Epic 9 — Logging and Observability Instrumentation
**Size**: Medium
**Status**: Done

---

## 1. Summary

LOG-3 instruments both runtime chat orchestration (`ChatService`) and UI chat state machine (`ChatPaneModel`) to make turn-level behavior observable end-to-end.

This story complements LOG-2 search instrumentation by adding similar lifecycle telemetry to chat operations: retrieval start/completion, provider call execution, stream token/error/done events, cancellation handling, and normalized failures.

The design constraint is privacy-safe diagnostics: logs capture message counts, draft length, context sizes, timing, and status transitions without logging user draft or source snippet bodies.

---

## 2. API Endpoints + Schemas

No API endpoint changes are required.

No shared schema changes are required. Existing runtime logger contracts from LOG-1 are reused.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
ChatPaneModel.send()
└── ChatService.chat()
    ├── SearchService.search() for retrieval context
    ├── ProviderRegistry.getChatProvider()
    └── provider.complete() stream
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ChatService.chat` | `(request: ChatRequest) => AsyncIterable<ChatStreamEvent>` | Runtime lifecycle | Logs retrieval/query/provider stream lifecycle |
| `ChatPaneModel.send` | `(draftInput?: string) => Promise<boolean>` | Turn state machine | Logs turn start, source search, stream tokens/errors, final status |
| `ChatPaneModel.cancelStreaming` | `() => boolean` | Active stream control | Logs cancellation requests and outcomes |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | `status: streaming`, emits start + in-flight stream telemetry. |
| Error | `status: error`, emits normalized error log with context. |
| Empty | Not applicable for chat turn stream; empty draft is skipped. |
| Success | Completed/cancelled turn emits terminal status + elapsed timing metadata. |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/features/LOG-3-instrument-chatservice-and-chatpanemodel-with-structured-logging.md` | Story spec and acceptance criteria |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/services/ChatService.ts` | Add structured logs for retrieval/provider chat lifecycle and failures |
| 2 | `src/ui/ChatPaneModel.ts` | Add structured logs for turn lifecycle, source retrieval, stream events, cancellation, and failures |
| 3 | `src/__tests__/unit/chatService.rag.test.ts` | Keep retrieval/provider behavior assertions green with instrumentation |
| 4 | `src/__tests__/unit/chatPaneModel.test.ts` | Keep streaming/cancel/error state assertions green with instrumentation |
| 5 | `README.md` | Link LOG-3 story and mark status done after completion |

### Files UNCHANGED (confirm no modifications needed)

- `src/ui/ChatView.ts` — UI rendering contract remains unchanged.
- `src/providers/chat/*` — provider-level HTTP instrumentation is handled by LOG-4.

---

## 5. Acceptance Criteria Checklist

### Phase A: ChatService Lifecycle Logging

- [x] **A1** — ChatService logs turn start and retrieval phase timing
  - Includes provider ID, message count, retrieval query length, and retrieval elapsed time.
  - Evidence: `src/services/ChatService.ts::A1_chat_start_and_retrieval_timing(code-review)`

- [x] **A2** — ChatService logs provider stream lifecycle and completion
  - Emits provider start/completion with elapsed timing and stream event metadata.
  - Evidence: `src/services/ChatService.ts::A2_provider_lifecycle_logging(code-review)`

- [x] **A3** — ChatService logs normalized failures for retrieval/provider errors
  - Failure logs include normalized domain/context and preserve existing throw behavior.
  - Evidence: `src/__tests__/unit/chatService.rag.test.ts::B1_normalizes_retrieval_or_provider_errors(vitest)`

### Phase B: ChatPaneModel Lifecycle Logging

- [x] **B1** — ChatPaneModel logs send lifecycle across skip/success/error outcomes
  - Includes draft length, turn ID, stream completion status, and elapsed timing.
  - Evidence: `src/__tests__/unit/chatPaneModel.test.ts::B2_stream_failures_set_error_state(vitest)`

- [x] **B2** — ChatPaneModel logs cancellation and source search failures
  - Emits cancellation request outcome and source search error events with normalized context.
  - Evidence: `src/__tests__/unit/chatPaneModel.test.ts::B1_cancels_active_stream(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/services/ChatService.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Story scope does not add shared-client imports.
  - Evidence: `src/ui/ChatPaneModel.ts::Z4_import_path_consistency(eslint)`
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines
  - Chat lifecycle operations include structured start/phase/terminal/error events.
  - Evidence: `src/services/ChatService.ts::Z5_chat_lifecycle_logging(code-review)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Streaming token-level logs can become noisy | Keep token event logs at debug-level and aggregate completion stats at info-level |
| 2 | Logging message content could expose sensitive text | Log lengths/counts only; avoid raw message bodies |
| 3 | Async iterator errors can obscure phase attribution | Log explicit phase events before/after provider stream loop |

---

## Implementation Order

1. `src/services/ChatService.ts` — instrument retrieval and provider stream lifecycle with operation-scoped logs (covers A1, A2, A3).
2. `src/ui/ChatPaneModel.ts` — instrument turn send/source-search/cancel/stream completion + error paths (covers B1, B2).
3. `src/__tests__/unit/chatService.rag.test.ts` and `src/__tests__/unit/chatPaneModel.test.ts` — run and confirm behavior stability with instrumentation.
4. **Verify** — run targeted chat tests.
5. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-26 | Story: LOG-3 | Epic: Epic 9 — Logging and Observability Instrumentation*
