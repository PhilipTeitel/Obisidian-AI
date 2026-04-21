REVIEW SUMMARY: result=Pass TEST-critical=0 TEST-high=0 SEC-critical=0 SEC-high=0 REL-critical=0 REL-high=0 API-critical=0 API-high=0

# Story Review: CHAT-4 — User chat system prompt + vault-organization prompt

**Reviewed against:** `docs/features/CHAT-4.md`
**Date:** 2026-04-20
**Mode:** `/review-story`
**Gate result:** `Pass`

---

## Scope

- Story ID: CHAT-4
- Linked refined requirements (Sn IDs in scope): REQ-002 S1–S12 (per story Section 8a)
- Files in scope (from Section 7 intersected with `git diff`):
  - `src/core/domain/types.ts` — modified (`ChatRequestPayload`, `CHAT_GROUNDING_POLICY_WIRE_VERSION`, `BuildGroundedMessagesHooks`, `SidecarRequest` refactor)
  - `src/core/domain/groundingPolicy.ts` — created (canonical policy text)
  - `src/core/domain/chatUserPromptBudget.ts` — created (budget + clamp + fit helpers)
  - `src/core/workflows/ChatWorkflow.ts` — modified (`onUserPromptTruncation`, hooks)
  - `src/plugin/settings/types.ts` — modified
  - `src/plugin/settings/defaults.ts` — modified
  - `src/plugin/settings/SettingsTab.ts` — modified
  - `src/plugin/ui/ChatView.ts` — modified
  - `src/plugin/client/HttpTransportAdapter.ts` — modified (`Source` import fix)
  - `src/sidecar/adapters/chatProviderMessages.ts` — modified
  - `src/sidecar/runtime/SidecarRuntime.ts` — modified
  - `src/sidecar/stdio/stdioServer.ts` — modified (cast)
  - `scripts/verify-chat-prompt-transport.mjs` — created
  - `package.json` — modified (`check:chat-prompt-transport`)
  - `vitest.config.ts` — modified (include `chat-port.contract.ts`)
  - `tests/shims/obsidian.ts` — modified (Setting / App stubs for CHAT-4 tests)
  - Tests per Section 7 (CREATE) — all present and run
- Tests in scope (from Section 8a): cited test names in story Section 8 Evidence lines
- Adapters in scope (from Section 4b): `IChatPort` — contract + Ollama integration tests; no adapter source changes

### Out-of-plan changes

- `src/plugin/client/HttpTransportAdapter.ts` — fixes missing `Source` type import (required for `tsc`; story Section 7 did not list this file). **Recommendation:** add to Section 7 “Files to MODIFY” in a follow-up doc pass or accept as build-fix adjacent to CHAT-4 transport typing.

---

## Findings

### Test Coverage (`TEST-#`)

None.

### Reliability (`REL-#`)

None.

### Security (`SEC-#`)

None.

### API Contracts (`API-#`)

None.

---

## Required actions before QA

(None — gate Pass.)

---

## Notes

- `scripts/verify-chat-prompt-transport.mjs` greps for the plugin-only setting identifier `chatSystemPrompt` under `src/sidecar`. The wire field `vaultOrganizationPrompt` matches the settings field name per ADR-011, so it legitimately appears in sidecar payload forwarding and message assembly.
