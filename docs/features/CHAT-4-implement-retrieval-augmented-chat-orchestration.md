# CHAT-4: Implement retrieval-augmented chat orchestration

**Story**: Update `ChatService` to retrieve context from indexed vault content before provider completion, ensuring chat context is always derived from semantic search results.
**Epic**: Epic 5 — Chat Completions and Agent File Operations
**Size**: Large
**Status**: Done

---

## 1. Summary

CHAT-4 introduces the retrieval orchestration layer for chat. Instead of accepting arbitrary caller-provided context, `ChatService` must derive context chunks from `SearchService` using the active user prompt and pass those results to the selected provider. This enforces the core MVP guarantee that chat answers are grounded only in indexed vault data.

This story bridges provider integrations (CHAT-2, CHAT-3) and upcoming chat UI work (CHAT-5). Without orchestration here, each caller would duplicate retrieval logic and could accidentally pass non-vault context into provider requests.

The key constraint is deterministic context derivation: search query selection, top-k defaults, and result mapping must be stable and testable so downstream streaming/UI behavior is predictable.

---

## 2. API Endpoints + Schemas

No external HTTP API changes are required.

Internal contracts in `src/types.ts` remain unchanged:

```ts
export interface ChatRequest {
  providerId: ProviderId;
  model: string;
  messages: ChatMessage[];
  context: ChatContextChunk[];
  timeoutMs: number;
}
```

`ChatService` behavior changes: it now ignores inbound `request.context` and replaces it with context retrieved from `SearchService`.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Caller (future CHAT-5 pane)
└── ChatService.chat(request)
    ├── derive latest user message
    ├── SearchService.search({ query, topK })
    ├── map SearchResult[] -> ChatContextChunk[]
    ├── ProviderRegistry.getChatProvider(request.providerId)
    └── provider.complete({ ...request, context: retrievedContext })
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `ChatService.chat` | `(request: ChatRequest) => AsyncIterable<ChatStreamEvent>` | Stateless per invocation + disposed guard | Performs retrieval before provider completion |
| `SearchService.search` | `(request: SearchRequest) => Promise<SearchResult[]>` | Read-only query over indexed vectors | Source of truth for vault-only context |
| `ChatContextChunk` mapping | `SearchResult -> ChatContextChunk` | Deterministic field mapping | Preserves chunk ID, path, heading, snippet, and score |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Retrieval runs before provider stream starts |
| Error   | Search/provider failures surface as normalized runtime errors |
| Empty   | No user prompt or no matches -> provider called with `context: []` |
| Success | Provider receives retrieved context and streams completion events |

No direct UI rendering changes are required in CHAT-4.

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/chatService.rag.test.ts` | Focused coverage for retrieval query selection, context mapping, and vault-only context enforcement |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/services/ChatService.ts` | Implement retrieval orchestration, context mapping, and normalized error handling |
| 2 | `src/__tests__/unit/services.runtime.test.ts` | Align runtime-level chat expectations with retrieval-first behavior |

### Files UNCHANGED (confirm no modifications needed)

- `src/providers/chat/*` — provider transport behavior remains owned by CHAT-2/CHAT-3.
- `src/ui/ChatView.ts` — chat pane UX is implemented in CHAT-5.
- `src/main.ts` — no command-level chat orchestration changes required in this story.

---

## 5. Acceptance Criteria Checklist

### Phase A: Retrieval Query + Context Mapping

- [x] **A1** — `ChatService` derives retrieval query from the most recent user message
  - Uses latest `role === "user"` message content trimmed as search query.
  - Empty user query skips retrieval and uses empty context.
  - Evidence: `src/__tests__/unit/chatService.rag.test.ts::A1_uses_latest_user_message_for_retrieval(vitest)`

- [x] **A2** — `ChatService` maps search results into provider context deterministically
  - Maps `SearchResult[]` to `ChatContextChunk[]` preserving `chunkId`, `notePath`, `heading`, `snippet`, and `score`.
  - For retrieval path, provider receives mapped context instead of caller-provided `request.context`.
  - Evidence: `src/__tests__/unit/chatService.rag.test.ts::A2_maps_search_results_to_provider_context(vitest)`

- [x] **A3** — Retrieval uses stable defaults
  - Search call uses `topK=5` (or documented service constant) for context retrieval.
  - Evidence: `src/__tests__/unit/chatService.rag.test.ts::A3_retrieval_uses_default_topk(vitest)`

### Phase B: Runtime Robustness

- [x] **B1** — Retrieval/provider failures are normalized with actionable context
  - Search or provider errors are normalized before rethrow.
  - Error context includes operation details for runtime logging/notice handling.
  - Evidence: `src/__tests__/unit/chatService.rag.test.ts::B1_normalizes_retrieval_or_provider_errors(vitest)`

- [x] **B2** — Disposed guard remains enforced
  - `chat()` after `dispose()` rejects with clear disposed error.
  - Evidence: `src/__tests__/unit/chatService.rag.test.ts::B2_disposed_guard(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::Z1_build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::Z2_lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/services/ChatService.ts::Z3_no_any_types(eslint)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - This repository currently has no `@shared/types` workspace package; CHAT-4 introduces no client import paths that conflict with this alias rule.
  - Evidence: `src/services/ChatService.ts::Z4_import_path_consistency(eslint)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Using only latest user message can miss conversation history intent | Keep retrieval logic deterministic now; revisit multi-turn retrieval policy in future story if needed |
| 2 | Search latency adds overhead before first stream token | Use bounded top-k and lightweight mapping to keep retrieval step fast |
| 3 | Caller-provided context is ignored, which may surprise consumers | Document behavior in story/tests and ensure CHAT-5 uses service-managed retrieval |

---

## Implementation Order

1. `src/services/ChatService.ts` — add retrieval query derivation, search call, context mapping, and normalized errors (covers A1, A2, A3, B1, B2).
2. `src/__tests__/unit/chatService.rag.test.ts` — add dedicated RAG orchestration coverage for vault-only context enforcement (covers A1, A2, A3, B1, B2).
3. `src/__tests__/unit/services.runtime.test.ts` — align runtime smoke expectations with retrieval-first behavior (covers A1, A2).
4. **Verify** — run `npm run test -- chatService.rag services.runtime`.
5. **Final verify** — run `npm run lint && npm run build`.

---

*Created: 2026-02-24 | Story: CHAT-4 | Epic: Epic 5 — Chat Completions and Agent File Operations*
