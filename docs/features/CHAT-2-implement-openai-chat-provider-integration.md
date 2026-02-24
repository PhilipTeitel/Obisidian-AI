# CHAT-2: Implement OpenAI chat provider integration

**Story**: Add a production-ready OpenAI chat provider that streams completion tokens using configured endpoint, model, API key, and timeout settings.
**Epic**: Epic 5 — Chat Completions and Agent File Operations
**Size**: Medium
**Status**: Done

---

## 1. Summary

CHAT-2 delivers the first concrete `ChatProvider` implementation for the abstraction introduced in CHAT-1. The provider must call OpenAI-compatible chat completions, parse streaming events into the internal `ChatStreamEvent` contract, and preserve provider-specific configuration through plugin settings and secret storage.

This story is required before chat UX stories can display real model output. CHAT-3 follows with an Ollama implementation using the same `ChatProvider` contract, and CHAT-4 depends on both providers being selectable through `ProviderRegistry` when orchestration adds retrieval context.

The key constraint is deterministic stream translation: OpenAI SSE payloads should map cleanly to `token` and `done` events without leaking provider-specific response shapes into service or UI layers.

---

## 2. API Endpoints + Schemas

No external HTTP API endpoints are added by this repository; CHAT-2 integrates with OpenAI's existing endpoint:

| Attribute | Value |
|-----------|-------|
| Method    | POST |
| Path      | `/chat/completions` (on configured OpenAI base endpoint) |
| Auth      | Required (Bearer API key from Obsidian secret storage) |
| Query     | none |
| Response  | OpenAI streaming SSE frames mapped to `ChatStreamEvent` |

No `shared/types.ts` changes are required; this repo uses `src/types.ts` for internal contracts.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
ChatService.chat(request)
└── ProviderRegistry.getChatProvider("openai")
    └── OpenAIChatProvider.complete(request)
        ├── POST /chat/completions (stream=true)
        ├── parse SSE delta tokens
        └── yield ChatStreamEvent token/done
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `OpenAIChatProvider` | `{ getEndpoint, getApiKey, defaultTimeoutMs? }` | Stateless per request | Pulls endpoint from settings and key from secret store |
| `OpenAIChatProvider.complete` | `(request: ChatRequest) => AsyncIterable<ChatStreamEvent>` | Stream lifecycle + timeout | Converts OpenAI SSE frames to internal events |
| `bootstrapRuntimeServices` | Registers provider via `ProviderRegistry.registerChatProvider` | Runtime startup registration | Makes OpenAI chat provider available to `ChatService` |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Stream begins after POST succeeds and SSE frames arrive |
| Error   | Missing API key, non-200 response, malformed stream, or timeout throws actionable provider error |
| Empty   | Provider may emit only `done` if model returns no text deltas |
| Success | Incremental `token` events followed by single `done` event |

No direct UI component changes are required in CHAT-2.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/providers/chat/OpenAIChatProvider.ts` | OpenAI chat provider implementation with streaming SSE parsing |
| 2 | `src/providers/chat/httpChatUtils.ts` | Shared chat HTTP helpers (endpoint normalization, timeout fetch helpers) |
| 3 | `src/__tests__/unit/openaiChatProvider.test.ts` | Unit coverage for request shaping, SSE parsing, auth/timeout/error behavior |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/bootstrap/bootstrapRuntimeServices.ts` | Register `OpenAIChatProvider` in `ProviderRegistry` |
| 2 | `src/__tests__/smoke.test.ts` | Align compile/runtime smoke expectations with chat provider registration behavior |

### Files UNCHANGED (confirm no modifications needed)

- `src/services/ChatService.ts` — provider delegation behavior is already delivered by CHAT-1.
- `src/ui/ChatView.ts` — chat pane UX is handled in CHAT-5.
- `src/providers/embeddings/*` — embedding provider integrations remain unchanged.

---

## 5. Acceptance Criteria Checklist

### Phase A: OpenAI Provider Request + Streaming

- [x] **A1** — OpenAI chat provider sends authenticated streaming request to configured endpoint
  - Uses `openaiEndpoint` base URL and `Authorization: Bearer <key>`.
  - Uses `request.model`, `request.messages`, `request.context`, and `request.timeoutMs`.
  - Evidence: `src/__tests__/unit/openaiChatProvider.test.ts::A1_posts_streaming_chat_request(vitest)`

- [x] **A2** — Provider maps OpenAI SSE deltas to ordered `ChatStreamEvent` output
  - `delta.content` chunks become `token` events.
  - Provider emits one terminal `done` event with mapped finish reason.
  - Evidence: `src/__tests__/unit/openaiChatProvider.test.ts::A2_parses_sse_tokens_and_done(vitest)`

- [x] **A3** — Provider fails fast with actionable errors for auth/HTTP/timeout failures
  - Missing API key throws before network call.
  - Non-OK responses and timeout aborts produce clear error messages.
  - Evidence: `src/__tests__/unit/openaiChatProvider.test.ts::A3_handles_auth_http_timeout_failures(vitest)`

### Phase B: Runtime Registration

- [x] **B1** — Bootstrap registers OpenAI chat provider in `ProviderRegistry`
  - `ProviderRegistry.getChatProvider("openai")` resolves after runtime bootstrap.
  - Evidence: `src/__tests__/smoke.test.ts::B1_bootstrap_registers_openai_chat_provider(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/providers/chat/OpenAIChatProvider.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - This repository currently has no `@shared/types` workspace package; CHAT-2 introduces no client import paths that conflict with this alias rule.
  - Evidence: `src/providers/chat/OpenAIChatProvider.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | OpenAI streaming payload variants can cause parser drift | Support canonical SSE `data:` frames and validate payload shape defensively with tests |
| 2 | Timeout handling can leak hanging requests if abort is not wired | Use `AbortController` and ensure timer cleanup in `finally` |
| 3 | Context formatting decisions affect downstream answer quality | Keep provider-side formatting deterministic and leave retrieval strategy to CHAT-4 |

---

## Implementation Order

1. `src/providers/chat/httpChatUtils.ts` — add reusable chat endpoint/timeout helpers (covers A1, A3).
2. `src/providers/chat/OpenAIChatProvider.ts` — implement OpenAI streaming request + SSE event mapping (covers A1, A2, A3).
3. `src/bootstrap/bootstrapRuntimeServices.ts` — register OpenAI chat provider with runtime registry (covers B1).
4. `src/__tests__/unit/openaiChatProvider.test.ts` and `src/__tests__/smoke.test.ts` — add/update coverage for provider behavior and bootstrap registration (covers A1, A2, A3, B1).
5. **Verify** — run `npm run test -- openaiChatProvider smoke`.
6. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-24 | Story: CHAT-2 | Epic: Epic 5 — Chat Completions and Agent File Operations*
