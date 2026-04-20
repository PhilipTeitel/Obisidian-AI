# Index database location, sync, and uninstall

This document describes where the **semantic index** lives on disk, how it relates to your **vault**, and what to expect when you **change machines**, use **cloud sync**, or **remove the plugin**.

## Where the database file is

- **Default:** The sidecar uses a SQLite file under your user home directory, typically `~/.obsidian-ai/`, with a **filename derived from the vault name** (sanitized). This keeps large index data **outside the vault** by default, per [REQUIREMENTS §8](../requirements/REQUIREMENTS.md) and [ADR-004](../decisions/ADR-004-per-vault-index-storage.md) (see plugin `vaultDefaultDbPath` in `SidecarLifecycle` for the exact naming rule).
- **Override:** In plugin settings you can set an **absolute database path** (`dbPath`). That path is **per vault** (plugin data is per vault)—there is no single global index shared across all vaults.

## Cloud sync, network drives, and shared folders

- **Do not** place the SQLite database on a **cloud-synced folder** (e.g. Dropbox, iCloud Drive, OneDrive) or a **network filesystem** if you can avoid it. SQLite expects reliable file locking; sync clients and network latency can cause **corruption**, **database locked** errors, or **partial writes**.
- If you must use a custom path, prefer a **fast local disk** on the machine running Obsidian.

## Uninstall and leftover data

- Disabling or uninstalling the plugin **does not automatically delete** the index database file on disk. If you want to reclaim disk space, **delete the database file** (and any sidecar logs you care to remove) manually once you know you no longer need that index.
- After **storage or schema upgrades**, recovery is expected via **full reindex** from the vault (see REQUIREMENTS §8).

## Multiple vaults

- Each vault should use its **own** database (default naming already separates by vault). **Do not** point two vaults at the same `dbPath` file.

## Reindex recovery

- If the index seems inconsistent after a crash or failed run, use the command **Reindex vault (full)** from the command palette to rebuild from current note contents. Incremental indexing normally resumes from recorded job steps, but a full reindex is the straightforward user-controlled reset.

## Storage upgrades that touch the index

When a plugin update introduces new retrieval features, the sidecar may apply **additive SQLite migrations** on next startup. You don't need to do anything — the migrations are idempotent and preserve existing data — but the first run after an upgrade may be slower than usual, and the index may operate with reduced quality until a reindex runs:

- **FTS5 keyword index (`nodes_fts`)** — see [ADR-012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md) and [STO-4](../features/STO-4.md). The migration creates the virtual table and (if necessary) triggers a one-time `rebuild` from `nodes.content` when the FTS index is still empty while `nodes` already has rows (detected via the FTS5 docsize table; `COUNT(*)` on the external-content virtual table alone is not sufficient). After this runs, hybrid search (vector + BM25) becomes available via the **Enable hybrid search** setting. Rebuild time scales with vault size; you will see a `migrations` log entry in the sidecar log on startup. A full **Reindex vault (full)** remains a supported alternative if you prefer to rebuild from scratch.
- **`note_meta.note_date`** — see [ADR-014](../decisions/ADR-014-temporal-and-path-filters.md). The column is added with all rows set to `NULL`; dates are populated on the next indexing pass for notes whose paths match `dailyNotePathGlobs`. Until you reindex, temporal filters (`last:14d`, `since:2026-04-01`, etc.) will exclude notes whose `note_date` has not yet been parsed. **Run "Reindex vault (full)"** once after this upgrade to populate the column across your Daily notes.
- **`summaries.prompt_version`** — see [ADR-013](../decisions/ADR-013-structured-note-summaries.md) and [WKF-4](../features/WKF-4.md). Existing summaries are backfilled to `prompt_version = 'legacy'` and treated as stale; they will be **regenerated** during the next summary pass using the new structured rubric (`SUMMARY_RUBRIC_V1`). The first full reindex after this upgrade will make **more LLM summary calls than a typical incremental run** — factor that into cost/rate-limit planning if you use a paid provider.

In general, after any plugin upgrade that mentions retrieval quality or summary changes in release notes, running **Reindex vault (full)** from the command palette is the simplest way to guarantee the new behavior is applied uniformly across your vault.

---

_Part of Epic 10 (DOC-2)._
