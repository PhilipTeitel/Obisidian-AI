# PLG-5: `SecretStorage` — per-request API keys

**Story**: Read OpenAI (or other) API keys from **`app.keychain` / `loadSecret` / `saveSecret`** (Obsidian **SecretStorage** API) and pass **`apiKey`** only on outbound sidecar messages — **never** persist keys in `data.json` or sidecar env.
**Epic**: 8 — Plugin client, settings, secrets, and vault I/O
**Size**: Small
**Status**: Complete

---

## 1. Summary

ADR-006 §5: sidecar never stores secrets. Plugin uses `this.app.saveSecret` / `loadSecret` with stable keys e.g. `obsidian-ai-openai-key`.

---

## 2. Linked architecture decisions (ADRs)

| ADR                                                     | Why it binds this story |
| ------------------------------------------------------- | ----------------------- |
| [ADR-006](../decisions/ADR-006-sidecar-architecture.md) | Secrets in plugin only. |

---

## 3. Definition of Ready (DoR)

- [x] Linked ADRs **Accepted**
- [x] Section 4 filled
- [x] Phase Y non-mock evidence

---

## 4. Binding constraints (non-negotiable)

1. **Y1** — No `apiKey` field in **`ObsidianAISettings`** / `data.json`.
2. **Y2** — Optional password fields in settings UI write via **`saveSecret`** only.

---

## 5. API Endpoints + Schemas

(n/a)

---

## 6. Frontend Flow

Settings: masked inputs calling `saveSecret` on change; optional clear.

---

## 7. File Touchpoints

| #   | Path                                    | Purpose           |
| --- | --------------------------------------- | ----------------- |
| 1   | `src/plugin/settings/secretSettings.ts` | load/save helpers |
| 2   | `src/plugin/settings/SettingsTab.ts`    | secret inputs     |

---

## 8. Acceptance Criteria Checklist

### Phase A

- [x] **A1** — Helper `getOpenAIApiKey(app): Promise<string | undefined>` uses `loadSecret`.
  - Evidence: `tests/plugin/settings/secretSettings.test.ts::A1_uses_loadSecret(vitest)` with mock App

### Phase Y

- [x] **Y1** — **(binding)** `rg "apiKey" src/plugin/settings/types.ts` exits **1**.
  - Evidence: `rg "apiKey" src/plugin/settings/types.ts` → no match

### Phase Z

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes
- [x] **Z3** — No `any`
- [x] **Z4** — **N/A**
- [x] **Z5** — N/A

---

## 9. Risks & Tradeoffs

| #   | Risk                  | Mitigation                           |
| --- | --------------------- | ------------------------------------ |
| 1   | Obsidian API variance | Use `loadSecret` from Obsidian 1.2+. |

---

## Implementation Order

1. secretSettings.ts + test
2. Wire settings tab + transport payloads in later PLG wiring

---

_Created: 2026-04-05 | Story: PLG-5 | Epic: 8_
