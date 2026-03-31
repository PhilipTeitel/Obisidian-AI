# Obsidian AI — documentation foundation

This branch (`docs-foundation`) is a **documentation-only baseline** for restarting implementation: rolled-up **requirements** and **architecture decision records (ADRs)**. It intentionally does not include application source, build config, or prior story-level design artifacts.

## Contents

| Path | Purpose |
|------|---------|
| [docs/requirements/REQUIREMENTS.md](docs/requirements/REQUIREMENTS.md) | Single canonical product and technical requirements document for the MVP. |
| [docs/decisions/](docs/decisions/) | One ADR per file; numbered decisions on storage, retrieval, hierarchy, and providers. |
| [package.json](package.json) | Minimal package metadata placeholder for the repository root. |

## How to use this branch

- **Implement a new codebase** on top of these decisions: branch from `docs-foundation` or merge it into your development branch, then add TypeScript, Obsidian plugin scaffolding, and tooling.
- **Change the architecture** deliberately: update or supersede ADRs when decisions change, and keep `REQUIREMENTS.md` aligned with what you ship.

## ADR index

1. [ADR-001 — WASM SQLite + sqlite-vec for the shipped plugin](docs/decisions/ADR-001-wasm-sqlite-vec-shipped-plugin.md)
2. [ADR-002 — Hierarchical document model](docs/decisions/ADR-002-hierarchical-document-model.md)
3. [ADR-003 — Phased retrieval strategy](docs/decisions/ADR-003-phased-retrieval-strategy.md)
4. [ADR-004 — Per-vault index storage outside the vault](docs/decisions/ADR-004-per-vault-index-storage.md)
5. [ADR-005 — Provider abstraction](docs/decisions/ADR-005-provider-abstraction.md)
