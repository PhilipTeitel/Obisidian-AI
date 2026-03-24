# SQLite + sqlite-vec Vector Store Implementation

This document locks **implementation requirements** for replacing JSON-backed hierarchical index persistence with **wa-SQLite + sqlite-vec**, aligned with [R5 in 04-hierarchical-indexing.md](./04-hierarchical-indexing.md) and the decisions below. It supersedes any earlier assumption that the store lives under the vault, under the plugin folder, or in Obsidian `saveData`.

---

## 1. Goals

1. **Persist** the hierarchical index (nodes, children, summaries, embeddings, tags, cross-references) in a **real SQLite database file** using **sqlite-vec** for vector search (`vec0` / `node_embeddings` as defined in [src/storage/vectorStoreSchema.ts](../../src/storage/vectorStoreSchema.ts)).
2. **Avoid** Obsidian **`saveData` / `loadData`** for vector or hierarchical index payload data (performance and consistency).
3. **Avoid** placing the database **anywhere under the vault filesystem**, so the vault file watcher is not triggered on index writes.
4. **Remove** the **flat chunk vector pipeline** (`LocalVectorStoreRepository`, dual-write indexing, flat semantic search path). There is **no** optional fallback to JSON chunk storage for search.
5. **Keep** `saveData` / `loadData` for **non-index** plugin data only (e.g. settings, secrets strategy, UI state as applicable).
6. **Isolate vaults**: index data for one vault MUST **never** be stored in or mixed with another vault’s database file (**privacy**). There MUST be **at most one logical index database per vault**, and opening vault *A* MUST NOT read or write vault *B*’s store.

---

## 2. Storage location and path rules

### 2.1 Default directory (cross-platform)

- The default **parent directory** for the database file MUST be resolved in a **cross-platform** way using **Node `os.homedir()`** (or equivalent available in the Obsidian/Electron plugin runtime), not a hard-coded Unix `~` string.
- On all supported platforms, the default parent directory is:

  `{userHome}/.obsidian-ai/`

  where `{userHome}` is `os.homedir()` (e.g. `%USERPROFILE%` on Windows, the user’s home directory on macOS and Linux).

- The implementation MUST **create** `.obsidian-ai` (or the configured parent) when opening the store if it does not exist, subject to write permissions; errors MUST be surfaced clearly if creation or open fails.

*Rationale:* `os.homedir()` is the standard, portable way to locate the user profile in Node/Electron; it avoids shell-specific `~` expansion and works on Windows without special cases.

### 2.2 Default file name

- Default database **file name** (not full path):

  `vector-store.<vaultName>.sqlite3`

