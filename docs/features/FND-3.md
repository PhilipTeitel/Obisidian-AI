# FND-3: Core `ports/*` interfaces and `domain/types.ts`

**Story**: Define all core port interfaces under `src/core/ports/` and shared domain types in `src/core/domain/types.ts` so adapters and workflows have a single hexagonal contract — with no infrastructure imports in `src/core/`.
**Epic**: 1 — Scaffold, toolchain, and domain contracts
**Size**: Medium
**Status**: Open

---

## 1. Summary

This story freezes the **inbound/outbound boundaries** of the domain: storage, queue, embeddings, chat, vault access, progress, and sidecar transport. Implementations will live in `src/sidecar/adapters/` and `src/plugin/client/` in later stories; here we only define TypeScript interfaces and domain types.

Downstream work (chunker, workflows, SQLite store, queue, providers) depends on these contracts. The design must align with README [Hexagonal architecture](../../README.md#1-hexagonal-architecture-ports-and-adapters) and REQUIREMENTS [§13 Architecture constraints](../../docs/requirements/REQUIREMENTS.md).

Secrets are **not** a port: the plugin reads Obsidian SecretStorage and passes credentials per request in payloads ([README §1 note](../../README.md#1-hexagonal-architecture-ports-and-adapters)).

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                                                                                              | Why it binds this story                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [docs/decisions/ADR-002-hierarchical-document-model.md](../../docs/decisions/ADR-002-hierarchical-document-model.md)             | Node types, hierarchy, and document shape for `types.ts` and `IDocumentStore` surface.                  |
| [docs/decisions/ADR-005-provider-abstraction.md](../../docs/decisions/ADR-005-provider-abstraction.md)                           | `IEmbeddingPort` and `IChatPort` boundaries; OpenAI/Ollama are adapters only.                           |
| [docs/decisions/ADR-006-sidecar-architecture.md](../../docs/decisions/ADR-006-sidecar-architecture.md)                           | `ISidecarTransport` and split of concerns; vault access stays behind `IVaultAccessPort` on plugin side. |
| [docs/decisions/ADR-007-queue-abstraction.md](../../docs/decisions/ADR-007-queue-abstraction.md)                                 | `IQueuePort<T>` semantics: enqueue, dequeue, ack, nack, peek.                                           |
| [docs/decisions/ADR-008-idempotent-indexing-state-machine.md](../../docs/decisions/ADR-008-idempotent-indexing-state-machine.md) | Job step enums / progress correlation types for indexing (`jobId`, `runId`, step names).                |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs exist and are **Accepted**
- [x] README, requirements, and ADRs do not contradict each other on persistence, dependencies, or integration boundaries
- [x] Section 4 (Binding constraints) is filled with 3–8 bullets copied or restated from those ADRs
- [x] Phase Y (binding compliance) includes at least one criterion with **non-mock** evidence (static check, dependency manifest, integration/contract test, or script) where wrong-stack substitution is a risk

_Planning note: Job step string unions in types must match ADR-008 and README schema naming; if a naming mismatch is found during implementation, update **this spec + ADR-008 + README** in one PR or escalate — do not silently diverge._

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — No file under `src/core/` may import `obsidian`, `electron`, `better-sqlite3`, `@sqlite.org/sqlite-wasm`, or any `src/sidecar/` / `src/plugin/` adapter path.
2. **Y2** — Port interfaces are **implementation-agnostic**: no concrete class names from vendors in port method signatures (use plain types, generics, or small domain types).
3. **Y3** — `IQueuePort<T>` exposes at minimum: enqueue batch, dequeue batch, ack, nack, peek (names may be aliased but semantics must match ADR-007 / README §18).
4. **Y4** — Domain `NodeType` must include: `note`, `topic`, `subtopic`, `paragraph`, `sentence_part`, `bullet_group`, `bullet` (exact spelling as in ADR-002 / README SQLite CHECK).
5. **Y5** — Indexing job lifecycle types must be expressible in terms aligned with ADR-008 states (`queued`, `parsing`, `parsed`, `storing`, `stored`, `summarizing`, `summarized`, `embedding`, `embedded`, `failed`, `dead_letter` or documented subset for minimal first cut — must not invent incompatible state names).

---

## 5. API Endpoints + Schemas

No REST endpoints. **ISidecarTransport** and message envelope types may use TypeScript interfaces only; full wire protocol is deferred to SRV-\* stories. This story may introduce a **minimal** `SidecarMessage` discriminated union stub if needed for typing `ISidecarTransport`, or keep transport methods generic (`send(request: unknown)`) **only if** accompanied by a TODO and a follow-up story ID in a code comment — **prefer** a narrow union of known MVP operations if types are stable per README [API Contract](../../README.md#api-contract).

```ts
// Example shape (Implementer refines to match API Contract table):
export type NodeType =
  | 'note'
  | 'topic'
  | 'subtopic'
  | 'paragraph'
  | 'sentence_part'
  | 'bullet_group'
  | 'bullet';

// Implementer adds DocumentNode, queue item wrappers, progress events, etc.
```

---

## 6. Frontend Flow

### 6a. Component / Data Hierarchy

Not applicable. Ports and types only; no UI.

### 6b. Props & Contracts

Not applicable.

### 6c. States (Loading / Error / Empty / Success)

Not applicable.

---

## 7. File Touchpoints

### Files to CREATE

| #   | Path                                  | Purpose                                                                                                                                            |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/core/domain/types.ts`            | `NodeType`, `DocumentNode` (or equivalent), hashes, IDs, tag/cross-ref shapes as needed for ports.                                                 |
| 2   | `src/core/ports/IDocumentStore.ts`    | CRUD + query surface for hierarchical store (method names align with later STO-3; can throw `not implemented` only in adapters, not in interface). |
| 3   | `src/core/ports/IQueuePort.ts`        | Generic queue port per ADR-007.                                                                                                                    |
| 4   | `src/core/ports/IEmbeddingPort.ts`    | Embed text → vectors + dimension metadata.                                                                                                         |
| 5   | `src/core/ports/IChatPort.ts`         | Streaming chat; use `AsyncIterable` or callback type per team convention — document choice in file JSDoc.                                          |
| 6   | `src/core/ports/IVaultAccessPort.ts`  | Read file content by vault-relative path; plugin-only implementation later.                                                                        |
| 7   | `src/core/ports/IProgressPort.ts`     | Emit structured progress for UI (jobId, runId, step, note path).                                                                                   |
| 8   | `src/core/ports/ISidecarTransport.ts` | Send/receive typed messages or generic envelope + serializer contract.                                                                             |
| 9   | `src/core/ports/index.ts`             | Optional barrel export for adapters.                                                                                                               |

### Files to MODIFY

| #   | Path                             | Change                                                                             |
| --- | -------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | `eslint.config.mjs` (from FND-2) | Ensure `no-restricted-imports` for `src/core/**` lists forbidden modules (**Y1**). |
| 2   | `tsconfig` includes              | Ensure `src/core` resolves without pulling plugin/sidecar paths incorrectly.       |

### Files UNCHANGED (confirm no modifications needed)

- `src/sidecar/adapters/*` — not created yet beyond FND-1 stubs; no adapter implementations in this story.
- `docs/decisions/ADR-002` through `ADR-008` — accepted baselines; edit only if **Tensions / conflicts** discovered (then user resolves).

---

## 8. Acceptance Criteria Checklist

### Phase A: Domain types

- [ ] **A1** — `NodeType` union (or const enum) includes exactly the seven types in section 4 **Y4**, spelling-matched to README SQLite `CHECK` and ADR-002.
  - Verification: Compare to README schema and ADR-002.
  - Evidence: `src/core/domain/types.ts` + README excerpt in PR description

- [ ] **A2** — `DocumentNode` (or equivalent core tree node) includes fields needed for hierarchical model: identity, parent/child relationship, `type`, ordering, heading trail, content, content hash — subset acceptable if PR documents fields deferred to CHK-\* with explicit TODOs **only** where not needed for port signatures yet.
  - Verification: Types compile; CHK-1 story can import without rewrite.
  - Evidence: `src/core/domain/types.ts` reviewed against ADR-002

### Phase B: Ports defined

- [ ] **B1** — All seven ports from README §1 exist as `.ts` files under `src/core/ports/` with exported interfaces.
  - Verification: File list matches README names (`IDocumentStore`, `IQueuePort`, `IEmbeddingPort`, `IChatPort`, `IVaultAccessPort`, `IProgressPort`, `ISidecarTransport`).
  - Evidence: `ls src/core/ports`

- [ ] **B2** — `IQueuePort<T>` declares enqueue, dequeue, ack, nack, peek with async signatures consistent with ADR-007.
  - Verification: Compare method list to ADR-007 and README §18.
  - Evidence: `src/core/ports/IQueuePort.ts`

### Phase C: Compilation + lint

- [ ] **C1** — `npm run typecheck` passes with new interfaces referenced from a minimal `src/core/index.ts` or test import.
  - Evidence: `npm run typecheck`

- [ ] **C2** — `npm run lint` passes on `src/core/**`.
  - Evidence: `npm run lint`

### Phase Y: Binding & stack compliance

- [ ] **Y1** — **(binding)** ESLint fails if `src/core/**` imports `obsidian`, `better-sqlite3`, or relative paths into `src/sidecar/` / `src/plugin/` (adjust rule to allow only same-layer imports).
  - Verification: Temporary forbidden import in a throwaway branch triggers lint error.
  - Evidence: `eslint.config.mjs(npm run lint)` + screenshot/log of intentional violation test

- [ ] **Y2** — **(binding)** `rg "from 'obsidian'|from \"obsidian\"|better-sqlite3" src/core` returns no matches.
  - Evidence: `scripts/check-core-imports.mjs(npm run verify:core-imports)` or documented `rg` in CI

### Phase Z: Quality Gates

- [ ] **Z1** — `npm run build` passes with zero TypeScript errors in all configured TS projects
  - Evidence: `npm run build`

- [ ] **Z2** — `npm run lint` passes (or only pre-existing warnings)
  - Evidence: `npm run lint`

- [ ] **Z3** — No `any` types in any new or modified file under `src/core/`
  - Evidence: ESLint `@typescript-eslint/no-explicit-any` on `src/core`

- [ ] **Z4** — **N/A** — No `@shared/types` alias; exports use `src/core/ports/index.ts` or direct paths per repo convention.

- [ ] **Z5** — **N/A** — Port interfaces only; logging is adapter responsibility in later stories.

---

## 9. Risks & Tradeoffs

| #   | Risk / Tradeoff                                               | Mitigation                                                                                                                                                                    |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Over-specifying `ISidecarTransport` before SRV-1              | Start with minimal envelope; link follow-up to SRV-1 in JSDoc; align with README API Contract in same iteration.                                                              |
| 2   | `IChatPort` streaming shape differs between OpenAI and Ollama | Use a provider-neutral stream chunk type (delta text + done flag).                                                                                                            |
| 3   | `IDocumentStore` too large for one story                      | Include CRUD/search method **signatures** stubbed in comments or `never`-returning placeholders are forbidden — use real async signatures with `Promise<>` return types only. |

---

## Implementation Order

1. `src/core/domain/types.ts` — `NodeType`, core node and supporting types (**A1**, **A2**).
2. `src/core/ports/IQueuePort.ts`, `IDocumentStore.ts` — Queue and store shapes (**B2**, **B1** partial).
3. `src/core/ports/IEmbeddingPort.ts`, `IChatPort.ts` — Provider ports (**B1**).
4. `src/core/ports/IVaultAccessPort.ts`, `IProgressPort.ts`, `ISidecarTransport.ts` — Remaining ports (**B1**).
5. `src/core/ports/index.ts` — Barrel (**B1**).
6. ESLint restricted imports for `src/core` (**Y1**, **Y2**).
7. **Verify** — `npm run typecheck`, `npm run lint`, `npm run build`, `rg`/`verify:core-imports` (**C1**, **C2**, **Z1–Z3**).

---

_Created: 2026-04-04 | Story: FND-3 | Epic: 1 — Scaffold, toolchain, and domain contracts_
