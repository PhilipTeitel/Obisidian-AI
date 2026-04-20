# Obsidian AI — Product and Technical Requirements (Iteration 2)

This document rolls up the intent of prior scoping and prompt documents into a single canonical requirements baseline. It states **what** the product must do and **constraints** it must satisfy; it does not prescribe a specific code layout or UI design.

**Iteration 2 note:** This revision incorporates lessons from iteration 1 (the `force-wasm` branch). The WASM-in-renderer approach for SQLite+sqlite-vec proved fragile under Obsidian's Electron constraints. Iteration 2 introduces a sidecar architecture, ports-and-adapters (hexagonal) domain design, and queue-based indexing orchestration. Sections updated from iteration 1 are annotated with **(iter-2)**.

---

## 1. Goals and MVP success criteria

**Primary**

- Users can **semantically search** their vault (find notes by meaning, not only keywords).
- Users can use **chat completions** grounded in vault content.

**Secondary**

- **Indexed data** (notes, embeddings, vector index) stays **local** on the user's machine.
- **Chat** may use remote or local models; **connection details** (endpoints, API keys, model names) are **configurable**.

**MVP success criteria**

- Users can **find notes by meaning** via semantic search.
- **Chat answers use only the vault as knowledge** for retrieval context (no general web or external knowledge bases in the retrieval path for answering about the user's notes).
- **Vault-only grounding is enforced, not conditional.** When retrieval returns no usable context, chat must respond with an explicit **insufficient-evidence** message (describing what was searched and suggesting how to narrow the query). The model must not fall back to general knowledge, instruct the user to paste their notes, or otherwise answer from outside the vault. See [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md).

---

## 2. Privacy and data locality

- **Raw note content** must not be sent to external **indexing** or **embedding-as-a-service** platforms that store user content on behalf of the product; **embeddings and the vector index** are **local** to the machine (or explicitly under user control per storage ADR).
- **API keys and secrets** must use **Obsidian's secret store**, not plain-text config files. The plugin holds secrets and passes them to the sidecar per-request; the sidecar never persists secrets. **(iter-2)**
- **Vault isolation:** Index data for one vault must **not** be mixed with another vault's index (see storage requirements).
- **Obsidian integration:** Heavy or frequent persistence should **not** rely on Obsidian's generic plugin JSON persistence for bulk index data (performance, watcher noise); **small** settings and non-bulk state may use normal plugin data mechanisms.
- **Sidecar privacy:** The sidecar process communicates with the plugin over a private channel (stdio IPC by default). When HTTP transport is used, the sidecar binds only to `127.0.0.1` with a random port and requires a per-session auth token on all requests. **(iter-2)**

---

## 3. Functional requirements — UI and commands

**Panes**

- A **semantic search** pane.
- A **chat** pane.
- **Progress feedback** for long-running work (e.g. indexing, embedding, summary generation) via a **slideout** or equivalent non-blocking UI. Progress is streamed from the sidecar to the plugin in real-time. **(iter-2)**

**Minimum command set**

- **Reindex vault** — full reindex.
- **Index changes** — incremental index of changes since last run.
- **Semantic search selection** — user selects text in a note and runs semantic search seeded by that selection.
- **Open semantic search pane** — opens or reveals the search pane without running a search.
- **Open chat pane** — opens or reveals the chat pane without starting a completion.

Commands should be **discoverable** in the command palette and **reuse** a single pane instance when one already exists (no duplicate panes for the same view type).

---

## 4. Functional requirements — indexing and search

- Notes are indexed with **structure and context** preserved (not as a single opaque blob per file).
- **Minimum structural metadata** to retain includes: note identity, headings, paragraphs/bullets, and **tags** (frontmatter and inline as applicable).
- **Scope:** User can configure **which folders** are included or excluded from indexing.
- **Semantic search** returns results that support **opening the relevant note** (and ideally navigating toward the relevant section where the product model allows it).
- **Scale:** Indexing and search remain usable for vaults on the order of **hundreds to thousands** of notes ("works at that scale" is sufficient for MVP).
- **Vault file access:** The plugin reads vault files via the Obsidian API and sends content to the sidecar for processing. The sidecar does not access the vault filesystem directly. **(iter-2)**
- **Idempotent indexing:** Each note's indexing progress is tracked per-step in a state machine (queued → parsing → storing → summarizing → embedding → done). On crash or restart, incomplete jobs resume from the last completed step rather than restarting from scratch. **(iter-2)**
- **Queue-based orchestration:** Indexing work items are managed through a queue abstraction. The iteration 2 implementation uses an in-process queue with SQLite-backed crash recovery. The abstraction supports future replacement with external queues (RabbitMQ, SQS) without domain logic changes. **(iter-2)**

---

## 5. Hierarchical indexing and retrieval (behavioral)

Flat chunking of notes into tiny isolated snippets is **insufficient**: search and chat must receive **structured, contextual** excerpts that reflect how the note is written.

**Document model**

- The indexer produces a **hierarchical tree** per note (e.g. note → topic/subtopic → paragraph / bullet groups / bullets), not a single flat list of unrelated fragments.
- **Node types** and **parent/child** relationships, **heading trails**, **ordering** within siblings, and **full text** for nodes (not arbitrary truncation that drops structure) are required at the behavioral level.
- **Paragraphs** that exceed embedding limits are split on **sentence boundaries**, with a way to **reassemble** order under the same parent.
- **Bullet groups** (consecutive bullets without a blank line) and **nested bullets** are modeled so retrieval can use both group-level and bullet-level granularity.

**Summaries and embeddings**

- **LLM-generated summaries** for non-leaf nodes are produced **bottom-up** and **re-generated** when content changes, propagating toward the root so parent summaries do not stay stale after child edits.
- **Summary** and **content** vectors for retrieval must be **comparable** (same embedding model / space).
- **Cost control:** Skip redundant summary work when a note's content hash is unchanged (incremental indexing).
- **Structured note/topic summaries (iter-2):** `note` and `topic`/`subtopic` summaries must be **breadth-preserving** (not free 2–4-sentence prose). The summary prompt produces a bounded structured rubric covering the topics discussed, named entities, dates/time references, actions/decisions, and tags in that subtree, so coarse retrieval can hit entity- and date-specific queries without relying on dense prose. See [ADR-013](../decisions/ADR-013-structured-note-summaries.md). **(iter-2)**
- **Selective summary embeddings (iter-2):** Nodes that add no semantic signal beyond their already-embedded children (e.g. `bullet_group` whose signal is fully represented by its `bullet` leaves) are **not** required to produce a summary vector. This trims the summary-embedding corpus and reduces noise in the coarse phase. See [ADR-002](../decisions/ADR-002-hierarchical-document-model.md) and [ADR-013](../decisions/ADR-013-structured-note-summaries.md). **(iter-2)**

**Retrieval phases**

1. **Coarse:** Query embedding matched primarily against **summary** embeddings to find candidate regions. The number of candidates retained at this phase must be **configurable** (`chatCoarseK` / equivalent setting); a hard cap of 8 is **not** acceptable — see [ADR-012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md). **(iter-2)**
2. **Fine:** **Drill down** within candidates using **content** embeddings (including recursive descent as needed).
3. **Assembly:** Build **structured context** for the chat (and search display) by walking ancestors/siblings with **token budgets** per tier (matched content, sibling context, parent summaries), preserving headings and list structure in the text sent to the LLM.

**Hybrid retrieval (iter-2)**

- Retrieval must support **hybrid recall**: combining vector search over summary/content embeddings with keyword/BM25 search over node content (SQLite FTS5). Results are merged via a documented fusion strategy (e.g. reciprocal rank fusion). Hybrid recall is toggleable by the user. See [ADR-012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md). **(iter-2)**
- **Content-only fallback:** When the coarse phase returns zero or too few candidates relative to a configurable floor, retrieval must fall back to an **unrestricted content-vector ANN** (no subtree filter) so recall does not collapse when summaries failed to match. **(iter-2)**

**Tags and cross-references**

- Tags are tracked at **scopes** consistent with the hierarchy so users can reason about "this topic vs that topic."
- **Wikilinks** (and similar explicit references) are tracked to allow **related context** to be pulled in when useful.
- **Temporal and path filters (iter-2):** `SearchRequest` must accept optional **path globs** (e.g. `Daily/**/*.md`) and **date ranges** (ISO start/end). For daily-note vaults, filenames of the form `YYYY-MM-DD.md` are parsed into dates so users (or workflows on their behalf) can restrict retrieval to "the last two weeks of daily notes" without model-side heuristics. Filters are pushed down to SQLite before ANN scoring where possible. See [ADR-014](../decisions/ADR-014-temporal-and-path-filters.md). **(iter-2)**

**User-facing documentation**

- Provide an **authoring-oriented** guide that explains how headings, bullets, tags, and links affect indexing and retrieval (so users can write notes that work well with the system).

---

## 6. Functional requirements — chat and agent

- **Chat** uses retrieval from the hierarchical index to supply **vault-only** context for answering (plus conversation history within a session as configured).
- **Grounding policy (non-optional):** Every chat request must carry a **built-in grounding system message** directing the model to answer only from provided vault context and to emit an **insufficient-evidence response** when context is empty or inadequate. The policy is applied regardless of whether retrieval returned snippets. See [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md). **(iter-2)**
- **User-supplied chat prompts:** In addition to the built-in grounding policy, the user may configure:
  - A **chat system prompt** (persona, tone, style preferences that do not contradict the grounding policy), and
  - A **vault organization prompt** (how the user's notes are organized — for example, "daily notes live in `Daily/` with `YYYY-MM-DD.md` filenames; journal entries use `#mood`; job search uses `#jobsearch`").
    Both user prompts are merged into provider message lists on **every** chat request in a defined order (see [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md)). **(iter-2)**
- **Retrieval configuration is honored by chat:** Chat retrieval must apply the same user-configured retrieval settings (result count, token budgets, tag filters, and any future hybrid/filter toggles) that the search pane uses. Chat must not ignore user retrieval tuning.
- **Conversation history:** Subsequent turns in the same conversation include prior user and assistant messages when supported by the product.
- **New conversation:** User can clear history and start fresh.
- **Agent (file operations):** Chat may **create or update** notes when the user asks; **allowed output folders** are **configurable** and distinct from indexed-folder rules where product policy requires separation.
- **Max size** of generated notes is **configurable** (default on the order of **5,000 characters** unless revised).
- **Chat timeout** is **configurable** (default **30 seconds**) to accommodate local vs remote models.

---

## 7. Functional requirements — providers and settings

- **MVP chat providers:** At least **OpenAI** and **Ollama**; the architecture must allow **additional providers later** without rewriting core orchestration.
- **Embeddings** and **chat** endpoints, models, and keys (where applicable) are **configurable**.
- **Models** need not run locally; if local inference is offered, it should be **configurable** with cross-platform realism in mind.
- **Chat grounding settings (iter-2):** The settings surface must expose:
  - `chatSystemPrompt` — user-supplied persona/style system prompt, appended to the built-in grounding policy per [ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md).
  - `vaultOrganizationPrompt` — user-supplied description of how notes are organized (daily note conventions, tag conventions, folder conventions) so the assistant can translate natural-language queries into effective retrieval intent.
- **Chat retrieval settings (iter-2):** In addition to the existing search settings, expose:
  - `chatCoarseK` — number of candidate summary hits retained in the coarse phase (see [ADR-012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md)).
  - `enableHybridSearch` — toggle for keyword (FTS5) + vector recall fusion (see [ADR-012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md)).
  - `dailyNotePathGlobs` — optional glob(s) identifying daily-note files for temporal filtering (see [ADR-014](../decisions/ADR-014-temporal-and-path-filters.md)).
  - `dailyNoteDatePattern` — date format embedded in daily-note filenames (default `YYYY-MM-DD`).

---

## 8. Storage and index persistence (requirements level)

- Persist the hierarchical index in a **real database** suitable for relational queries and **vector search** (sqlite-vec / `vec0` class of solution), not a giant JSON blob for the index.
- **Default location** for the DB is **outside the vault** (e.g. under a user-home application directory) with a **per-vault** file naming scheme; **optional per-vault absolute path** override must remain **scoped per vault** (no global "one DB for all vaults").
- **Lazy initialization:** Opening the DB and running migrations must not block a **fast plugin startup**; heavy work runs on **first use** of storage or explicit user action, consistent with the startup budget below.
- After storage upgrades, users must be able to recover via **full reindex**; legacy import paths are optional, not a hard requirement.
- **Documentation** must warn users about cloud-synced or network paths for the DB file (locking/corruption risk) and that **uninstall** may leave DB files on disk unless the user deletes them.
- **Keyword index (iter-2):** The same per-vault SQLite database must house a **full-text search index** (SQLite FTS5 virtual table over node content) alongside the `nodes`, `summaries`, and `vec_*` tables. The FTS5 table is an **additive** migration; a full reindex is an acceptable upgrade path and is documented in the storage guide. See [ADR-012](../decisions/ADR-012-hybrid-retrieval-and-coarse-k.md). **(iter-2)**

---

## 9. Reliability, observability, and quality (MVP bar)

- **Startup:** Plugin initialization must **not materially slow Obsidian**; target **under two seconds** for ordinary startup path on representative hardware (excluding first-time heavy work deferred per lazy init). This includes spawning the sidecar process. **(iter-2)**
- **Structured logging** with configurable **log level** and safe handling of **sensitive data** (redaction) is a baseline for debugging field issues.
- **Failure handling:** Partial indexing failures and provider outages should degrade **predictably** (clear errors, recoverability), not corrupt index state silently. The idempotent indexing state machine ensures that failures at any step are recoverable without data loss. **(iter-2)**
- **Crash recovery:** On plugin/sidecar restart, incomplete indexing jobs resume from the last completed step. Dead-letter tracking after configurable retries (default 3) prevents infinite retry loops. **(iter-2)**

---

## 10. UX requirements (behavioral, not visual design)

**Semantic search pane**

- Each result is **visually distinct** with clear separation between title, path, snippet, and score/metric.
- **Snippet and result text** must be **selectable** for copy/paste.

**Chat pane**

- User messages and assistant messages are **visually distinct**; assistant text is **selectable**; **copy** of the full assistant reply is available.
- **Sources** from retrieval are surfaced as **navigable** controls that open the corresponding note.
- **Input** is at the **bottom** of the pane, **multi-line**, with send/cancel affordances.
- Styling should follow **Obsidian theme variables** so light and dark themes remain usable.
- **Insufficient-evidence state (iter-2):** When the grounding policy emits an insufficient-evidence response ([ADR-011](../decisions/ADR-011-vault-only-chat-grounding.md)), the chat pane must render it as a **distinct state** (visibly different from a normal assistant reply, with no fabricated sources and no "paste your notes" phrasing) so the user knows the answer was gated by retrieval, not generated from outside knowledge.

_(Specific CSS class names, pixel values, and component structure are left to implementation.)_

---

## 11. Out of scope (MVP)

- Multiple vaults in one unified index.
- **Mobile** local models or full parity with desktop for the sqlite/vector stack (validate per target matrix when implementing).
- **Syncing** indexes across devices as a built-in feature.
- **Third-party chat providers** beyond OpenAI and Ollama in MVP (but **abstraction** must allow adding them).
- **Cloud queue or cloud function adapters** — the queue and service port abstractions exist for future extensibility, but iteration 2 ships only local/in-process implementations. **(iter-2)**

---

## 12. Technology constraints (confirmed at requirements level)

- **Language:** TypeScript.
- **Vector store:** **SQLite** with **sqlite-vec** for ANN search, running as native `better-sqlite3` in the sidecar process. The plugin itself ships no native addons. **(iter-2 — supersedes iteration 1's wa-SQLite WASM constraint; see ADR-006)**
- **Obsidian:** Minimum version at least the release that introduced the **secret store** (exact floor to confirm against Obsidian release notes at implementation time).
- **Node.js:** Required as a runtime dependency for the sidecar process (>= 18). **(iter-2)**

---

## 13. Architecture constraints (iter-2)

- **Hexagonal (ports-and-adapters) architecture:** Core domain logic (chunking, workflows, retrieval) has no knowledge of infrastructure. All external dependencies (storage, queues, embedding/chat providers, vault access, progress reporting, secrets) are behind port interfaces. **(iter-2)**
- **Sidecar process:** Heavy compute (SQLite, embedding, summarization, search) runs in a Node.js sidecar process spawned by the plugin and terminated on plugin unload. The plugin `main.js` remains a thin client responsible for UI, Obsidian API interactions, and sidecar communication. **(iter-2)**
- **Transport abstraction:** Communication between plugin and sidecar is behind an `ISidecarTransport` port. Iteration 2 defaults to stdio IPC (child_process). An HTTP/WebSocket transport adapter is available for debugging and future remote-sidecar scenarios. **(iter-2)**
- **Plugin reads vault files:** The plugin reads vault content via the Obsidian API and sends it to the sidecar. The sidecar has no direct filesystem access to the vault. **(iter-2)**

---

## 14. Product lessons (non-normative)

These observations inform scoping and risk; they are not substitute acceptance tests.

- **Indexing quality** is hard: embedding windows are smaller than chat context; chunking trades atomicity against surrounding context.
- **Hierarchical retrieval** improves answer quality but increases **indexing cost** and **pipeline complexity** versus flat chunks.
- **Obsidian** file watching and JSON-oriented persistence favor keeping **large indexes** out of hot plugin JSON paths and **outside the vault** where appropriate.
- **WASM packaging in Electron** is fragile: dynamic module loading, WASM asset copying, and Electron renderer restrictions create brittle packaging that breaks across versions. Native code belongs in a sidecar, not the plugin bundle. **(iter-2)**

---

## 15. Open questions

- Exact **Obsidian minimum version** tied to secret store and API stability.
- **Mobile** roadmap for any AI features (if ever), relative to sidecar constraints.
- Final **default token budgets** and settings exposure (starting points exist in hierarchical prompt; tune with telemetry or user feedback).
- **Sidecar binary packaging:** Future iterations may compile the sidecar to a single executable (via `pkg`, `sea`, or similar) to remove the Node.js runtime prerequisite for end users. **(iter-2)**
- **Built-in grounding prompt copy (iter-2):** Default wording for the built-in grounding system message — terse directive vs. a richer rubric that explicitly enumerates refusals ("do not invent citations", "do not instruct the user to paste notes").
- **System prompt ordering (iter-2):** Whether the user-supplied `chatSystemPrompt` is appended **after** or **before** the built-in grounding policy when building the provider message list. Current working assumption: built-in policy first (authoritative), then vault-organization prompt, then user system prompt — reconfirm during CHAT-3 / CHAT-4 implementation.
- **Daily-note date parsing strategy (iter-2):** Single global `dailyNoteDatePattern` setting vs. per-glob pattern. Default assumption: one pattern (`YYYY-MM-DD`) with optional prefix/suffix; revisit if users need multiple daily-note conventions per vault.
- **Hybrid retrieval weighting (iter-2):** Whether RRF fusion weights for vector vs BM25 are **fixed** (ADR-012 default) or user-tunable. Default assumption: fixed in MVP, revisit with retrieval-quality telemetry.
