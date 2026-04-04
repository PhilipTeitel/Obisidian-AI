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

**Retrieval phases**

1. **Coarse:** Query embedding matched primarily against **summary** embeddings to find candidate regions.
2. **Fine:** **Drill down** within candidates using **content** embeddings (including recursive descent as needed).
3. **Assembly:** Build **structured context** for the chat (and search display) by walking ancestors/siblings with **token budgets** per tier (matched content, sibling context, parent summaries), preserving headings and list structure in the text sent to the LLM.

**Tags and cross-references**

- Tags are tracked at **scopes** consistent with the hierarchy so users can reason about "this topic vs that topic."
- **Wikilinks** (and similar explicit references) are tracked to allow **related context** to be pulled in when useful.

**User-facing documentation**

- Provide an **authoring-oriented** guide that explains how headings, bullets, tags, and links affect indexing and retrieval (so users can write notes that work well with the system).

---

## 6. Functional requirements — chat and agent

- **Chat** uses retrieval from the hierarchical index to supply **vault-only** context for answering (plus conversation history within a session as configured).
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

---

## 8. Storage and index persistence (requirements level)

- Persist the hierarchical index in a **real database** suitable for relational queries and **vector search** (sqlite-vec / `vec0` class of solution), not a giant JSON blob for the index.
- **Default location** for the DB is **outside the vault** (e.g. under a user-home application directory) with a **per-vault** file naming scheme; **optional per-vault absolute path** override must remain **scoped per vault** (no global "one DB for all vaults").
- **Lazy initialization:** Opening the DB and running migrations must not block a **fast plugin startup**; heavy work runs on **first use** of storage or explicit user action, consistent with the startup budget below.
- After storage upgrades, users must be able to recover via **full reindex**; legacy import paths are optional, not a hard requirement.
- **Documentation** must warn users about cloud-synced or network paths for the DB file (locking/corruption risk) and that **uninstall** may leave DB files on disk unless the user deletes them.

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
