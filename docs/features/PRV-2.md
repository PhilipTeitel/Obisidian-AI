# PRV-2: `OpenAIChatAdapter` / `OllamaChatAdapter` (streaming)

**Story**: Ship **sidecar-local** `IChatPort` implementations for **OpenAI** and **Ollama** that **stream** text deltas via **`AsyncIterable<string>`**, honor **`apiKey?`** and **`options?: { signal?: AbortSignal; timeoutMs?: number }`** per [ADR-009](../decisions/ADR-009-chat-cancellation-and-timeout.md) and the [README API Contract](../../README.md#port-interfaces-internal-service-contracts), and build provider requests from **`(messages, context)`** using the **context-injection rules** below so both **SummaryWorkflow** (system + body as `context`) and **ChatWorkflow** (history + vault context) work without port signature changes.
**Epic**: 6 — Provider adapters
**Size**: Medium
**Status**: Complete

---

## 1. Summary

Chat and summarization already flow through **`IChatPort.complete`** ([ADR-005](../decisions/ADR-005-provider-abstraction.md)). The **README** and **ADR-009** specify a **fourth** `options` argument for **cancellation and timeout**; the on-disk **`IChatPort.ts`** may still lag — this story **must** end with a **single** port definition, all **fakes**, and both adapters compiling and behaving consistently.

**Message assembly (normative for adapters):** Let `ctx = context.trim()`.

- If `ctx === ''`, provider messages are **`[...messages]`** (no injection).
- If the **last** message in `messages` has **`role === 'user'`**, insert **immediately before** that message a **system** (or `system`-equivalent for Ollama) message:  
  `Vault context (use only this material for answering):\n` + `context`  
  (exact prefix string is implementer-tunable **provided** tests assert presence of `context` and ordering).
- **Else** (e.g. **SummaryWorkflow** today: only a **system** message in `messages`), append **`{ role: 'user', content: context }`**.

**Streaming:** Map OpenAI SSE (`data: {...}`) and Ollama NDJSON stream lines to **yielded string deltas** only (port contract). On **abort** or **timeout**, **stop yielding** promptly and **cancel** the `fetch` / reader ([ADR-009](../decisions/ADR-009-chat-cancellation-and-timeout.md)).

**Configuration:** **Base URL** and **model** id come from **constructor / factory config** aligned with [README Plugin Settings](../../README.md#plugin-settings) defaults.

Pointers: [IChatPort](../../src/core/ports/IChatPort.ts), [ChatMessage](../../src/core/domain/types.ts), [ADR-005](../decisions/ADR-005-provider-abstraction.md), [ADR-009](../decisions/ADR-009-chat-cancellation-and-timeout.md), [ADR-006](../decisions/ADR-006-sidecar-architecture.md).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [docs/decisions/ADR-005-provider-abstraction.md](../decisions/ADR-005-provider-abstraction.md) | Chat only through **`IChatPort`**; streaming; vendor-neutral delta shape. |
| [docs/decisions/ADR-009-chat-cancellation-and-timeout.md](../decisions/ADR-009-chat-cancellation-and-timeout.md) | **`options.signal`** and **`options.timeoutMs`** on `complete`; no hung streams. |
| [docs/decisions/ADR-006-sidecar-architecture.md](../decisions/ADR-006-sidecar-architecture.md) | Adapters run in the **sidecar**; core imports no HTTP stack. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration test, or script) where wrong-stack substitution is a risk

_Planning note: **README / ADR-009** already describe the four-parameter `complete` signature. If `src/core/ports/IChatPort.ts` still shows three parameters when implementation starts, **this story** reconciles the file and **all** TypeScript call sites/fakes so `npm run typecheck` passes — coordinate with [CHAT-2](CHAT-2.md) to avoid duplicate PRs if CHAT-2 lands first._

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Chat adapters live only under **`src/sidecar/adapters/`** (or **`src/sidecar/providers/`** if added); **`src/core/`** never imports them ([ADR-006](../decisions/ADR-006-sidecar-architecture.md)).
2. **Y2** — **`IChatPort.complete(messages, context, apiKey?, options?)`** matches **README** + **ADR-009**; **`options`** is optional; when **`signal`** aborts or **`timeoutMs`** elapses, the async iterator **ends** and underlying **`fetch`** is **aborted** where possible ([ADR-009](../decisions/ADR-009-chat-cancellation-and-timeout.md)).
3. **Y3** — **OpenAI:** `Authorization: Bearer` when `apiKey` provided. **Ollama:** no Bearer requirement.
4. **Y4** — **Context injection** follows **section 1** rules so **SummaryWorkflow** (`[system]` + body as `context`) and **chat** (history ending in `user` + vault `context`) both produce sensible provider payloads **without** changing workflow call signatures.
5. **Y5** — **No official OpenAI/Ollama chat SDK** in `dependencies` — use **`fetch`** + stream parsing only (**Y4** evidence).
6. **Y6** — **`timeoutMs`:** combine **caller `signal`** with a **timeout controller** via **`AbortSignal`** composition that works on **Node >= 18** (e.g. linked **`AbortController`** + `setTimeout`, or `AbortSignal.timeout` **only** if the repo’s engine baseline is bumped — today **`engines.node` is `>=18`**); timeout must **abort `fetch`** and end iteration.

---

## 5. API Endpoints + Schemas

No new **plugin ↔ sidecar** routes in this story. Adapters call vendor streaming endpoints (e.g. OpenAI **`POST /v1/chat/completions`** with `stream: true`, Ollama **`POST /api/chat`** with `stream: true`) using configured **`baseUrl`** and **`model`**.

**Port type(s)** — update `src/core/ports/IChatPort.ts` to match README/ADR-009 if not already:

```ts
export interface ChatCompletionOptions {
  /** When aborted, stop yielding and cancel the outbound request where possible. */
  signal?: AbortSignal;
  /** When set, abort if the stream does not complete within this budget (ADR-009). */
  timeoutMs?: number;
}

export interface IChatPort {
  complete(
    messages: ChatMessage[],
    context: string,
    apiKey?: string,
    options?: ChatCompletionOptions,
  ): AsyncIterable<string>;
}
```

Export **`ChatCompletionOptions`** from `src/core/ports/index.ts` if other modules need it.

---

## 6. Frontend Flow

Not applicable.

### 6a. Component / Data Hierarchy

```
(n/a)
```

### 6b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| — | — | — | — |

### 6c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| — | — |

---

## 7. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/sidecar/adapters/OpenAIChatAdapter.ts` | Streaming `IChatPort` for OpenAI-compatible chat completions. |
| 2 | `src/sidecar/adapters/OllamaChatAdapter.ts` | Streaming `IChatPort` for Ollama `/api/chat`. |
| 3 | `src/sidecar/adapters/createChatPort.ts` | Factory `createChatPort('openai' \| 'ollama', config) → IChatPort`. |
| 4 | `src/sidecar/adapters/OpenAIChatAdapter.test.ts` | SSE parsing, delta order, abort. |
| 5 | `src/sidecar/adapters/OllamaChatAdapter.test.ts` | NDJSON / stream parsing, abort. |
| 6 | `src/sidecar/adapters/chatProviderMessages.ts` | Shared context-injection rules for both providers. |
| 7 | `src/sidecar/adapters/composeAbortSignal.ts` | `signal` + `timeoutMs` composition (ADR-009). |
| 8 | `src/sidecar/adapters/readWithAbort.ts` | Race `reader.read()` with abort so timeouts cannot hang on stalled pulls. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| — | — | *None — `IChatPort` / `index.ts` / workflow test fakes already matched the four-parameter contract.* |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/ports/IChatPort.ts` — **already** matched ADR-009 / README before this implementation; no edit in this PR.
- `src/core/workflows/SummaryWorkflow.ts` — existing three-argument **`complete`** calls remain valid when the fourth parameter is optional.
- `src/core/ports/IEmbeddingPort.ts` — unrelated.
- `docs/decisions/ADR-009-chat-cancellation-and-timeout.md` — reference only.

---

## 8. Acceptance Criteria Checklist

### Phase A: Port alignment

- [x] **A1** — **`IChatPort.complete`** accepts optional fourth argument **`options?: ChatCompletionOptions`** exactly as in **section 5**; **`npm run typecheck`** passes repository-wide.
  - Evidence: `npm run typecheck`

### Phase B: OpenAI streaming adapter

- [x] **B1** — For a mocked streaming HTTP body, the adapter **yields** the **concatenation of delta text** in order until `[DONE]` (or vendor-equivalent end).
  - Evidence: `src/sidecar/adapters/OpenAIChatAdapter.test.ts::B1_openai_sse_deltas(vitest)`

- [x] **B2** — **Context injection:** when `messages = [{ role: 'user', content: 'Q' }]` and `context = 'V'`, the JSON body’s `messages` array contains **both** the injected vault system entry **before** the user message and preserves **`Q`** as the final user content.
  - Evidence: `src/sidecar/adapters/OpenAIChatAdapter.test.ts::B2_context_before_last_user(vitest)`

- [x] **B3** — When `messages = [{ role: 'system', content: 'S' }]` and `context = 'body'`, the outgoing `messages` are **`system S` then `user body`** (append-user rule).
  - Evidence: `src/sidecar/adapters/OpenAIChatAdapter.test.ts::B3_summary_shape(vitest)`

### Phase C: Ollama streaming adapter

- [x] **C1** — Mocked Ollama stream yields correct **string deltas** for at least two chunks.
  - Evidence: `src/sidecar/adapters/OllamaChatAdapter.test.ts::C1_ollama_stream_deltas(vitest)`

- [x] **C2** — **Same** context-injection tests as **B2/B3** (or shared test helper) pass for Ollama adapter payload shape.
  - Evidence: `src/sidecar/adapters/OllamaChatAdapter.test.ts::C2_ollama_context_rules(vitest)`

### Phase D: Abort + timeout

- [x] **D1** — When **`options.signal`** is aborted **mid-stream**, the adapter **stops yielding** within a **short** bounded window (test uses fake clock or immediate abort) and completes the async iterator without throwing **unless** existing product policy throws (document choice; test must assert **no unbounded hang**).
  - Evidence: `src/sidecar/adapters/OpenAIChatAdapter.test.ts::D1_abort_stops_stream(vitest)` (Ollama may share helper)

- [x] **D2** — When **`options.timeoutMs`** is a **small** positive value and the mocked stream **never ends**, the adapter **terminates** (error or stop — document; must not loop forever) and **aborts** `fetch`.
  - Evidence: `src/sidecar/adapters/OpenAIChatAdapter.test.ts::D2_timeout_aborts_fetch(vitest)`

### Phase E: Factory

- [x] **E1** — `createChatPort('openai', cfg)` / `createChatPort('ollama', cfg)` return **`IChatPort`** at compile time.
  - Evidence: `npm run typecheck` + `src/sidecar/adapters/createChatPort.ts` in PR

### Phase Y: Binding & stack compliance

- [x] **Y1** — **(binding)** No file under `src/core/` imports `OpenAIChatAdapter`, `OllamaChatAdapter`, or `createChatPort`.
  - Evidence: `scripts/check-core-imports.mjs(npm run verify:core-imports)` and `rg "OpenAIChat|OllamaChat|createChatPort" src/core` → no matches

- [x] **Y2** — **(binding)** Root `package.json` **`dependencies`** does not list **`openai`**, **`@ai-sdk/openai`**, or **`ollama`** npm packages.
  - Evidence: `rg -E '"openai"|"@ai-sdk/openai"|"ollama"' package.json` exits **1**

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths) — **N/A** (no shared package)
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | SSE / Ollama stream format drift | Keep parsing in small pure helpers with fixture strings in tests. |
| 2 | Duplicate port update vs CHAT-2 | If CHAT-2 merged first, drop port-file edits here and only add adapters; **A1** still must pass. |
| 3 | `AbortSignal` + `fetch` on older Node | Document engine requirement; use `AbortController` linking per ADR-009. |

---

## Implementation Order

1. `src/core/ports/IChatPort.ts` (+ `index.ts`) — **four-parameter** contract if needed (**A1**).
2. `SummaryWorkflow.test.ts`, `IndexWorkflow.test.ts` — update **`IChatPort`** fakes (**A1**).
3. `OpenAIChatAdapter.ts` + tests — **B1–B3**, **D1–D2**.
4. `OllamaChatAdapter.ts` + tests — **C1–C2**, share abort tests if practical.
5. `createChatPort.ts` — **E1**.
6. **Verify** — **Y1–Y2**, `npm run build`, `npm test`.
7. **Final verify** — lint + full suite.

---

*Created: 2026-04-05 | Story: PRV-2 | Epic: 6 — Provider adapters*
