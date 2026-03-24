# VEC-1: Per-vault DB path resolver + settings (`vectorStoreAbsolutePath`)

**Story**: Add **vault-scoped** plugin settings and pure path resolution so the hierarchical SQLite file defaults to `{userHome}/.obsidian-ai/vector-store.<vaultName>.sqlite3`, with an optional **per-vault absolute path** override. Enforce **privacy**: no single global path shared across vaults.
**Epic**: Epic 19 — Native SQLite + sqlite-vec Store (prompt 05)
**Size**: Medium
**Status**: Not Started

**Requirements**: [docs/prompts/05-SQLITE-vector-store-implementation.md](../prompts/05-SQLITE-vector-store-implementation.md) — §2.1–2.4, §1.6 vault isolation
**Plan**: [docs/plans/sqlite-vector-store-implementation-plan.md](../plans/sqlite-vector-store-implementation-plan.md) — Phase 1

---

## 1. Summary

Prompt 05 requires:

- Default parent: **`path.join(os.homedir(), ".obsidian-ai")`** (cross-platform; no literal `~` in code).
- Default file name: **`vector-store.<vaultName>.sqlite3`** where `vaultName` comes from Obsidian (`app.vault.getName()` or equivalent), **sanitized** for one filesystem segment, with **stable hash fallback** if sanitization yields empty (prompt 05 §2.2).
- **Per-vault** optional setting: full absolute path to **this vault’s** `.sqlite3` file; must **not** apply globally across vaults (§2.3–2.4).

This story implements **resolution only** (and settings persistence). It does **not** open SQLite (VEC-2+) unless a thin integration test uses a temp file.

---

## 2. API Endpoints + Schemas

### Settings schema (illustrative)

Add a field such as:

- `vectorStoreAbsolutePath?: string` — trimmed; empty means “use default computed path”.

Persist via existing settings migration/versioning (e.g. CFG-6 patterns). Store in **vault-scoped** plugin data (Obsidian’s per-vault `data.json` for **settings only** is allowed per prompt 05 §8).

### Pure function contract (illustrative)

```ts
export interface ResolveVectorStorePathInput {
  vaultName: string;
  vaultPath: string; // for hash fallback / collision policy if adopted later
  vectorStoreAbsolutePathOverride?: string | undefined;
}

export function resolveVectorStoreDatabasePath(input: ResolveVectorStorePathInput): string;
```

---

## 3. Frontend Flow

### 3a. Settings UI

- Add control(s) on the plugin settings tab: optional **absolute path** to this vault’s vector DB (with helper text: per-vault, privacy, default location).
- Validate non-empty override looks like an absolute path (platform-specific rules minimal: leading `/` on POSIX, drive or `\\` on Windows as applicable).

### 3b. Privacy

- Do **not** introduce a global (cross-vault) setting key that forces one DB path for all vaults.

---

## 4. File Touchpoints

### Files to CREATE (expected)

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/storage/resolveVectorStoreDatabasePath.ts` (or `src/utils/…`) | Sanitization + default + override |
| 2 | `src/__tests__/unit/resolveVectorStoreDatabasePath.test.ts` | Unit tests |

### Files to MODIFY (expected)

| # | Path | Purpose |
|---|------|---------|
| 1 | Settings schema + defaults + migration | New field |
| 2 | Settings tab UI | Expose override |
| 3 | `src/types.ts` or settings types module | Type-safe access |

### Files to SUPERSEDE (later)

| # | Path | Notes |
|---|------|-------|
| 1 | `src/storage/vectorStorePaths.ts` | Obsolete for hierarchical DB per prompt 05 §6; VEC-5 may remove flat consumer entirely |

---

## 5. Acceptance Criteria Checklist

### Phase A: Default path

- [ ] **A1** — Default resolved path equals `{homedir}/.obsidian-ai/vector-store.<sanitizedVaultName>.sqlite3` when override is empty
- [ ] **A2** — `os.homedir()` (or equivalent) is used; no hard-coded `~` string as the sole resolution mechanism
- [ ] **A3** — Invalid filename characters in vault name are stripped/replaced per §2.2; empty-after-sanitize uses documented hash fallback incorporating `vaultPath` or similar

### Phase B: Override

- [ ] **B1** — When override is non-empty, resolved path equals trimmed override (absolute)
- [ ] **B2** — Override is stored in **per-vault** plugin settings only (no cross-vault key)

### Phase C: UX and docs (light)

- [ ] **C1** — Settings UI documents default location and that path is **per vault**
- [ ] **C2** — Unit tests cover Windows-style and POSIX-style homedir mocks where feasible

### Phase Z: Quality gates

- [ ] **Z1** — `npm run typecheck && npm run build && npm run test && npm run lint`

---

## 6. Risks & Tradeoffs

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Two vaults sanitize to same file name | Hash fallback or append disambiguator (plan risk register); document in resolver. |
| 2 | User override points inside vault | Optionally warn in UI (watcher); prompt 05 forbids under-vault for **default**; override is user responsibility—document. |

---

## 7. Dependencies

- **Blocked by**: None strictly (can mock homedir)
- **Blocks**: VEC-2 (needs resolved absolute path at open time)

---

## 8. Implementation Order

1. Implement `sanitizeVaultNameForFilename` + `resolveVectorStoreDatabasePath`
2. Wire settings schema + migration + defaults
3. Add settings UI + validation
4. Unit tests (edge cases: empty name, weird Unicode, override wins)
5. Export resolver for bootstrap / `SqliteVecRepository` deps in VEC-2

---

*Story: VEC-1 | Epic 19 | Prompt 05 §2 + plan Phase 1*
