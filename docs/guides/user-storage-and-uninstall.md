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

---

*Part of Epic 10 (DOC-2).*
