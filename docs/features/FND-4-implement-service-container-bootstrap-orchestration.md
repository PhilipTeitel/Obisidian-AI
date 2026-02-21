# FND-4: Implement service container/bootstrap orchestration

**Story**: Introduce a deterministic runtime service container and bootstrap path that wires core service dependencies once, exposes them to plugin entrypoints, and disposes them safely on unload.
**Epic**: Epic 1 — Plugin Foundation and Runtime Shell
**Size**: Medium
**Status**: Done

---

## 1. Summary

This story establishes the runtime composition root for the plugin. The current plugin shell registers views, commands, and settings, but service construction is still implicit and command callbacks are hardcoded placeholders. FND-4 adds an explicit service container and bootstrap orchestration so all future runtime behavior (indexing, search, chat, provider lookup, and guarded file writes) is instantiated in one predictable place.

The story is a critical dependency for Epics 2-6 because those stories introduce concrete services and providers that depend on each other. Without a shared composition boundary, each story risks duplicating setup logic in `main.ts` and creating inconsistent initialization order. With FND-4 complete, later stories can implement service internals behind stable constructor contracts while preserving plugin lifecycle behavior.

The guiding constraint is deterministic and testable construction order. Startup must stay lightweight (`onload()` still performs no heavy indexing/provider work), but dependency wiring must be explicit, observable in tests, and paired with a clear teardown path to prevent stale runtime resources across plugin reloads.

---

## 2. API Endpoints + Schemas

No external API endpoint changes are needed for this story.

This project is an Obsidian plugin with internal service contracts, not a REST service. There is no `shared/types.ts` module in this repository; NEW or CHANGED runtime bootstrap contracts should be added to `src/types.ts` (or a dedicated runtime-contract file re-exported from there).

```ts
export interface RuntimeServiceLifecycle {
  init(): Promise<void>;
  dispose(): Promise<void>;
}

export interface RuntimeBootstrapContext {
  app: App;
  plugin: Plugin;
  getSettings: () => ObsidianAISettings;
  notify: (message: string) => void;
}

export interface RuntimeServices {
  indexingService: IndexingService;
  embeddingService: EmbeddingService;
  searchService: SearchService;
  chatService: ChatService;
  agentService: AgentService;
  providerRegistry: ProviderRegistry;
  dispose(): Promise<void>;
}

export interface RuntimeBootstrapResult {
  services: RuntimeServices;
  initializationOrder: string[];
}
```

---

## 3. Frontend Flow

### 3a. Component / Data Hierarchy

```
ObsidianAIPlugin (src/main.ts)
├── onload()
│   ├── loadSettings()
│   ├── bootstrapRuntimeServices(context)
│   │   ├── create ProviderRegistry
│   │   ├── create EmbeddingService
│   │   ├── create SearchService
│   │   ├── create AgentService
│   │   ├── create ChatService
│   │   └── create IndexingService
│   ├── register views/commands/settings
│   └── wire command callbacks to container services
└── onunload()
    ├── detach view leaves
    ├── dispose progress slideout
    └── dispose runtime services in reverse-safe order
```

### 3b. Props & Contracts

| Component / Hook | Props / Signature | State | Notes |
|------------------|-------------------|-------|-------|
| `bootstrapRuntimeServices` | `(context: RuntimeBootstrapContext) => Promise<RuntimeBootstrapResult>` | Initialization trace + constructed services | Single composition root for runtime dependency wiring |
| `RuntimeServices` container | Structured object exposing core services + `dispose()` | Ready / disposed | No direct `new Service()` calls in `main.ts` outside bootstrap |
| `ObsidianAIPlugin.onload` | `async onload(): Promise<void>` | Plugin lifecycle state | Calls bootstrap first, then registers command/view/settings shells |
| `ObsidianAIPlugin.onunload` | `async onunload(): Promise<void>` | Teardown path | Always disposes runtime container, even if command handlers were never invoked |
| Command callbacks | Existing command IDs wired to service methods | Placeholder behavior until downstream stories | Keeps FND-2 UX shell while routing through container seams |

### 3c. States (Loading / Error / Empty / Success)

| State   | UI Behavior |
|---------|-------------|
| Loading | Plugin startup runs lightweight bootstrap wiring and keeps placeholder view/command surfaces available |
| Error   | Bootstrap failure is surfaced via notice/log and prevents partial runtime state from lingering |
| Empty   | Services may return placeholder "not implemented" results but are resolved through container contracts |
| Success | Plugin loads with initialized service container and deterministic teardown on plugin unload |

---

## 4. File Touchpoints

