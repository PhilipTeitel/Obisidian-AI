# Obsidian-AI-MVP — Scoping Document

## 1. Introduction

This project builds an **MVP** for an Obsidian plugin that adds AI capabilities: **indexing**, **embedding**, and **searching** notes via **semantic search** and **chat completions**.

**Audience:** This document is for business and product alignment and for an architect to derive a technical design and build plan. Assumptions are minimized; open questions are called out explicitly.

---

## 2. Goals and Success Criteria

- **Primary:** Users can semantically search their vault and use chat completions over their notes.
- **Secondary:** Index and embeddings stay local; chat can use remote (or optionally local) models with configurable API/keys.

- **MVP success criteria:**
  - Users can **find notes by meaning** (semantic search).
  - **Chat uses only the vault for context** (no external knowledge in chat answers).


---

## 3. Requirements

### 3.1 UI

- **UI panes** for:
  - Semantic search
  - Chat completions
- **Long-running processes:** Progress indicators in a slideout (e.g., indexing, embedding).

- **Commands** (in addition to panes and slideout). Minimum command set:
  - **Reindex vault** — full reindex.
  - **Index changes** — incremental index of changes.
  - **Semantic search selection** — user selects text in a note and runs semantic search on that selection.


### 3.2 Functionality

- **Indexing & context**
  - Notes are indexed with structure and context preserved.
  - **Minimum metadata** to keep:
    - Note name
    - Heading
    - Paragraph / bullet
    - Tags
- **Scope of indexing**
  - User can **configure which folders** are indexed (inclusion/exclusion).
- **Agent file operations**
  - The **agent** is the **chat** that can create/update notes when the user asks.
  - The agent can **create/update files** (e.g., structured search results, summaries of notes or topics spread across notes, reports).
  - **Allowed folders** for create/update are **configurable** (separate from indexed folders).
  - **Max size of generated notes** is **configurable**, with a reasonable default of **5k characters**.
- **Models & connectivity**
  - Models **do not** have to run locally.
  - **Connection details** (endpoints, API keys, etc.) are **configurable**.
  - If **local model** usage is realistically feasible, it should be **configurable** (e.g., cross-platform compatibility).
- **Secrets**
  - Stored in **Obsidian’s secret store**, not in config files.


### 3.3 Performance

- Vaults may contain **hundreds to thousands** of notes; indexing and search must remain viable at that scale (**"works with thousands of notes"** is sufficient).
- **Chat/completion timeout** is **configurable** (to support both local and remote models); **default 30 seconds**.


---

## 4. Constraints

- **Indexed data** must stay **local** within the plugin’s directory (no sending raw note content to external indexing services; embeddings/vector DB local).
- **Plugin startup:** Must not significantly slow Obsidian's startup; **plugin init &lt; 2 seconds**.


---

## 5. Out of Scope (MVP)

- Multiple vaults
- Chat completions using **local models on mobile devices**
- Syncing indexes across multiple devices
- Chat providers beyond **Ollama and OpenAI** (others may be added later; **abstract the chat/provider interface** so additional providers can be added without reworking the core)

---

## 6. Tech Stack (Confirmed)

- **Language:** TypeScript
- **Embeddings / vector store:** wa-SQLite with sqlite-vec
- **Obsidian:** Support only back to the version when **Obsidian's secret store** was added (exact minimum version for architect to confirm). Rest of stack is open.

---

## 7. Decisions / Assumptions

- **Success:** MVP success = users find notes by meaning; chat uses only vault for context.
- **UI:** Panes (semantic search, chat), progress slideout, and commands (Reindex vault, Index changes, Semantic search selection) are in scope.
- **Agent:** The chat can create/update notes when the user asks (e.g., search results, summaries, reports); max generated note size configurable, default 5k characters.
- **Performance:** Chat timeout configurable, default 30s; "works with thousands of notes" sufficient for indexing.
- **Startup:** Plugin init &lt; 2 seconds.
- **Out of scope:** Multiple vaults; local models on mobile; syncing indexes; providers beyond Ollama and OpenAI for MVP (provider interface must be abstracted for future additions).
- **Tech:** TypeScript, wa-SQLite/sqlite-vec; Obsidian minimum = version with secret store; rest open.

---

## 8. Next Steps

- Open questions are resolved; this document is ready for the **architect to produce design and build plan**.
- Optionally: short user stories or acceptance criteria per feature (semantic search, chat, indexing, file create/update).