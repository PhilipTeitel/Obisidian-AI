# ADR-010: Structured logging for the Node.js sidecar

**Status:** Accepted  
**Date:** 2026-04-05

---

## Context

The sidecar runs heavy pipelines (indexing, search, chat orchestration) and must support operations debugging without leaking secrets or note bodies. [README §20 — Logging and Observability](../README.md#20-logging-and-observability) calls for structured JSON logs, correlation IDs (`runId`, `jobId`), standard levels, and redaction of API keys and content.

The plugin uses Obsidian’s console; the sidecar is a separate Node process and needs a **named** server-side logger.

---

## Decision

1. **Library:** Use **Pino** (`pino`) as the structured logger for all code under `src/sidecar/**`.
2. **Format:** Production-style JSON logs to **stderr** (keep **stdout** reserved for stdio transport NDJSON in SRV-1).
3. **Levels:** `debug`, `info`, `warn`, `error`; default **`info`**. Sidecar reads default level from env **`OBSIDIAN_AI_LOG_LEVEL`** (plugin maps [README Plugin Settings](../README.md#plugin-settings) `logLevel` when spawning).
4. **Correlation:** Loggers use `logger.child({ runId, jobId, scope })` for indexing and chat operations where those IDs exist.
5. **Redaction:** Do not log `apiKey`, raw note `content`, or full embedding vectors. Paths may appear at `debug` only (per README §20).

---

## Consequences

**Positive**

- Fast, ecosystem-standard JSON logging; `pino-pretty` optional for local dev.
- Clear separation: stderr logs vs stdout protocol.

**Negative / costs**

- Extra dependency in root `package.json`.
- Implementers must avoid `console.log` in sidecar production paths where logs should be structured (prefer `logger`).

---

## Alternatives considered

| Alternative | Why not chosen |
|-------------|----------------|
| `winston` | README prefers Pino for Node sidecar; Pino is lighter for JSON-first use. |
| `console.log` only | No levels/child fields; hard to redact consistently. |

---

## Explicit non-decisions

- This ADR does not mandate a specific **plugin-side** logger implementation beyond README’s “lightweight custom logger” guidance.
- This ADR does not require log shipping to external aggregators.

---

## Links

- Requirements: [docs/requirements/REQUIREMENTS.md](../requirements/REQUIREMENTS.md) (observability themes)
- Related README section: [§20 Logging and Observability](../README.md#20-logging-and-observability)
- Related stories: SRV-4

---

## File naming

`docs/decisions/ADR-010-structured-logging-sidecar.md`