- `<vaultName>` MUST be derived from the **Obsidian vault name** exposed by the API (e.g. `app.vault.getName()` or the documented equivalent at implementation time).
- The vault name MUST be **normalized for use as a single path segment**: remove or replace characters that are invalid or unsafe on common file systems (e.g. `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, and leading/trailing dots or spaces as needed). If normalization produces an empty string, use a **stable fallback** (e.g. a short hash of the vault path) documented in code comments.

### 2.3 Configurable absolute path (per vault only)

- Plugin settings MUST allow the user to set the **full absolute path** to **this vault’s** SQLite database file (not only the parent directory).
- This override MUST be **scoped per vault** (e.g. stored with that vault’s plugin settings so it does not apply globally across vaults). There MUST be **no** single app-wide preference that forces **all** vaults to use the same database file—that would mix content and violate **privacy**.
- When the per-vault setting is **non-empty**, it **overrides** the default `{userHome}/.obsidian-ai/vector-store.<vaultName>.sqlite3` for **that vault only**.
- The implementation MUST validate that the path is usable (create parent directories if policy allows, or fail with a clear error). Exact validation rules are left to implementation, but the setting is explicitly **absolute path to the `.sqlite3` file** for the **current vault**.

### 2.4 Vault scope and privacy

- **Exactly one SQLite index file per vault** at a time: the active path is either the per-vault override or the default path for that vault’s name (§2.2).
- Opening vault *X* MUST open **only** vault *X*’s database; switching vaults MUST close or stop using the previous vault’s connection and use the path resolved for the new vault.
- Implementations MUST NOT merge, pool, or deduplicate index rows across vaults in a shared file. **Privacy** requires strict separation of vault index data on disk (separate files unless a future, explicitly scoped requirement says otherwise—which it does not here).

---

## 3. Runtime initialization (lazy `init`)

- Database **open**, **migration execution**, and **sqlite-vec** availability MUST be tied to **lazy initialization** consistent with [REL-1](../features/REL-1-implement-lazy-runtime-initialization-for-fast-plugin-startup.md): **first use** of **hierarchical storage** (first operation that requires the `HierarchicalStoreContract` / sqlite backend), not necessarily plugin constructor time.
- `RuntimeServiceLifecycle` `init()` for the hierarchical store MAY remain a no-op or lightweight until first real use, **provided** the contract is clear and all consumers either trigger open-on-first-use internally or document ordering; the requirement is **no heavy DB work at plugin load** unless explicitly revised in a later story.

---

## 4. Schema, embeddings, and search

### 4.1 Migrations and tables

- Apply existing **ordered** SQL migrations from [src/storage/vectorStoreSchema.ts](../../src/storage/vectorStoreSchema.ts) (or successor) against the real database connection.
- Track applied migration IDs / schema version in the **`metadata`** table (or equivalent) so upgrades are repeatable.

### 4.2 Summary vs content embeddings

- **Single logical store** for both **summary** and **content** embeddings (e.g. one `node_embeddings` / `vec0` table with `embedding_type` distinguishing `"summary"` vs `"content"`), as already reflected in the hierarchical migration—**no** separate vec table for summaries vs content for this phase.

### 4.3 Phase 1 retrieval semantics

- **Unchanged** from current behavior: Phase 1 searches **summary** embeddings for **any** node type that has a summary embedding (do **not** restrict to note/topic/subtopic only unless a future requirement changes this).

### 4.4 Vector search

- Use **sqlite-vec** for ANN (or documented sqlite-vec query patterns) for `searchSummaryEmbeddings` / `searchContentEmbeddings`, replacing in-memory full-scan cosine over JSON.

---

## 5. Upgrade and reindex

- After shipping this storage layer, users MUST be able to rely on a **full reindex** to rebuild the database. **No** required automatic import from legacy `data.json` hierarchical blobs.
- Implementers MAY document manual deletion of stale plugin data keys (e.g. old `hierarchicalStore` JSON) as part of migration notes; consistency of old JSON is **not** guaranteed.

---

## 6. Removal of flat pipeline

- Remove **`LocalVectorStoreRepository`** from the indexing and search paths, remove **dual-write** in `IndexingService`, and remove flat **semantic search** that depended on chunk rows in JSON.
- [src/storage/vectorStorePaths.ts](../../src/storage/vectorStorePaths.ts) paths that pointed under `.obsidian/plugins/.../storage` for the vector DB are **obsolete** for this design; update or replace with a **per-vault** resolver: profile-based default plus optional **per-vault** absolute path override (§2.3–2.4).

---

## 7. Tooling and external inspection

### 7.1 Generic SQL IDEs (DataGrip, DBeaver, etc.)

- The on-disk file is **standard SQLite 3** for **ordinary tables** (`nodes`, `node_children`, `node_summaries`, `node_tags`, `node_cross_refs`, `metadata`, etc.).
- **sqlite-vec `vec0` virtual tables** typically require the **sqlite-vec extension** to be loaded; **stock** SQLite or IDE drivers **may not** query `node_embeddings` successfully.

**Requirement (Option 1):**

- Document that users may use **DataGrip / DBeaver / sqlite3 CLI** for **non–vec** tables and ad hoc SQL.
- Provide or maintain a **`scripts/query-store.mjs`** (or successor) that loads **sqlite-vec** (or calls a binary that does) for **inspecting and querying vector-related tables**, since that was the motivation when JSON was the only store.

### 7.2 File type

- Primary on-disk format: **`.sqlite3`** SQLite database file.

---

## 8. `saveData` usage boundary

- **Continue** using Obsidian **`saveData` / `loadData`** for **settings**, **secrets** (per existing architecture), and other small plugin state **not** including the hierarchical vector index payload.
- **Do not** store bulk index or embedding data in `data.json`.

---

## 9. Backup, sync, and uninstall documentation

### 9.1 Machine-local default

- The database is **machine-local** by default. The product does not need to sync the DB across devices as part of MVP.

### 9.2 Cloud sync / network folders

- **User documentation** MUST state that placing the database (or the configured parent directory) in a **cloud-synced folder** (Dropbox, iCloud Drive, OneDrive, etc.) or on a **network volume** can cause **locking issues**, **corruption risk**, and **performance degradation** due to constant re-sync of a large, frequently written file.

### 9.3 Uninstall

- **User documentation** (e.g. README or dedicated uninstall section) MUST state that uninstalling the plugin does **not** necessarily delete vector store files under **`{userHome}/.obsidian-ai/`** (one file per vault by default, e.g. `vector-store.<vaultName>.sqlite3`), or at **user-configured per-vault paths**, and that users may **manually delete** those files to reclaim disk space.

---

## 10. Non-goals and open implementation details

- **Choosing the exact npm/wasm package names** for wa-sqlite + sqlite-vec and Obsidian/Electron bundling details is left to implementation stories (spike), provided the above behavioral requirements are met.
- **Mobile Obsidian** support for this stack is **not** asserted here; validate per target matrix when implementing.

---

## 11. Traceability

| This document | Related |
|---------------|---------|
| Storage engine | [04-hierarchical-indexing.md](./04-hierarchical-indexing.md) R5, Resolved #1 |
| Lazy init | REL-1 pattern, first use of hierarchical storage |
| Prior incorrect locations | Vault path, plugin `storage/`, `saveData` for index |
| Vault isolation | One DB file per vault; no shared global path; privacy (§1.6, §2.4) |

**Implementation plan:** [docs/plans/sqlite-vector-store-implementation-plan.md](../plans/sqlite-vector-store-implementation-plan.md) (phases, dependencies, definition of done). **Backlog:** README Epic 19. **Stories:** [VEC-0](../features/VEC-0-spike-wa-sqlite-sqlite-vec-obsidian-electron-bundle.md)–[VEC-6](../features/VEC-6-tooling-and-user-documentation.md).

---

*Last updated: per-vault privacy isolation for configurable path and all index data.*
