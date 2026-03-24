# VEC-6: Tooling + user documentation (query script, IDE, sync, uninstall, privacy)

**Story**: Update [scripts/query-store.mjs](../../scripts/query-store.mjs) (or replace) so operators can inspect the **file-backed** `.sqlite3` database, including **sqlite-vec** tables where stock IDEs cannot. Add README (and/or user-facing doc) sections for default path, per-vault override, **full reindex** after upgrade, **cloud sync** risks, **uninstall** + manual deletion of vector files, and **privacy** (one DB per vault).
**Epic**: Epic 19 — Native SQLite + sqlite-vec Store (prompt 05)
**Size**: Medium
**Status**: Not Started

**Requirements**: [docs/prompts/05-SQLITE-vector-store-implementation.md](../prompts/05-SQLITE-vector-store-implementation.md) — §5 upgrade/reindex, §7 tooling, §9 backup/sync/uninstall, §1.6 privacy
**Plan**: [docs/plans/sqlite-vector-store-implementation-plan.md](../plans/sqlite-vector-store-implementation-plan.md) — Phase 6

---

## 1. Summary

Prompt 05 **§7 Option 1**:

- **DataGrip / DBeaver / sqlite3 CLI**: suitable for **ordinary** relational tables (`nodes`, `node_summaries`, …).
- **`node_embeddings` / `vec0`**: typically need **sqlite-vec** loaded; document limitation and provide **query script** that loads sqlite-vec (Node native add-on or CLI per VEC-0 outcome).

Prompt 05 **§9**:

- Machine-local default; warn on **sync/network folders** (performance, locking, corruption risk).
- **Uninstall**: plugin uninstall does not remove `~/.obsidian-ai/vector-store.<vaultName>.sqlite3` (or custom per-vault path); user may delete manually.

Prompt 05 **§5**:

- **Full reindex** after storage migration; optional note to remove stale `hierarchicalStore` JSON from `data.json` if present.

---

## 2. API Endpoints + Schemas

N/A.

---

## 3. Frontend Flow

N/A. Settings help text for path (VEC-1) may be cross-linked from README.

---

## 4. File Touchpoints

### Files to MODIFY (expected)

| # | Path | Purpose |
|---|------|---------|
| 1 | `scripts/query-store.mjs` | Accept absolute path to `.sqlite3`; subcommands for counts / sample / vec smoke |
| 2 | `package.json` | Script deps for Node sqlite + sqlite-vec if used |
| 3 | `README.md` | Storage location, privacy, reindex, sync warning, uninstall |
| 4 | `docs/prompts/05-SQLITE-vector-store-implementation.md` | Optional cross-link to “User guide” section if extracted |

### Files to CREATE (optional)

| # | Path | Purpose |
|---|------|---------|
| 1 | `docs/user-guide/vector-store.md` | If README would become too long |

---

## 5. Acceptance Criteria Checklist

### Phase A: Query script

- [ ] **A1** — Script documents required args: **absolute path** to `vector-store.*.sqlite3`
- [ ] **A2** — Script can run a read-only query against **relational** tables without sqlite-vec
- [ ] **A3** — Script documents how to query **vec** tables when extension is available (or invokes helper binary per VEC-0)
- [ ] **A4** — `npm run query:*` scripts in `package.json` updated and pass on a sample DB

### Phase B: README / user docs

- [ ] **B1** — Default location: `{userHome}/.obsidian-ai/vector-store.<vaultName>.sqlite3` explained in plain language
- [ ] **B2** — Per-vault **absolute path** setting documented (privacy: one vault ≠ another)
- [ ] **B3** — **Full reindex** required after Epic 19 storage cutover; optional `hierarchicalStore` JSON cleanup note
- [ ] **B4** — **Cloud sync / network folder** warning per §9.2
- [ ] **B5** — **Uninstall** mentions vector DB files left on disk and how to delete
- [ ] **B6** — **IDE inspection** note: non-vec tables OK in DBeaver; vec tables need extension or script

### Phase C: Developer docs

- [ ] **C1** — Epic 19 README row or plan links to this story and prompt 05

### Phase Z: Quality gates

- [ ] **Z1** — `npm run lint` / `npm test` unaffected or updated; script runs in maintainer environment

---

## 6. Risks & Tradeoffs

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Node sqlite-vec binary platform matrix | Document “supported dev platforms” or use Docker one-liner. |

---

## 7. Dependencies

- **Blocked by**: VEC-4–5 (stable on-disk format and path story); script can stub until path known
- **Blocks**: None (release polish)

---

## 8. Implementation Order

1. Finalize path examples from VEC-1 resolver
2. Implement or port `query-store.mjs` for SQLite file
3. Add vec query path per VEC-0 tooling choice
4. README sections (storage, upgrade, uninstall, sync)
5. Verify npm scripts and document in CONTRIBUTING or README

---

*Story: VEC-6 | Epic 19 | Prompt 05 §5, §7, §9 + plan Phase 6*
