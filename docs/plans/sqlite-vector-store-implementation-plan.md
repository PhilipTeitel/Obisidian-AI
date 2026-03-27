# Implementation plan: SQLite + sqlite-vec vector store

This plan implements [docs/prompts/05-SQLITE-vector-store-implementation.md](../prompts/05-SQLITE-vector-store-implementation.md) and completes [R5 / Resolved #1 in 04-hierarchical-indexing.md](../prompts/04-hierarchical-indexing.md). It is the engineering breakdown for **Epic 19** in the README.

**Story specs (planned):** [VEC-0](../features/VEC-0-spike-wa-sqlite-sqlite-vec-obsidian-electron-bundle.md) · [VEC-1](../features/VEC-1-per-vault-db-path-resolver-and-settings.md) · [VEC-2](../features/VEC-2-lazy-db-lifecycle-open-create-dispose.md) · [VEC-3](../features/VEC-3-run-vector-store-migrations-on-real-connection.md) · [VEC-4](../features/VEC-4-reimplement-sqlitevecrepository-with-sql-and-sqlite-vec.md) · [VEC-5](../features/VEC-5-remove-flat-store-hierarchical-only-search.md) · [VEC-6](../features/VEC-6-tooling-and-user-documentation.md)

---

## 1. Current state (baseline)

| Area | Today |
|------|--------|
| **Hierarchical store** | [SqliteVecRepository](../../src/storage/SqliteVecRepository.ts) persists `hierarchicalStore` key via `plugin.loadData` / `saveData` (JSON); vector search is in-memory cosine over arrays. |
| **Flat store** | [LocalVectorStoreRepository](../../src/storage/LocalVectorStoreRepository.ts) + [IndexingService](../../src/services/IndexingService.ts) dual-write (`replaceAllFromChunks`, `upsertFromChunks`, `deleteByNotePaths`). |
| **Semantic search UI** | [main.ts](../../src/main.ts) `SearchPaneModel.runSearch` calls `searchService.search()` (flat), then [adaptSearchResultToHierarchical](../../src/main.ts). Chat `runSourceSearch` uses flat `search()` too. |
| **Schema** | [vectorStoreSchema.ts](../../src/storage/vectorStoreSchema.ts) defines migrations including `vec0`; SQL is **not** executed in-app. |
| **Paths** | [vectorStorePaths.ts](../../src/storage/vectorStorePaths.ts) resolves under `.obsidian/plugins/.../storage` — **obsolete** per §6 of the requirements doc. |

---

## 2. Target state (definition of done)

1. **One `.sqlite3` file per vault** under `{userHome}/.obsidian-ai/vector-store.<vaultName>.sqlite3` by default, or **per-vault absolute path** from settings (§2 of requirements).
2. **No index payload** in `data.json`; **no** `saveData` for hierarchical blobs; settings/secrets unchanged (§8).
3. **Migrations run** against the real DB; **`metadata`** tracks applied migration IDs (§4.1).
4. **`HierarchicalStoreContract`** implemented with **SQL + sqlite-vec** for reads/writes and **ANN** (or official sqlite-vec KNN) for `searchSummaryEmbeddings` / `searchContentEmbeddings` (§4.4).
5. **Lazy open**: first use of hierarchical storage opens DB and runs migrations; avoid heavy work at plugin load (§3).
6. **Flat pipeline removed**: no `LocalVectorStoreRepository` in bootstrap; `IndexingService` does not call `vectorStoreRepository`; `SearchService.search` and all UI entry points use **hierarchical retrieval only** (§4, §6 of requirements + UI wiring below).
7. **Tooling**: `scripts/query-store.mjs` (or successor) documents/opens DB with sqlite-vec for `node_embeddings`; user docs cover IDE use for non-vec tables, sync risk, uninstall (§7, §9).
8. **Upgrade**: document **full reindex**; optional note to remove stale `hierarchicalStore` JSON (§5).

---

## 3. Phases and work packages

### Phase 0 — Spike (blocking)

**Goal:** Lock **sqlite-vec** SQL semantics (`vec0` DDL, KNN / `MATCH` usage) and **schema alignment** with migration 003 under **Node** (`better-sqlite3` + npm `sqlite-vec`). **In-bundle wa-SQLite + sqlite-vec** in the Obsidian renderer is **VEC-2**, not Phase 0 ([ADR-001](../decisions/ADR-001-sqlite-vec-stack.md), [VEC-0](../features/VEC-0-spike-wa-sqlite-sqlite-vec-obsidian-electron-bundle.md)).

**Outputs:**

- Decision record: Node proof stack, shipped-plugin constraint (WASM only, no native addons), esbuild/external rules for `main.js`, desktop dev matrix for optional `sqlite-vec-*` packages.
- Proof: open/create `.sqlite3` under **`{userHome}/.obsidian-ai/`** (same default parent as prompt 05 §2.1) or `--out`; `vec0` matching `vectorStoreSchema` migration 003; insert rows; one sqlite-vec vector query; clean close.

**Exit criteria:** Implementers agree the Node proof satisfies §4.4 (vector search via sqlite-vec, not JS full-scan) and file I/O **outside the vault**; VEC-2 owner has a clear WASM follow-up.

---

### Phase 1 — Path resolution and settings

**Goal:** §2.1–2.4 — cross-platform default dir, vault-scoped filename, **per-vault** absolute override.

**Tasks:**

1. Add settings field(s), e.g. `vectorStoreAbsolutePath` (optional string), persisted with existing settings (vault-scoped `data.json` is acceptable for **path only**).
2. Implement `resolveVectorStoreDatabasePath({ vaultName, vaultPath, settings })` → absolute `.sqlite3` path:
   - Use `path.join(os.homedir(), ".obsidian-ai", ...)` for default parent.
   - Normalize `vaultName` for filesystem (§2.2); fallback hash if empty.
3. Ensure **no** global setting applies across vaults (privacy §1.6).
4. Replace or supersede [vectorStorePaths.ts](../../src/storage/vectorStorePaths.ts) for the hierarchical DB (flat metadata paths may be removed with flat store).

**Dependencies:** None after Phase 0 for FS access pattern.

**Tests:** Unit tests for path resolution (mock `os.homedir`, edge names, override wins, sanitization).

---

### Phase 2 — DB engine module and lazy lifecycle

**Goal:** §3 — open/create DB on **first hierarchical store use**; clean shutdown.

**Tasks:**

1. New module (e.g. `src/storage/sqlite/…`) responsible for:
   - Opening/creating file and parent dir `.obsidian-ai` when needed.
   - Loading sqlite-vec; single connection (or pool policy) per plugin instance / vault.
2. Integrate with [RuntimeServiceLifecycle](../../src/types.ts): `dispose()` closes DB; avoid leaking on plugin unload.
3. **Vault switch:** Obsidian loads one vault per window typically; if runtime is recreated per vault, document it. If not, ensure connection is keyed by resolved path and previous connection closed when vault changes (edge case).

**Dependencies:** Phase 1 path, Phase 0 engine.

**Tests:** Integration or harness tests where WASM runs in CI; if impossible, minimal smoke + manual checklist.

---

### Phase 3 — Migration runner

**Goal:** §4.1 — execute [VECTOR_STORE_MIGRATIONS](../../src/storage/vectorStoreSchema.ts) in order.

**Tasks:**

1. On first open, read `metadata` for applied migration IDs (or schema version); apply pending statements in transactions where safe.
2. Align with existing migration IDs (`001_…`, `002_…`, `003_…`); adjust only if sqlite-vec DDL differs from what the chosen runtime accepts.
3. Log migration start/complete/failure (structured logging).

**Dependencies:** Phase 2.

**Tests:** Fresh DB applies all migrations; second open is idempotent.

---

### Phase 4 — `SqliteVecRepository` rewrite (SQL + vec)

**Goal:** Replace JSON/Map implementation with relational + vec operations; same [HierarchicalStoreContract](../../src/types.ts).

**Tasks (grouped):**

1. **Nodes / children:** `upsertNodeTree`, `deleteByNotePath`, `getNode`, `getChildren`, `getAncestorChain`, `getSiblings`, `getNodesByNotePath`, `getNodesByTag` — SQL against `nodes`, `node_children`, `node_tags` as in schema.
2. **Summaries:** `upsertSummary`, `getSummary` — `node_summaries`.
3. **Embeddings:** `upsertEmbedding` — insert/update `node_embeddings` (vec0); delete rows when nodes removed.
4. **Tags / cross-refs:** `upsertTags`, `upsertCrossReferences`, `getCrossReferences` — `node_tags`, `node_cross_refs`.
5. **Search:** `searchSummaryEmbeddings`, `searchContentEmbeddings` — sqlite-vec KNN with filters (`embedding_type`, optional `parentId` scope for content search per current contract).
6. **Transactions:** `upsertNodeTree` / `deleteByNotePath` must remain consistent (FK cascades or explicit deletes).
7. Remove `HIERARCHICAL_STORE_KEY` JSON persistence from [SqliteVecRepository](../../src/storage/SqliteVecRepository.ts).

**Dependencies:** Phase 3.

**Tests:** Extend [sqliteVecRepository.test.ts](../../src/__tests__/unit/sqliteVecRepository.test.ts) with file-backed or WASM-backed DB; keep contract coverage from STOR-2.

**Risks:** `FLOAT[1536]` in schema vs user embedding dimensions — track as follow-up (migration or validation at embed time).

---

### Phase 5 — Remove flat pipeline and rewire search

**Goal:** §6 + end-to-end product behavior.

**Tasks:**

1. **Bootstrap:** Remove `LocalVectorStoreRepository` construction; remove `vectorStoreRepository` from [ServiceContainer](../../src/services/ServiceContainer.ts), [RuntimeServices](../../src/types.ts), and [bootstrapRuntimeServices](../../src/bootstrap/bootstrapRuntimeServices.ts) if nothing else needs it.
2. **IndexingService:** Delete all calls to `vectorStoreRepository` (full + incremental + delete paths). Adjust deps type.
3. **SearchService:**
   - Remove or repurpose `vectorStoreRepository` from deps.
   - Implement `search()` as **hierarchical-only**: embed query → Phase 1 → Phase 2 → (optional) map to `SearchResult[]` for callers that still expect flat shape, **or** change callers to use `HierarchicalSearchResult` only.
4. **main.ts:** Replace `runSearch` / `runSourceSearch` flat calls with hierarchical pipeline (reuse logic already used elsewhere or consolidate inside `SearchService`).
5. **ChatService:** Update source search path to hierarchical (§6).
6. **Delete or archive** [LocalVectorStoreRepository](../../src/storage/LocalVectorStoreRepository.ts) and strip `VectorStoreRepositoryContract` from services if unused; prune types/tests.
7. **AgentService** / any other `vectorStoreRepository` consumer — grep and update.

**Dependencies:** Phase 4 (functional hierarchical store).

**Tests:** Fix all unit/integration tests that mock `vectorStoreRepository`; update [searchService.test.ts](../../src/__tests__/unit/searchService.test.ts), [main.ts](../../src/main.ts) flows, e2e journeys.

---

### Phase 6 — Tooling and documentation

**Goal:** §7, §9.

**Tasks:**

1. **query-store.mjs:** Accept absolute path to `.sqlite3`; use Node sqlite + sqlite-vec native or documented CLI for vec queries; document limitations for IDE-only users.
2. **README / user docs:** Default location, per-vault override, full reindex after upgrade, cloud sync warning, uninstall + manual file deletion, privacy (one DB per vault).
3. **Developer docs:** Link this plan and prompt 05 from README Epic 19.

**Dependencies:** Phase 4–5 (stable path and file format).

---

## 4. Dependency order (summary)

```text
Phase 0 (spike)
    → Phase 1 (paths + settings)
    → Phase 2 (lazy DB lifecycle)
    → Phase 3 (migrations)
    → Phase 4 (repository rewrite)
    → Phase 5 (remove flat + UI search wiring)  [can start design in parallel; merge after Phase 4]
    → Phase 6 (tooling + docs)
```

---

## 5. Risk register

| Risk | Mitigation |
|------|------------|
| WASM / extension fails on some Obsidian versions | Spike on minimum supported version; CI matrix note. |
| sqlite-vec + stock IDE | Documented in §7.1 (Option 1). |
| Embedding dimension ≠ 1536 | Validate at index time or add migration story for dynamic dimension. |
| Two vaults same normalized name | Hash fallback or include vault path in suffix when collision detected. |
| Large DB on sync folder | §9.2 user documentation. |

---

## 6. Out of scope (per prompt 05 §10)

- Mobile Obsidian support (validate separately).
- Automatic import from legacy JSON hierarchical blobs (full reindex only, §5).

---

## 7. Traceability

| Requirement doc section | Plan phase |
|-------------------------|------------|
| §1 Goals | Phases 4–6 |
| §2 Paths / privacy | Phase 1 |
| §3 Lazy init | Phase 2 |
| §4 Schema / vec search | Phases 3–4 |
| §5 Reindex | Phase 6 (docs) |
| §6 Remove flat | Phase 5 |
| §7–9 Tooling / docs | Phase 6 |

---

*Plan version: 1.0 — aligned with [05-SQLITE-vector-store-implementation.md](../prompts/05-SQLITE-vector-store-implementation.md).*
