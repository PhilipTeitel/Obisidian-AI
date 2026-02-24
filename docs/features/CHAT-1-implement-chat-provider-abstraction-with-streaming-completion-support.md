# CHAT-1: Implement chat provider abstraction with streaming completion support

**Story**: Establish a runtime chat-provider abstraction that supports token streaming and can be consumed by `ChatService` independent of provider-specific HTTP details.
**Epic**: Epic 5 — Chat Completions and Agent File Operations
**Size**: Medium
**Status**: Done

---

## 1. Summary

CHAT-1 introduces the core provider abstraction needed to support chat completions from multiple backends while keeping the service layer stable. The key outcome is that `ChatService` no longer contains placeholder behavior and instead delegates completion streaming to whichever chat provider is active in settings.

This story is a dependency for CHAT-2 and CHAT-3, which add concrete OpenAI and Ollama provider implementations. Without a dedicated registry + service contract for chat providers, each integration story would duplicate selection logic and create inconsistent stream behavior.

The design constraint is strict separation of concerns: provider registration and lookup live in `ProviderRegistry`, provider transport logic stays in provider-specific files, and `ChatService` only orchestrates request validation, provider selection, and event forwarding.

---

## 2. API Endpoints + Schemas

No HTTP endpoint changes are introduced in CHAT-1.

This repository is an Obsidian plugin and does not use `shared/types.ts`; contract updates are applied in `src/types.ts`.

```ts
export interface ChatProvider {
  readonly id: ProviderId;
  readonly name: string;
  complete(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
}

export interface ProviderRegistryContract extends RuntimeServiceLifecycle {
  getChatProviderId(): ProviderId;
  registerChatProvider(provider: ChatProvider): void;
  getChatProvider(providerId?: ProviderId): ChatProvider;
  listChatProviders(): ChatProvider[];
}
```

No additional schemas are required in this story.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Chat caller (future CHAT-5 pane)
└── ChatService.chat(request)
    ├── ProviderRegistry.getChatProvider(request.providerId?)
    └── ChatProvider.complete(request) -> AsyncIterable<ChatStreamEvent>
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ProviderRegistry.registerChatProvider` | `(provider: ChatProvider) => void` | In-memory map by provider ID | Mirrors embedding-provider registration pattern |
| `ProviderRegistry.getChatProvider` | `(providerId?: ProviderId) => ChatProvider` | Throws on missing provider | Defaults to active chat provider in settings |
| `ChatService.chat` | `(request: ChatRequest) => AsyncIterable<ChatStreamEvent>` | Disposed guard + streaming pass-through | Delegates completion streaming to selected provider |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Caller consumes incremental `token` events as streamed output |
| Error   | Missing provider or provider failure surfaces as runtime error to caller |
| Empty   | Provider may emit `done` without token events for empty/short prompts |
| Success | Event stream is forwarded in provider order (`token`...`done`) |

Frontend UI changes are not part of CHAT-1.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/providerRegistry.chat.test.ts` | Unit coverage for chat-provider registration and lookup behavior |
| 2 | `src/__tests__/unit/chatService.streaming.test.ts` | Unit coverage for chat stream delegation, ordering, and disposed guard |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Extend `ProviderRegistryContract` with chat-provider registration and lookup methods |
| 2 | `src/providers/ProviderRegistry.ts` | Add chat-provider storage/list/lookup behavior |
| 3 | `src/services/ChatService.ts` | Replace placeholder implementation with provider-backed streaming delegation |
| 4 | `src/__tests__/unit/services.runtime.test.ts` | Align runtime-level service test expectations with provider-backed chat behavior |

### Files UNCHANGED (confirm no modifications needed)

- `src/main.ts` — chat UI invocation wiring is handled in CHAT-5.
- `src/ui/ChatView.ts` — view shell behavior remains unchanged until chat UX story.
- `src/providers/embeddings/*` — embedding-provider logic is unaffected by chat abstraction.

---

## 5. Acceptance Criteria Checklist

### Phase A: Registry Chat Provider Abstraction

- [x] **A1** — `ProviderRegistry` registers and resolves chat providers by explicit ID and active settings ID
  - `registerChatProvider()` stores providers keyed by `provider.id`.
  - `getChatProvider()` resolves explicit IDs and defaults to `getChatProviderId()`.
  - Evidence: `src/__tests__/unit/providerRegistry.chat.test.ts::A1_register_and_resolve_chat_providers(vitest)`

- [x] **A2** — `ProviderRegistry` lists chat providers deterministically and throws for missing IDs
  - `listChatProviders()` returns providers sorted by provider ID.
  - Missing chat providers throw an actionable error containing provider ID.
  - Evidence: `src/__tests__/unit/providerRegistry.chat.test.ts::A2_list_and_missing_provider_behavior(vitest)`

### Phase B: Chat Service Streaming Delegation

- [x] **B1** — `ChatService.chat()` streams provider events in-order without placeholder events
  - `ChatService` no longer emits hard-coded "not implemented" events.
  - Provider-emitted events are forwarded unchanged in stream order.
  - Evidence: `src/__tests__/unit/chatService.streaming.test.ts::B1_forwards_provider_stream_events(vitest)`

- [x] **B2** — `ChatService` chooses the configured provider when request provider differs
  - If `request.providerId` does not match the active configured provider, service still uses explicit request provider when registered.
  - Missing provider produces an actionable runtime failure.
  - Evidence: `src/__tests__/unit/chatService.streaming.test.ts::B2_provider_selection_and_missing_provider(vitest)`

- [x] **B3** — Disposed service guard rejects stream creation after dispose
  - Calling `chat()` after `dispose()` throws a clear "disposed" error.
  - Evidence: `src/__tests__/unit/chatService.streaming.test.ts::B3_disposed_guard(vitest)`

### Phase C: Runtime Test Compatibility

- [x] **C1** — Runtime test suite remains aligned with new provider-backed chat behavior
  - Existing runtime tests no longer assert placeholder error text.
  - Provider registry stubs include new chat-provider methods where required.
  - Evidence: `src/__tests__/unit/services.runtime.test.ts::C1_runtime_chat_expectations_updated(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/__tests__/unit/chatService.streaming.test.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - This repository currently has no `@shared/types` workspace package; CHAT-1 does not introduce client-side relative imports that would conflict with this rule.
  - Evidence: `src/types.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Registry API expansion may break existing test doubles | Update unit/integration stubs in the same commit and enforce compile-safe tests |
| 2 | Stream forwarding could hide provider metadata differences | Keep `ChatStreamEvent` provider-agnostic and add provider-specific parsing in later stories |
| 3 | Missing provider registration can cause runtime failures | Throw explicit provider-ID errors and cover with tests so failures are actionable |

---

## Implementation Order

1. `src/types.ts` — extend `ProviderRegistryContract` with chat-provider APIs (covers A1, A2).
2. `src/providers/ProviderRegistry.ts` — implement chat-provider map, registration, lookup, and deterministic listing (covers A1, A2).
3. `src/services/ChatService.ts` — replace placeholder stream with provider delegation + disposed guard (covers B1, B2, B3).
4. `src/__tests__/unit/providerRegistry.chat.test.ts` and `src/__tests__/unit/chatService.streaming.test.ts` — add focused coverage for registry and streaming behavior (covers A1, A2, B1, B2, B3).
5. `src/__tests__/unit/services.runtime.test.ts` — align runtime test doubles/assertions with new registry contract (covers C1).
6. **Verify** — run `npm run test -- chatService.streaming providerRegistry.chat services.runtime`.
7. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-24 | Story: CHAT-1 | Epic: Epic 5 — Chat Completions and Agent File Operations*
