# PRV-1: `OpenAIEmbeddingAdapter` / `OllamaEmbeddingAdapter`

**Story**: Ship **sidecar-local** `IEmbeddingPort` implementations for **OpenAI** and **Ollama** that honor **`embed(texts, apiKey?)`**, perform **true batch** embedding where the vendor API allows it, and read **base URL + model id** from **runtime configuration** (wired later from [README Plugin Settings](../../README.md#plugin-settings) via SRV-/PLG-stories) — without importing vendor SDKs into **`src/core/`**.
**Epic**: 6 — Provider adapters
**Size**: Medium
**Status**: Complete

---

## 1. Summary

Indexing and search already depend on **`IEmbeddingPort`** ([ADR-005](../decisions/ADR-005-provider-abstraction.md)); workflows batch strings in one call ([`IndexWorkflow`](../../src/core/workflows/IndexWorkflow.ts)). This story delivers **production adapters** in **`src/sidecar/adapters/`** so the sidecar can call **OpenAI** `POST /v1/embeddings` and **Ollama** `POST /api/embeddings` using **Node 18+ native `fetch`**.

**Secrets:** `apiKey` is **optional** and must be forwarded on the wire **only** when present (OpenAI **Bearer**); Ollama typically needs no key ([REQUIREMENTS §2](../requirements/REQUIREMENTS.md), [REQUIREMENTS §7](../requirements/REQUIREMENTS.md)). The sidecar must **not** persist keys ([README §1 — Key Design Decisions](../../README.md#1-hexagonal-architecture-ports-and-adapters)).

**Vector dimension** must match the **sqlite-vec** schema for the vault DB (see [`getEmbeddingDimension`](../../src/sidecar/db/migrate.ts)); mismatches surface as **clear errors** at `upsertEmbedding` time today — adapters should return **`Float32Array`** with lengths exactly as returned by the provider for the configured model.

**Downstream:** [WKF-2](WKF-2.md) / [RET-1](RET-1.md) / [CHAT-1](CHAT-1.md) continue to use the port; **SRV-*** stories bind settings → adapter instances.

Pointers: [IEmbeddingPort](../../src/core/ports/IEmbeddingPort.ts), [REQUIREMENTS §7](../requirements/REQUIREMENTS.md), [ADR-005](../decisions/ADR-005-provider-abstraction.md), [ADR-006](../decisions/ADR-006-sidecar-architecture.md).

---

## 2. Linked architecture decisions (ADRs)

| ADR | Why it binds this story |
|-----|-------------------------|
| [docs/decisions/ADR-005-provider-abstraction.md](../decisions/ADR-005-provider-abstraction.md) | Embeddings only through **`IEmbeddingPort`**; OpenAI/Ollama as **adapters**; registry/factory pattern; MVP provider set. |
| [docs/decisions/ADR-006-sidecar-architecture.md](../decisions/ADR-006-sidecar-architecture.md) | Provider HTTP calls run in the **sidecar**, not the Obsidian plugin; core stays free of infrastructure. |

---

## 3. Definition of Ready (DoR)

- [ ] Linked ADRs exist and are **Accepted** (or the story is explicitly labeled a **spike** and only **Proposed** ADRs apply)
- [ ] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [ ] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [ ] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration test, or script) where wrong-stack substitution is a risk

_Planning note: No **Tensions / conflicts** identified between README, REQUIREMENTS, and accepted ADRs for this story._

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Adapter implementations live under **`src/sidecar/adapters/`** (or a **`src/sidecar/providers/`** subtree if introduced, still **only** in the sidecar package graph). **`src/core/`** must not import these modules ([ADR-006](../decisions/ADR-006-sidecar-architecture.md)).
2. **Y2** — **`IEmbeddingPort.embed`** is the **only** embedding entry used by core; adapters implement that interface **without** changing the port signature ([ADR-005](../decisions/ADR-005-provider-abstraction.md)).
3. **Y3** — **OpenAI:** when `apiKey` is provided, send **`Authorization: Bearer <apiKey>`**; when omitted, still issue the request (allows local proxies that do not need a key — document failure modes in errors). **Ollama:** do not require `apiKey`.
4. **Y4** — **Batching:** **OpenAI** — a **single** HTTP request whose `input` carries **all** strings in `texts` (respect API max inputs; if over limit, split into **ordered** sub-batches and concatenate results preserving index order). **Ollama** — if the server API does not support multi-string batching for the configured version, **sequential** per-item calls are acceptable **provided** output order matches `texts` order (document in code comment).
5. **Y5** — **No official OpenAI/Ollama SDK** in `dependencies` for this story — use **`fetch`** only so the sidecar bundle stays thin and tests can stub `globalThis.fetch` (Phase **Y3** evidence).
6. **Y6** — **Base URL** and **model** come from **constructor / factory config** (trimmed strings); defaults match [README Plugin Settings](../../README.md#plugin-settings) **defaults** when callers omit overrides.

---

## 5. API Endpoints + Schemas

No new **plugin ↔ sidecar** routes are required in this story (SRV-* owns HTTP/stdio routing). Adapters call **external** provider HTTP APIs only.

**Optional** shared config type (place in `src/core/domain/types.ts` **only** if already used by wire payloads; otherwise keep **`EmbeddingAdapterConfig`** local to sidecar adapter files to avoid unnecessary core churn):

```ts
/** Sidecar-only: construction-time embedding provider wiring (mirrors Plugin Settings fields). */
export interface EmbeddingAdapterConfig {
  baseUrl: string;
  model: string;
}
```

If the type stays sidecar-local, **omit** from `types.ts` and document in adapter constructors instead.

---

## 6. Frontend Flow

Not applicable. **PLG-4** surfaces embedding provider settings in the Obsidian UI later.

### 6a. Component / Data Hierarchy

```
(n/a — sidecar adapters only)
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
| 1 | `src/sidecar/adapters/OpenAIEmbeddingAdapter.ts` | `IEmbeddingPort` for OpenAI-compatible `/v1/embeddings`. |
| 2 | `src/sidecar/adapters/OllamaEmbeddingAdapter.ts` | `IEmbeddingPort` for Ollama `/api/embeddings`. |
| 3 | `src/sidecar/adapters/createEmbeddingPort.ts` | Factory: `createEmbeddingPort(kind: 'openai' \| 'ollama', config) → IEmbeddingPort`. |
| 4 | `src/sidecar/adapters/OpenAIEmbeddingAdapter.test.ts` | `fetch` stub; batch order; Bearer header when key present. |
| 5 | `src/sidecar/adapters/OllamaEmbeddingAdapter.test.ts` | `fetch` stub; dimension + order. |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| — | — | *None required in this story; SRV-1 later imports factories/adapters from explicit paths or adds a barrel.* |

### Files UNCHANGED (confirm no modifications needed)

- `src/core/ports/IEmbeddingPort.ts` — contract already matches ADR-005; no signature churn.
- `src/core/workflows/IndexWorkflow.ts` — consumes port only; no provider imports.

---

## 8. Acceptance Criteria Checklist

### Phase A: OpenAI adapter behavior

- [x] **A1** — For `texts.length === n`, a single mocked `fetch` invocation receives a JSON body whose `input` is an **array of length n** (OpenAI batch) and `model` equals configured model id.
  - Evidence: `src/sidecar/adapters/OpenAIEmbeddingAdapter.test.ts::A1_openai_batch_payload(vitest)`

- [x] **A2** — When `apiKey` is defined, the request headers include **`Authorization: Bearer <value>`** exactly once.
  - Evidence: `src/sidecar/adapters/OpenAIEmbeddingAdapter.test.ts::A2_openai_bearer_header(vitest)`

- [x] **A3** — Response parsing maps `data[i].embedding` to **`Float32Array`** entries **in order**; non-OK HTTP throws an error that includes **status** (and body snippet when JSON parse fails, optional).
  - Evidence: `src/sidecar/adapters/OpenAIEmbeddingAdapter.test.ts::A3_openai_order_and_errors(vitest)`

### Phase B: Ollama adapter behavior

- [x] **B1** — Mocked `fetch` targets `{baseUrl}/api/embeddings` (normalized slash rules documented in code) with `model` and an `input` field appropriate to the implemented Ollama request shape.
  - Evidence: `src/sidecar/adapters/OllamaEmbeddingAdapter.test.ts::B1_ollama_url_and_body(vitest)`

- [x] **B2** — Returned vectors are **`Float32Array`** with length equal to the embedding returned by the mocked response; order matches `texts` for multi-call strategies.
  - Evidence: `src/sidecar/adapters/OllamaEmbeddingAdapter.test.ts::B2_ollama_order(vitest)`

### Phase C: Factory

- [x] **C1** — `createEmbeddingPort('openai', cfg)` and `createEmbeddingPort('ollama', cfg)` return objects that satisfy **`IEmbeddingPort`** at compile time (`implements` or explicit return type annotation).
  - Evidence: `npm run typecheck` (no errors) + `src/sidecar/adapters/createEmbeddingPort.ts` reviewed in PR

### Phase Y: Binding & stack compliance

- [x] **Y1** — **(binding)** No file under `src/core/` imports `OpenAIEmbeddingAdapter`, `OllamaEmbeddingAdapter`, or `createEmbeddingPort`.
  - Evidence: `scripts/check-core-imports.mjs(npm run verify:core-imports)` plus `rg "OpenAI|OllamaEmbedding|createEmbeddingPort" src/core` → no matches

- [x] **Y2** — **(binding)** Root `package.json` **`dependencies`** does not list **`openai`**, **`@ai-sdk/openai`**, or **`ollama`** npm packages (this story uses **`fetch` only**).
  - Evidence: `rg -E '"openai"|"@ai-sdk/openai"|"ollama"' package.json` exits **1** (no matches) after change

- [x] **Y3** — **(binding)** `scripts/check-source-boundaries.mjs(npm run check:boundaries)` passes (core remains free of `better-sqlite3` / `obsidian` patterns).
  - Evidence: `npm run check:boundaries`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths) — **N/A** (no `packages/shared`; types remain local or in `src/core/domain/types.ts` only if added)
- [x] **Z5** — New or modified code includes appropriate logging for errors and significant operations per the implementer's logging guidelines

---

## 9. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | OpenAI max inputs per request exceeded | Sub-batch in adapter; preserve order; test with n > limit using small limit constant in test. |
| 2 | Ollama version differences for batch | Document sequential fallback; keep order deterministic. |
| 3 | Embedding dimension vs sqlite-vec schema | Surface provider dimension in error metadata; align defaults with README embedding model defaults. |

---

## Implementation Order

1. `src/sidecar/adapters/OpenAIEmbeddingAdapter.ts` — implement `embed` with `fetch` + OpenAI response mapping (**A1–A3**).
2. `src/sidecar/adapters/OpenAIEmbeddingAdapter.test.ts` — stub `fetch` (**A1–A3**).
3. `src/sidecar/adapters/OllamaEmbeddingAdapter.ts` + `.test.ts` — (**B1–B2**).
4. `src/sidecar/adapters/createEmbeddingPort.ts` — factory (**C1**).
5. **Verify** — `npm run verify:core-imports`, `npm run check:boundaries`, `rg` package.json (**Y1–Y3**), `npm run build`, `npm test` for new tests.
6. **Final verify** — full test suite + lint.

---

*Created: 2026-04-05 | Story: PRV-1 | Epic: 6 — Provider adapters*
