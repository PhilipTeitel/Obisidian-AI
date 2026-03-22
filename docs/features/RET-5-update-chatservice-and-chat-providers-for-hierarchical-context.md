# RET-5: Update ChatService and chat providers for hierarchical context

**Story**: Update `ChatService`, `OpenAIChatProvider`, and `OllamaChatProvider` to support hierarchical context alongside the existing flat context format. Add `formatHierarchicalContext` as an alternative context formatting path.
**Epic**: Epic 14 — Three-Phase Hierarchical Retrieval
**Size**: Medium
**Status**: Complete

---

## 1. Summary

This story updates the chat pipeline to support hierarchical context from the three-phase retrieval system (R7). The `ChatRequest` type is extended with an optional `hierarchicalContext` field carrying `HierarchicalContextBlock[]`. Both `OpenAIChatProvider` and `OllamaChatProvider` are updated to prefer hierarchical context when available, falling back to the existing flat `ChatContextChunk[]` format.

The `formatHierarchicalContext` utility from RET-4 replaces the inline `formatContext` functions in both providers when hierarchical context is present. The existing flat context path is preserved for backward compatibility until the full hierarchical pipeline is wired in INTG stories.

Key design decisions:
- **Backward compatible**: The `context` field on `ChatRequest` is preserved. A new optional `hierarchicalContext` field is added.
- **Provider-level switching**: Each provider checks for `hierarchicalContext` first, falls back to `context`.
- **Shared formatter**: Both providers use `formatHierarchicalContext` from `src/utils/contextFormatter.ts`.
- **No ChatService changes needed yet**: The ChatService will be updated to use the full hierarchical pipeline in INTG stories. This story only ensures the providers can consume hierarchical context.

---

## 2. API Endpoints + Schemas

No HTTP/API endpoint changes. Type extension:

```ts
// Extended ChatRequest:
export interface ChatRequest {
  // ... existing fields ...
  context: ChatContextChunk[];
  hierarchicalContext?: HierarchicalContextBlock[];
}
```

---

## 3. Frontend Flow

No frontend components modified.

---

## 4. File Touchpoints

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/types.ts` | Add optional `hierarchicalContext` field to `ChatRequest` |
| 2 | `src/providers/chat/OpenAIChatProvider.ts` | Import and use `formatHierarchicalContext` when `hierarchicalContext` is present |
| 3 | `src/providers/chat/OllamaChatProvider.ts` | Import and use `formatHierarchicalContext` when `hierarchicalContext` is present |

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/__tests__/unit/chatProviderHierarchicalContext.test.ts` | Tests for hierarchical context formatting in both providers |

---

## 5. Acceptance Criteria Checklist

### Phase A: Type Extension

- [x] **A1** — `ChatRequest` includes optional `hierarchicalContext` field
  - The field is typed as `HierarchicalContextBlock[]` and is optional.
  - Evidence: `src/__tests__/unit/chatProviderHierarchicalContext.test.ts::A1_type_extension(vitest)`

### Phase B: OpenAI Provider

- [x] **B1** — `OpenAIChatProvider` uses `formatHierarchicalContext` when `hierarchicalContext` is present
  - The system message uses hierarchical formatting instead of flat formatting.
  - Evidence: `src/__tests__/unit/chatProviderHierarchicalContext.test.ts::B1_openai_hierarchical(vitest)`

- [x] **B2** — `OpenAIChatProvider` falls back to flat context when `hierarchicalContext` is absent
  - Existing behavior is preserved.
  - Evidence: `src/__tests__/unit/chatProviderHierarchicalContext.test.ts::B2_openai_flat_fallback(vitest)`

### Phase C: Ollama Provider

- [x] **C1** — `OllamaChatProvider` uses `formatHierarchicalContext` when `hierarchicalContext` is present
  - Evidence: `src/__tests__/unit/chatProviderHierarchicalContext.test.ts::C1_ollama_hierarchical(vitest)`

- [x] **C2** — `OllamaChatProvider` falls back to flat context when `hierarchicalContext` is absent
  - Evidence: `src/__tests__/unit/chatProviderHierarchicalContext.test.ts::C2_ollama_flat_fallback(vitest)`

### Phase D: Shared Formatter Integration

- [x] **D1** — Both providers produce identical context messages for the same hierarchical input
  - Evidence: `src/__tests__/unit/chatProviderHierarchicalContext.test.ts::D1_consistent_formatting(vitest)`

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes
- [x] **Z2** — `npm run lint` passes (or only pre-existing warnings)
- [x] **Z3** — No `any` types
- [x] **Z4** — All existing tests continue to pass

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Adding a field to `ChatRequest` could break existing callers | Field is optional; existing code continues to work |
| 2 | Two context formats in parallel adds complexity | Temporary — flat format will be deprecated once INTG stories wire the full pipeline |

---

*Created: 2026-03-22 | Story: RET-5 | Epic: Epic 14 — Three-Phase Hierarchical Retrieval*
