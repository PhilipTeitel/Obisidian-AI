# ADR-004: Per-vault index database outside the vault

## Status

Accepted

## Context

Storing a large, frequently updated index **inside the vault** or in Obsidian’s **hot-reloaded plugin JSON** creates **watcher churn**, **performance** issues, and **privacy** risks if paths are mis-handled. Users may also run **multiple vaults** over time; index data must not **leak** between vaults.

## Decision

1. **One logical database per vault:** At any time, the active vault uses **exactly one** index database for that vault’s data. **No** merging of rows across vaults in a shared file.

2. **Default path outside the vault:** The default database location lives under a **user-home–scoped** application directory (cross-platform home resolution, not shell-specific `~` only), with a **per-vault** filename derived from a **normalized vault name** (with a safe fallback if normalization collapses).

3. **Per-vault override:** Settings allow an optional **absolute path** to this vault’s database file. The override is **scoped per vault**, not a single global path for all vaults.

4. **No bulk index in `saveData`:** Large embeddings and tree payloads are **not** stored in Obsidian’s generic plugin JSON persistence; settings/secrets may still use normal plugin persistence patterns.

5. **Lazy open:** **Open**, **migrate**, and **heavy** initialization occur on **first use** of the store (or explicit indexing), not as mandatory work in the plugin constructor, to preserve fast startup.

6. **User documentation:** Warn against placing the DB on **cloud-synced** or **network** paths; document that **uninstall** may leave files under the default home directory unless manually deleted.

## Consequences

- **Positive:** Cleaner Obsidian integration, better privacy isolation, predictable disk layout.
- **Negative:** Users must understand disk usage and path overrides; path validation UX matters.

## Alternatives considered

- **Index inside `.obsidian/plugins/...`:** Increases watcher noise and mixes large binary/SQLite growth with plugin config expectations.
- **Index inside vault folder:** Triggers vault file watching and sync tools may fight the DB.
- **Single global DB for all vaults:** Rejected — breaks privacy and complicates lifecycle.

## References

- [../requirements/REQUIREMENTS.md](../requirements/REQUIREMENTS.md) §7, §8
- [ADR-001-wasm-sqlite-vec-shipped-plugin.md](./ADR-001-wasm-sqlite-vec-shipped-plugin.md)
