# CHAT-3: Implement Ollama chat provider integration

**Story**: Add an Ollama chat provider that supports configurable endpoint/model/timeout and streams chat completions through the shared `ChatProvider` contract.
**Epic**: Epic 5 — Chat Completions and Agent File Operations
**Size**: Medium
**Status**: Done

---

## 1. Summary

CHAT-3 completes MVP parity for chat providers by adding an Ollama implementation alongside OpenAI. The provider must translate Ollama chat streaming payloads into internal `ChatStreamEvent` tokens and terminal completion events so `ChatService` and future UI flows remain provider-agnostic.

This story depends on CHAT-1 contract wiring and follows CHAT-2's OpenAI integration pattern. CHAT-4 relies on both providers being selectable for retrieval-augmented orchestration, and CHAT-5 depends on stable stream event semantics regardless of backend.

The key design constraint is protocol normalization: Ollama returns newline-delimited JSON streaming chunks, which must be converted into the same runtime event contract used by OpenAI.

---

## 2. API Endpoints + Schemas

No repository HTTP endpoints are added; CHAT-3 integrates with Ollama's local API:

| Attribute | Value |
|-----------|-------|
| Method    | POST |
| Path      | `/api/chat` (on configured Ollama endpoint) |
| Auth      | none |
| Query     | none |
| Response  | NDJSON streaming payload mapped to `ChatStreamEvent` |

No `shared/types.ts` updates are required; internal contracts remain in `src/types.ts`.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
ChatService.chat(request)
└── ProviderRegistry.getChatProvider("ollama")
    └── OllamaChatProvider.complete(request)
        ├── POST /api/chat (stream=true)
        ├── parse NDJSON message chunks
        └── yield ChatStreamEvent token/done
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `OllamaChatProvider` | `{ getEndpoint, defaultTimeoutMs? }` | Stateless per request | Endpoint from settings; no secret store key required |
| `OllamaChatProvider.complete` | `(request: ChatRequest) => AsyncIterable<ChatStreamEvent>` | Stream lifecycle + timeout | Maps Ollama chunk stream to internal events |
| `bootstrapRuntimeServices` | Registers provider via `ProviderRegistry.registerChatProvider` | Runtime startup registration | Makes Ollama provider available for service selection |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Stream starts once `/api/chat` request is accepted |
| Error   | Non-200, malformed chunks, or timeout failures throw actionable provider errors |
| Empty   | Provider may emit only `done` when no text chunks are produced |
| Success | Incremental `token` events followed by one `done` event |

No direct UI modifications are required in CHAT-3.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/providers/chat/OllamaChatProvider.ts` | Ollama chat provider implementation with NDJSON stream parsing |
| 2 | `src/__tests__/unit/ollamaChatProvider.test.ts` | Unit coverage for request shape, stream parsing, and failure handling |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/providers/chat/httpChatUtils.ts` | Add NDJSON stream utility support reused by Ollama provider |
| 2 | `src/bootstrap/bootstrapRuntimeServices.ts` | Register `OllamaChatProvider` in `ProviderRegistry` |
| 3 | `src/__tests__/smoke.test.ts` | Assert both OpenAI and Ollama chat providers are registered in bootstrap |

### Files UNCHANGED (confirm no modifications needed)

- `src/services/ChatService.ts` — provider delegation behavior remains unchanged from CHAT-1.
- `src/ui/ChatView.ts` — chat pane UX is deferred to CHAT-5.
- `src/providers/embeddings/*` — embedding providers are out of scope for CHAT-3.

---

## 5. Acceptance Criteria Checklist

### Phase A: Ollama Provider Request + Stream Parsing

- [x] **A1** — Ollama chat provider posts chat requests to configured endpoint with model/messages/context
  - Calls `${ollamaEndpoint}/api/chat` using `stream: true`.
  - Uses `request.model`, normalized message payload, and context-derived system preamble.
  - Evidence: `src/__tests__/unit/ollamaChatProvider.test.ts::A1_posts_ollama_chat_request(vitest)`

- [x] **A2** — Provider maps Ollama NDJSON stream chunks to ordered `ChatStreamEvent` output
  - `message.content` chunks become `token` events.
  - `done: true` emits exactly one terminal `done` event with mapped finish reason.
  - Evidence: `src/__tests__/unit/ollamaChatProvider.test.ts::A2_parses_ndjson_tokens_and_done(vitest)`

- [x] **A3** — Provider surfaces actionable failures for HTTP/timeout/malformed chunk errors
  - Non-OK status throws explicit status error.
  - Timeout abort and malformed payloads throw clear provider errors.
  - Evidence: `src/__tests__/unit/ollamaChatProvider.test.ts::A3_handles_http_timeout_and_malformed_payloads(vitest)`

### Phase B: Runtime Registration

- [x] **B1** — Bootstrap registers Ollama chat provider alongside OpenAI provider
  - `ProviderRegistry.listChatProviders()` includes both `openai` and `ollama`.
  - Evidence: `src/__tests__/smoke.test.ts::B1_bootstrap_registers_both_chat_providers(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/providers/chat/OllamaChatProvider.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - This repository currently has no `@shared/types` workspace package; CHAT-3 introduces no client import paths that conflict with this alias rule.
  - Evidence: `src/providers/chat/OllamaChatProvider.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Ollama payload variants may differ across versions | Parse defensively and validate required fields in unit tests |
| 2 | Long-running local model calls can stall stream handling | Enforce timeout/abort behavior using shared chat HTTP utilities |
| 3 | Provider parity drift across OpenAI/Ollama can leak into UI | Keep event mapping contract identical (`token` + `done`) and verify via tests |

---

## Implementation Order

1. `src/providers/chat/httpChatUtils.ts` — add NDJSON stream parser helper (covers A2, A3).
2. `src/providers/chat/OllamaChatProvider.ts` — implement Ollama request + stream mapping logic (covers A1, A2, A3).
3. `src/bootstrap/bootstrapRuntimeServices.ts` — register Ollama chat provider (covers B1).
4. `src/__tests__/unit/ollamaChatProvider.test.ts` and `src/__tests__/smoke.test.ts` — add/update coverage for provider behavior and bootstrap registration (covers A1, A2, A3, B1).
5. **Verify** — run `npm run test -- ollamaChatProvider smoke`.
6. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-24 | Story: CHAT-3 | Epic: Epic 5 — Chat Completions and Agent File Operations*
