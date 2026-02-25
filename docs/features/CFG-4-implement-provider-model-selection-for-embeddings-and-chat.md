# CFG-4: Implement provider/model selection for embeddings and chat

**Story**: Provide complete settings controls for selecting embedding/chat providers and model names so OpenAI and Ollama can be configured without code changes.
**Epic**: Epic 6 — Settings, Secrets, and Configuration Guardrails
**Size**: Small
**Status**: Done

---

## 1. Summary

CFG-4 completes provider/model configurability by adding explicit UI controls for embedding provider, chat provider, embedding model, and chat model. Users can now configure both provider choice and model IDs through settings rather than relying on defaults.

The story also includes endpoint controls for OpenAI and Ollama base URLs, keeping model/provider selection aligned with transport configuration in one place. Runtime services already consume these settings, so this story focuses on robust configuration experience and persistence.

The key constraint is MVP provider scope: only `openai` and `ollama` are selectable from UI, with safe fallback behavior on invalid persisted IDs.

---

## 2. API Endpoints + Schemas

No external API endpoint changes are needed for this story.

No new public schema types are required; provider/model fields already exist in `ObsidianAISettings`.

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
ObsidianAISettingTab.display()
├── Embedding provider dropdown
├── Embedding model input
├── Chat provider dropdown
├── Chat model input
├── OpenAI endpoint input
└── Ollama endpoint input
    └── plugin.saveSettings() -> normalized persisted settings
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `MVP_PROVIDER_IDS` | `readonly ["openai", "ollama"]` | Static | Bounds selectable providers for MVP |
| `toKnownProviderId` | `(value: string) => MVPProviderId` | Stateless/pure | Coerces unknown provider IDs to safe fallback |
| Settings text fields | model/endpoint strings | Plugin settings state | Persisted through normalized save pipeline |

### 3c. States (Loading / Error / Empty / Success)

| State | UI Behavior |
|-------|-------------|
| Loading | Provider/model/endpoint values render from current settings snapshot |
| Error | Invalid provider IDs fall back to known options via normalization |
| Empty | Empty model/endpoint values are normalized back to defaults on save |
| Success | Runtime consumes user-selected provider/model/endpoint values |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/settingsSchema.test.ts` | Validate provider/model/endpoint normalization behavior |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/settings.ts` | Add model + endpoint controls and update provider control copy |
| 2 | `src/settingsSchema.ts` | Normalize invalid provider/model/endpoint values |
| 3 | `src/main.ts` | Persist normalized provider/model/endpoint settings |

### Files UNCHANGED (confirm no modifications needed)

- `src/providers/ProviderRegistry.ts` — registry selection behavior remains unchanged
- `src/services/EmbeddingService.ts` — continues reading configured model/provider
- `src/ui/ChatPaneModel.ts` — continues reading configured chat model/provider

---

## 5. Acceptance Criteria Checklist

### Phase A: Provider + Model Controls

- [x] **A1** — Settings UI exposes provider selection for embeddings and chat
  - Both provider dropdowns use MVP provider list and persist on change.
  - Evidence: `src/settings.ts::embedding_chat_provider_dropdowns(code_review)`

- [x] **A2** — Settings UI exposes model inputs for embeddings and chat
  - Embedding and chat model fields are independently editable.
  - Evidence: `src/settings.ts::embedding_chat_model_inputs(code_review)`

### Phase B: Endpoint + Validation

- [x] **B1** — OpenAI and Ollama endpoints are configurable from settings
  - Endpoint controls persist through plugin save path.
  - Evidence: `src/settings.ts::openai_ollama_endpoint_inputs(code_review)`

- [x] **B2** — Invalid provider/model/endpoint values are normalized safely
  - Unknown provider IDs and empty strings are coerced to defaults.
  - Evidence: `src/__tests__/unit/settingsSchema.test.ts::normalizes_invalid_and_empty_values_using_defaults(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
  - Evidence: `package.json::scripts.build(npm run build)`
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
  - Evidence: `package.json::scripts.lint(npm run lint)`
- [x] **Z3** — No `any` types in any new or modified file
  - Evidence: `src/settings.ts::typed_provider_model_settings(eslint+review)`
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)
  - Not applicable for this plugin-only story; no shared client imports were added.
  - Evidence: `src/**/*.ts::no_shared_client_import_changes(code_review)`

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Users can enter model names unsupported by provider runtime | Preserve flexibility and rely on provider runtime errors for unsupported models |
| 2 | Endpoint misconfiguration can break provider calls | Keep endpoint controls explicit with defaults and normalization fallback |
| 3 | Future providers may need richer config than dropdown + model string | Maintain provider abstraction and MVP-scoped list for now |

---

## Implementation Order

1. `src/settings.ts` — add model/endpoint controls and finalize provider dropdown behavior (covers A1, A2, B1).
2. `src/settingsSchema.ts` — enforce provider/model/endpoint normalization defaults (covers B2).
3. `src/main.ts` — persist normalized provider/model/endpoint values in settings envelope (covers B1, B2).
4. `src/__tests__/unit/settingsSchema.test.ts` — verify invalid provider/model/endpoint coercion (covers B2).
5. **Verify** — run `npm run test -- src/__tests__/unit/settingsSchema.test.ts`.
6. **Final verify** — run `npm run build` and `npm run lint`.

---

*Created: 2026-02-24 | Story: CFG-4 | Epic: Epic 6 — Settings, Secrets, and Configuration Guardrails*
