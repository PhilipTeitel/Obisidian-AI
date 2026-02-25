# CFG-3: Integrate Obsidian secret store for API key management

**Story**: Implement secure OpenAI API key management through Obsidian secret storage so secrets are never persisted in plain plugin settings.
**Epic**: Epic 6 — Settings, Secrets, and Configuration Guardrails
**Size**: Small
**Status**: Done

---

## 1. Summary

CFG-3 adds full secret-store lifecycle support for the plugin: read, write, and delete operations for API keys, with graceful fallback when secret APIs are unavailable in the runtime environment. This closes the gap where secret handling was previously read-only.

The settings tab now includes explicit controls to save or clear the OpenAI API key in Obsidian keychain storage. The key is never serialized into plugin settings payloads, preserving the security boundary between user configuration and credential storage.

This story ensures provider integrations can safely retrieve keys at runtime while giving users a practical in-plugin workflow for key management.

---

## 2. API Endpoints + Schemas

No external API endpoint changes are needed for this story.

Internal secret store contract changed:

```ts
export interface SecretStoreContract {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<boolean>;
  deleteSecret(key: string): Promise<boolean>;
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
Settings Tab
└── OpenAI API key controls
    ├── Save button -> PluginSecretStore.setSecret()
    ├── Clear button -> PluginSecretStore.deleteSecret()
    └── Status text <- PluginSecretStore.getSecret()
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `PluginSecretStore.getSecret` | `(key) => Promise<string | null>` | Stateless wrapper | Reads keychain value with trim/null normalization |
| `PluginSecretStore.setSecret` | `(key, value) => Promise<boolean>` | Stateless wrapper | Writes secret when runtime supports secure save |
| `PluginSecretStore.deleteSecret` | `(key) => Promise<boolean>` | Stateless wrapper | Removes secret or falls back to blank-save |
| `ObsidianAISettingTab` API key controls | Save/Clear button handlers | Local input state | Persists key via keychain and refreshes status message |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | API key status displays checking message before keychain lookup resolves |
| Error | If secret APIs are unavailable, user receives a notice with actionable text |
| Empty | No key found shows “not set” status |
| Success | Save/clear actions update keychain and status text |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/pluginSecretStore.test.ts` | Verify read/write/delete behavior and unsupported-runtime fallback |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Extend `SecretStoreContract` to include write/delete operations |
| 2 | `src/secrets/PluginSecretStore.ts` | Implement save/delete capability checks and fallback handling |
| 3 | `src/settings.ts` | Add OpenAI key Save/Clear UI controls and keychain status messaging |
| 4 | `src/__tests__/setup/mockObsidianModule.ts` | Add mock secret write/delete and settings button support for test runtime |

### Files UNCHANGED (confirm no modifications needed)

- `src/providers/embeddings/OpenAIEmbeddingProvider.ts` — provider still reads key via `getSecret`
- `src/providers/chat/OpenAIChatProvider.ts` — chat provider key retrieval contract unchanged

---

## 5. Acceptance Criteria Checklist

### Phase A: Secret Store Contract

- [x] **A1** — Secret store contract supports get/set/delete semantics
  - Runtime contract includes write and delete methods with boolean success signaling.
  - Evidence: `src/types.ts::secret_store_contract_methods(code_review)`

- [x] **A2** — Plugin secret store handles capability detection safely
  - Missing secure APIs return `false` instead of throwing.
  - Evidence: `src/__tests__/unit/pluginSecretStore.test.ts::returns_false_for_write_delete_when_secret_apis_unavailable(vitest)`

### Phase B: UI Integration

- [x] **B1** — Settings tab provides explicit API key save and clear actions
  - OpenAI API key is managed via keychain controls in settings UI.
  - Evidence: `src/settings.ts::openai_api_key_save_clear_controls(code_review)`

- [x] **B2** — API key is not persisted in plain settings payload
  - Settings persistence writes configuration envelope only; key stays in secret storage.
  - Evidence: `src/main.ts::versioned_settings_envelope_without_key_material(code_review)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::scripts.build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::scripts.lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/secrets/PluginSecretStore.ts::typed_capability_checks(eslint+review)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Not applicable for this plugin-only story; no shared client imports were added.
  - Evidence: `src/**/*.ts::no_shared_client_import_changes(code_review)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Obsidian secret API availability differs by environment | Capability checks + user-facing notices on unsupported operations |
| 2 | UI key input could accidentally imply plain persistence | Explicit copy clarifies keychain-only storage and save behavior |
| 3 | Delete API names differ (`deleteSecret` vs `removeSecret`) | Support both names and fallback to blank-value write |

---

## Implementation Order

1. `src/types.ts` — extend `SecretStoreContract` write/delete methods (covers A1).
2. `src/secrets/PluginSecretStore.ts` — implement save/delete operations with capability checks (covers A2).
3. `src/settings.ts` — add OpenAI key Save/Clear UI controls and keychain status display (covers B1).
4. `src/__tests__/setup/mockObsidianModule.ts` — support secret write/delete + settings buttons in test mock (covers B1).
5. `src/__tests__/unit/pluginSecretStore.test.ts` — validate happy path and unsupported fallback behavior (covers A2).
6. **Verify** — run `npm run test -- src/__tests__/unit/pluginSecretStore.test.ts`.
7. **Final verify** — run `npm run build` and `npm run lint`.

---

*Created: 2026-02-24 | Story: CFG-3 | Epic: Epic 6 — Settings, Secrets, and Configuration Guardrails*
