# ADR-005: Pluggable embedding and chat providers

## Status

Accepted

## Context

Users need **configurable** endpoints and models. **Secrets** (API keys) must live in **Obsidian’s secret store**. MVP targets **OpenAI** and **Ollama**; additional vendors are **out of scope for MVP** but likely later.

Hard-coding a single vendor blocks experimentation (local vs cloud) and complicates testing.

## Decision

1. **Provider interfaces:** The core plugin logic depends on **narrow contracts** for **embeddings** and **chat** (streaming as required by the product), not on a single vendor SDK sprinkled through services.

2. **Registry or factory:** Providers are **registered** by id/type with **runtime configuration** (base URL, model id, timeouts), while **secrets** are resolved via Obsidian’s **secret store** for keys that must not live in plain settings.

3. **MVP providers:** Ship or plan **OpenAI** and **Ollama** implementations behind the abstraction. Adding another vendor should be **additive** (new provider module + registration), not a rewrite of indexing/search/chat orchestration.

4. **Model configuration:** Distinct settings for **embedding model** and **chat model** (and related parameters such as timeouts) remain **user-visible** and validated where feasible.

## Consequences

- **Positive:** Testability (mocks/fakes), user choice, fewer merge conflicts when adding providers.
- **Negative:** Indirection and mapping work; error messages must remain actionable across providers.

## Alternatives considered

- **Direct OpenAI SDK calls everywhere:** Fastest first version, expensive to unwind when adding Ollama or others.
- **One “mega provider” class with switches:** Becomes brittle; testing suffers.

## References

- [../requirements/REQUIREMENTS.md](../requirements/REQUIREMENTS.md) §6–7
- [ADR-004-per-vault-index-storage.md](./ADR-004-per-vault-index-storage.md) (secrets and settings boundaries)
