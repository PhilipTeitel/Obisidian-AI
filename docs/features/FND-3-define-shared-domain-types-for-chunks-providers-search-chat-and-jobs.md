# FND-3: Define shared domain types for chunks, providers, search, chat, and jobs

**Story**: Establish a stable, extensible TypeScript domain model for chunking, providers, search, chat, and background jobs so later stories can implement behavior without reworking type contracts.
**Epic**: Epic 1 — Plugin Foundation and Runtime Shell
**Size**: Small
**Status**: Done

---

## 1. Summary

This story introduces the first shared domain type layer for the plugin runtime. Today the codebase only has shell-level types (view IDs, command IDs, settings, and simple progress status). FND-3 expands that foundation with explicit interfaces for chunks, provider contracts, semantic search, chat messages/events, and long-running job tracking.

The story is a dependency for nearly every downstream implementation epic. Indexing (Epic 2), storage/providers (Epic 3), search (Epic 4), and chat/agent orchestration (Epic 5) all need the same data contracts to avoid duplicated or conflicting shape definitions. By defining these contracts now, implementation stories can focus on behavior instead of renegotiating type structures.

The key design constraint is forward compatibility for provider integrations. Type definitions must support additional providers and model capabilities later without requiring broad refactors to service signatures. The approach should favor stable core interfaces and provider-agnostic request/response envelopes.

---

## 2. API Endpoints + Schemas

No external API endpoint changes are needed for this story.

This project is an Obsidian plugin with internal service contracts, not a REST service. There is no `shared/types.ts` module in this single-package repository; domain contracts should be introduced in `src/types.ts` and consumed by runtime modules.

The following NEW or CHANGED interfaces should be added to `src/types.ts`:

```ts
export type ProviderId = string;
export type ProviderKind = "embedding" | "chat";

export interface ChunkReference {
  notePath: string;
  noteTitle: string;
  headingTrail: string[];
  blockRef?: string;
  tags: string[];
}

export interface ChunkRecord {
  id: string;
  source: ChunkReference;
  content: string;
  hash: string;
  tokenEstimate?: number;
  updatedAt: number;
}

export interface EmbeddingVector {
  values: number[];
  dimensions: number;
}

export interface IndexedChunk extends ChunkRecord {
  embedding?: EmbeddingVector;
}

export interface EmbeddingRequest {
  providerId: ProviderId;
  model: string;
  inputs: string[];
}

export interface EmbeddingResponse {
  providerId: ProviderId;
  model: string;
  vectors: EmbeddingVector[];
}

export interface EmbeddingProvider {
  readonly id: ProviderId;
  readonly name: string;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatContextChunk {
  chunkId: string;
  notePath: string;
  heading?: string;
  snippet: string;
  score?: number;
}

export interface ChatRequest {
  providerId: ProviderId;
  model: string;
  messages: ChatMessage[];
  context: ChatContextChunk[];
  timeoutMs: number;
}

export type ChatStreamEvent =
  | { type: "token"; text: string }
  | { type: "done"; finishReason: "stop" | "length" | "error" }
  | { type: "error"; message: string; retryable: boolean };

export interface ChatProvider {
  readonly id: ProviderId;
  readonly name: string;
  complete(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
}

export interface SearchRequest {
  query: string;
  topK: number;
  minScore?: number;
}

export interface SearchResult {
  chunkId: string;
  score: number;
  notePath: string;
  noteTitle: string;
  heading?: string;
  snippet: string;
}

export type JobType = "reindex-vault" | "index-changes" | "embed-batch" | "chat-completion";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobProgress {
  completed: number;
  total: number;
  label: string;
  detail?: string;
}

export interface JobSnapshot {
  id: string;
  type: JobType;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  progress: JobProgress;
  errorMessage?: string;
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
ObsidianAIPlugin (runtime shell)
├── src/types.ts (domain contracts)
│   ├── Chunk + Embedding types
│   ├── Provider contracts (embedding/chat)
│   ├── Search request/result types
│   ├── Chat request/message/stream-event types
│   └── Job progress/status snapshot types
├── settings.ts (uses ProviderId and timeout settings)
├── ui/ProgressSlideout.ts (uses JobSnapshot/JobProgress-derived state)
└── future service modules
    ├── IndexingService (ChunkRecord, JobSnapshot)
    ├── SearchService (SearchRequest, SearchResult)
    ├── ChatService (ChatRequest, ChatStreamEvent)
    └── ProviderRegistry (EmbeddingProvider, ChatProvider)
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `src/types.ts` domain exports | Type-only module | N/A | Single source of truth for cross-layer contracts |
| `EmbeddingProvider` | `embed(request: EmbeddingRequest) => Promise<EmbeddingResponse>` | Provider-owned runtime internals | Avoid provider-specific fields in service call sites |
| `ChatProvider` | `complete(request: ChatRequest) => AsyncIterable<ChatStreamEvent>` | Streaming token lifecycle | Supports OpenAI/Ollama and future providers |
| `SearchService` (future) | `(request: SearchRequest) => Promise<SearchResult[]>` | Query execution lifecycle | Results include note metadata required by UI navigation |
| `ChatService` (future) | `(request: ChatRequest) => AsyncIterable<ChatStreamEvent>` | Streaming/cancel/error lifecycle | Context is explicit via `ChatContextChunk[]` |
| `ProgressSlideout` | `setStatus(snapshot: JobSnapshot)` (or adapter from `JobSnapshot`) | Idle/active/completed/error display | Keeps job UI coupled to typed job states |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Job state maps to `status: "running"` and progress label/detail updates in the slideout |
| Error   | Job or chat/search failures map to typed `error` event or `status: "failed"` with surfaced message |
| Empty   | Search returns `SearchResult[]` length `0`, or chat context array is empty prior to retrieval |
| Success | Search returns ranked results and chat streams `token` events ending with `done` without type assertions |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/types/domain.ts` | Optional extraction target if `src/types.ts` becomes too large; keep exports re-exported from `src/types.ts` |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Add domain interfaces/types for chunking, providers, search, chat, and jobs while preserving existing shell types |
| 2 | `src/settings.ts` | Narrow provider-related settings to typed IDs and ensure settings shape references shared domain aliases where applicable |
| 3 | `src/main.ts` | Update progress/status typing to align with new job-state contracts without changing runtime behavior |
| 4 | `src/ui/ProgressSlideout.ts` | Accept job-derived status shape (`JobSnapshot` or mapped type) instead of ad-hoc status literals |
| 5 | `src/__tests__/smoke.test.ts` | Add compile-level assertions/import checks for newly exported domain types |

