# PLG-4: Settings tab — providers, paths, transport, budgets, queue

**Story**: Obsidian **settings tab** mirroring [README Plugin Settings](../../README.md#plugin-settings): embedding/chat provider fields, folders, **`dbPath`**, **`transport`**, **`logLevel`**, search/chat budgets, **`queueConcurrency`**, **`maxRetries`**, **`embeddingDimension`**, **`chatTimeout`**.
**Epic**: 8 — Plugin client, settings, secrets, and vault I/O
**Size**: Medium
**Status**: Complete

---

## 1. Summary

Persist via `Plugin.loadData` / `saveData`. Changing transport requires sidecar restart (PLG-1).

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                     | Why it binds this story                    |
| ------------------------------------------------------- | ------------------------------------------ |
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md) | Transport and provider config at boundary. |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs **Accepted**
- [x] README settings table matches persisted fields
- [x] Section 4 filled
- [x] Phase Y non-mock evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — Default values match README defaults.
2. **Y2** — **`embeddingDimension`** is positive integer (1536 default).

---

## 5. API Endpoints + Schemas

```ts
export interface ObsidianAISettings {
  embeddingProvider: 'openai' | 'ollama';
  embeddingModel: string;
  embeddingBaseUrl: string;
  chatProvider: 'openai' | 'ollama';
  chatModel: string;
  chatBaseUrl: string;
  chatTimeout: number;
  indexedFolders: string[];
  excludedFolders: string[];
  agentOutputFolders: string[];
  maxGeneratedNoteSize: number;
  dbPath: string;
  transport: 'stdio' | 'http';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  searchResultCount: number;
  matchedContentBudget: number;
  siblingContextBudget: number;
  parentSummaryBudget: number;
  queueConcurrency: number;
  maxRetries: number;
  embeddingDimension: number;
}
```

---

## 6. Frontend Flow

### 6a

```
SettingsTab → Plugin.saveSettings()
```

### 6b

| Component            | Props  | Notes                    |
| -------------------- | ------ | ------------------------ |
| ObsidianAISettingTab | plugin | extends PluginSettingTab |

### 6c

(n/a)

---

## 7. File Touchpoints

| #   | Path                                 | Purpose              |
| --- | ------------------------------------ | -------------------- |
| 1   | `src/plugin/settings/types.ts`       | `ObsidianAISettings` |
| 2   | `src/plugin/settings/defaults.ts`    | README defaults      |
| 3   | `src/plugin/settings/SettingsTab.ts` | UI                   |

---

## 8. Acceptance Criteria Checklist

### Phase A

- [x] **A1** — `DEFAULT_SETTINGS` matches README numeric/string defaults (spot-check 5 keys in test).
  - Evidence: `tests/plugin/settings/defaults.test.ts::A1_readme_defaults(vitest)`

### Phase Y

- [x] **Y1** — **(binding)** Settings interface includes `transport` and `dbPath`.
  - Evidence: `rg "transport" src/plugin/settings/types.ts`

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — No `any`
- [x] **Z4** — **N/A**
- [x] **Z5** — N/A

---

## 9. Risks & Tradeoffs

| #   | Risk            | Mitigation             |
| --- | --------------- | ---------------------- |
| 1   | Too many fields | Group sections in tab. |

---

## Implementation Order

1. types + defaults + test
2. SettingsTab
3. main registers tab

---

_Created: 2026-04-05 | Story: PLG-4 | Epic: 8_