### Files to CREATE

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/bootstrap/bootstrapRuntimeServices.ts` | Define explicit service construction order and return runtime container result |
| 2 | `src/services/ServiceContainer.ts` | Define container shape, lifecycle handling, and disposal orchestration |
| 3 | `src/services/IndexingService.ts` | Add service shell class/interface with constructor dependency contract |
| 4 | `src/services/EmbeddingService.ts` | Add service shell class/interface for embedding orchestration contract |
| 5 | `src/services/SearchService.ts` | Add service shell class/interface for semantic search contract |
| 6 | `src/services/ChatService.ts` | Add service shell class/interface for chat orchestration contract |
| 7 | `src/services/AgentService.ts` | Add service shell class/interface for guarded file-write contract |
| 8 | `src/providers/ProviderRegistry.ts` | Add provider lookup shell contract used by service container |

### Files to MODIFY

| # | Path | Change |
|---|------|--------|
| 1 | `src/main.ts` | Replace ad-hoc placeholder command internals with container-backed service invocation seams; wire bootstrap and teardown |
| 2 | `src/types.ts` | Add runtime bootstrap/container lifecycle types (or re-export aliases) used by plugin and tests |
| 3 | `src/settings.ts` | Ensure runtime bootstrap context can read current settings without introducing side effects |
| 4 | `src/__tests__/smoke.test.ts` | Add construction-order and disposal-sequence assertions for bootstrap/container behavior |

### Files UNCHANGED (confirm no modifications needed)

- `src/ui/SearchView.ts` — still a shell view in this story; search rendering behavior belongs to SRCH stories
- `src/ui/ChatView.ts` — still a shell view in this story; streaming chat UI belongs to CHAT stories
- `src/ui/ProgressSlideout.ts` — existing shell can remain while service-driven progress updates are implemented later
- `README.md` architecture narrative sections — no architecture rewrite required beyond backlog link update

---

## 5. Acceptance Criteria Checklist

### Phase A: Runtime Contracts and Container Shape

- [x] **A1** — Runtime bootstrap contracts are explicitly typed
  - `RuntimeBootstrapContext`, `RuntimeServices`, and lifecycle/disposal contracts exist and are exported from shared runtime types.
  - No `any` types are used for container dependencies or service factory signatures.

- [x] **A2** — Service dependency seams are constructor-based and explicit
  - Each core service shell defines constructor inputs for its required collaborators (registry/settings/store/etc.).
  - Dependency direction is one-way and avoids circular `new` calls across service modules.

### Phase B: Deterministic Bootstrap Orchestration

- [x] **B1** — A single composition root builds runtime services in fixed order
  - `bootstrapRuntimeServices` constructs services in a documented sequence aligned with architecture dependencies.
  - Bootstrap returns an initialization trace (or equivalent observable signal) that can be asserted in tests.

- [x] **B2** — Container teardown is centralized and safe
  - Container exposes one `dispose()` path that releases services/resources without throwing uncaught errors.
  - Teardown order is deterministic and resilient when some services are still placeholders.

### Phase C: Plugin Lifecycle Integration

- [x] **C1** — `main.ts` delegates runtime wiring to bootstrap module
  - `onload()` no longer manually assembles service dependencies inline.
  - Existing commands remain registered with current IDs/names and route through service container entrypoints.

- [x] **C2** — Startup remains lightweight and non-blocking
  - Bootstrap performs wiring only; it does not trigger indexing jobs, provider API calls, or vector DB scans during plugin load.
  - User-visible behavior from FND-2 shell remains stable (notices/placeholders allowed where business logic is not yet implemented).

- [x] **C3** — Unload always disposes runtime container
  - `onunload()` calls container teardown even after partial startup/failed command execution paths.
  - View detachment and progress slideout disposal still execute reliably.

### Phase D: Testability and Regression Safety

- [x] **D1** — Construction order is unit/smoke tested
  - Tests assert expected bootstrap order and fail if service instantiation order changes unexpectedly.
  - Tests verify no duplicate service instances are created for a single plugin runtime.

- [x] **D2** — Disposal path is unit/smoke tested
  - Tests confirm `dispose()` runs once and handles service-level teardown failures without aborting remaining cleanup.
  - Tests verify unload-time cleanup remains idempotent.

### Phase Z: Quality Gates

- [x] **Z1** — `npm run build` passes with zero TypeScript errors in all workspaces
- [x] **Z2** — `npm run lint` passes (or only has pre-existing warnings)
- [x] **Z3** — No `any` types in any new or modified file
- [x] **Z4** — All client imports from shared use `@shared/types` alias (not relative paths)

---

## 6. Risks & Tradeoffs

| # | Risk / Tradeoff | Mitigation |
|---|-----------------|------------|
| 1 | Over-designing container abstractions can slow delivery of functional service stories | Keep interfaces minimal and focused on composition/lifecycle concerns only |
| 2 | Incorrect construction order can create hidden runtime failures once concrete services land | Encode the order in one bootstrap module and lock it with tests |
| 3 | Teardown omissions can cause stale state between plugin reloads | Centralize disposal and require unload-path test coverage |
| 4 | Placeholder service shells may drift from later real implementations | Keep shell method signatures aligned to README internal API contracts and update in subsequent story plans as needed |

---

## Implementation Order

1. `src/types.ts` — add runtime bootstrap/container lifecycle contracts used by composition code and tests (covers A1, A2).
2. `src/services/*.ts` and `src/providers/ProviderRegistry.ts` — introduce service/registry shell classes with explicit constructor dependency seams (covers A2).
3. `src/services/ServiceContainer.ts` — implement container object and unified disposal behavior (covers B2, D2).
4. `src/bootstrap/bootstrapRuntimeServices.ts` — implement deterministic construction sequence and initialization trace output (covers B1, D1).
5. `src/main.ts` — integrate bootstrap call in `onload()`, wire command callbacks through container services, and call container dispose in `onunload()` (covers C1, C2, C3).
6. `src/__tests__/smoke.test.ts` — add bootstrap order and teardown idempotency assertions (covers D1, D2).
7. **Verify** — run `npm run build`, `npm run lint`, `npm run typecheck`, and `npm run test` to validate runtime wiring and type safety (covers Z1, Z2, Z3).
8. **Final verify** — manually enable/disable plugin in an Obsidian test vault to confirm no lifecycle regressions and stable shell behavior (covers C2, C3, Phase Z).

---

*Created: 2026-02-21 | Story: FND-4 | Epic: Epic 1 — Plugin Foundation and Runtime Shell*