### Files UNCHANGED (confirm no modifications needed)

- `src/constants.ts` — command/view IDs are already stable and independent from domain type expansion
- `src/ui/SearchView.ts` — still a placeholder shell in FND-3; no behavioral search flow changes
- `src/ui/ChatView.ts` — still a placeholder shell in FND-3; no streaming/rendering behavior changes

---

## 5. Acceptance Criteria Checklist

### Phase A: Core Domain Model Definition

- [x] **A1** — Chunk and embedding contracts are fully defined
  - `src/types.ts` includes canonical types for chunk identity, source metadata, content hash, and embedding vectors.
  - Fields needed by upcoming indexing/search stories (`notePath`, heading context, tags, hash, timestamps) are present without requiring `any`.

- [x] **A2** — Provider interfaces are extensible and provider-agnostic
  - `EmbeddingProvider` and `ChatProvider` interfaces use request/response envelopes that do not hardcode OpenAI/Ollama-only properties.
  - Provider IDs are typed so adding a new provider does not require widespread signature rewrites.

- [x] **A3** — Search and chat data contracts are explicit
  - Search request/result types include query controls and ranked result metadata required by UI and navigation.
  - Chat contracts include message roles, retrieval context payload, and typed streaming events (`token`, `done`, `error`).

### Phase B: Job Tracking and Shell Integration

- [x] **B1** — Job state contracts cover long-running workflows end to end
  - Job types/status enums and snapshot/progress interfaces are defined for indexing and embedding/chat tasks.
  - Failure shape includes structured error messaging suitable for user-facing notices/slideout rendering.

- [x] **B2** — Existing runtime shell compiles against new contracts
  - `src/main.ts`, `src/settings.ts`, and `src/ui/ProgressSlideout.ts` consume the shared domain types (or explicit adapters) with no behavior regressions.
  - Existing FND-2 placeholder commands and slideout rendering still function after type migration.

- [x] **B3** — Domain exports are discoverable for downstream stories
  - New types are exported from `src/types.ts` in a predictable, documented structure.
  - No duplicate parallel type definitions remain in shell files for concepts now represented in shared domain contracts.

### Phase C: Verification and Documentation Hygiene

- [x] **C1** — Type contract coverage is smoke-tested
  - `src/__tests__/smoke.test.ts` (or equivalent lightweight test) imports and validates core exported types compile in expected usage patterns.
  - Tests remain fast and do not introduce runtime-only provider dependencies.

- [x] **C2** — Story scope remains type-focused
  - No indexing/search/chat business logic is implemented in FND-3 beyond what is required to align compile-time contracts.
  - Placeholder UI behavior from FND-2 remains intentionally unchanged.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Overly broad type shapes can lock in assumptions before service behavior is implemented | Keep interfaces minimal and evidence-based from current architecture docs; defer speculative fields |
| 2 | Breaking existing shell typing while introducing richer domain contracts | Migrate incrementally and preserve backward-compatible aliases/adapters during FND-3 |
| 3 | Provider interfaces that are too provider-specific can force refactors in STO/CHAT stories | Use provider-agnostic request/response envelopes and generic `ProviderId` semantics |
| 4 | `Z4` may be partially non-applicable before a dedicated shared package exists | Keep gate for consistency and explicitly treat applicability during implementation verification |

---

## Implementation Order

1. `src/types.ts` — introduce core chunk, provider, search, chat, and job interfaces/types; preserve existing FND-2 types via compatibility aliases where needed (covers A1, A2, A3, B1).
2. `src/settings.ts` — align provider-related settings fields to shared type aliases and keep persisted data shape stable (covers B2).
3. `src/ui/ProgressSlideout.ts` — migrate status typing to job-derived contracts or a thin adapter type without changing UI behavior (covers B1, B2).
4. `src/main.ts` — update imports and placeholder progress status wiring to compile against shared types (covers B2, B3).
5. `src/__tests__/smoke.test.ts` — add lightweight compile/import checks for new domain exports (covers C1, B3).
6. **Verify** — run `npm run build`, `npm run lint`, `npm run typecheck`, and `npm run test` to confirm migration integrity (covers Z1, Z2, Z3).
7. **Final verify** — confirm no out-of-scope runtime feature logic was introduced and story remains contract-only (covers C2, Phase Z).

---

*Created: 2026-02-20 | Story: FND-3 | Epic: Epic 1 — Plugin Foundation and Runtime Shell*
