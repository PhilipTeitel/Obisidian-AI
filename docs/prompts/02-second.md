# Obsidian-AI-MVP — Pane Command Requirements (Increment 2)

## 1. Introduction

This document defines an incremental requirements update for command-palette access to existing UI panes.

**Audience:** This document is for product alignment and for an architect/implementer to add pane-opening commands without changing core search/chat behavior.

---

## 2. Goals and Success Criteria

- **Primary:** Users can open either pane directly from the Obsidian command palette.
- **Secondary:** New commands align with current command/view conventions and do not conflict with existing command IDs.

- **Increment success criteria:**
  - A command exists to open/reveal the semantic search pane.
  - A command exists to open/reveal the chat pane.
  - Both commands are discoverable in the command palette and reliably focus an existing pane or open one when missing.
  - The README `Getting Started` section includes a complete list of project commands and how to use each one.

---

## 3. Requirements

### 3.1 Semantic Search Pane Command

- Add a command dedicated to opening the semantic search pane.
- **Proposed command ID:** `obsidian-ai:open-semantic-search-pane`
- **Proposed command name:** `Open semantic search pane`
- Behavior:
  - Opens/reveals the pane with view type `obsidian-ai:search-view`.
  - If a search pane already exists, reuses/reveals it instead of creating duplicate panes.
  - Does not execute a search by itself.

### 3.2 Chat Pane Command

- Add a command dedicated to opening the chat pane.
- **Proposed command ID:** `obsidian-ai:open-chat-pane`
- **Proposed command name:** `Open chat pane`
- Behavior:
  - Opens/reveals the pane with view type `obsidian-ai:chat-view`.
  - If a chat pane already exists, reuses/reveals it instead of creating duplicate panes.
  - Does not start a completion by itself.

### 3.3 Registration and Type Consistency

- Register both commands using the existing command registration approach.
- Keep command constants centralized with existing command constants.
- Ensure command ID types include the two new IDs so type safety remains intact.
- Use the existing view activation flow for both commands.

### 3.4 README Getting Started Command List

- Update the README `Getting Started` section with a command reference list so users can discover and use the app from the command palette.
- The command list should include, at minimum:
  - `Reindex vault`
  - `Index changes`
  - `Semantic search selection`
  - `Open semantic search pane`
  - `Open chat pane`
- For each command, document:
  - Display name shown in Obsidian
  - Purpose/expected behavior
  - Typical usage context (when users should run it)
- The README command list should stay aligned with the command IDs/names defined in plugin constants.

---

## 4. Constraints

- Follow existing command ID naming convention: `obsidian-ai:<kebab-case>`.
- Keep implementation scoped to command registration and pane activation only.
- Reuse existing pane/view infrastructure (search/chat view types and current activation helper).

---

## 5. Out of Scope (Increment 2)

- Changes to semantic search ranking, embedding, or retrieval behavior.
- Changes to chat prompt construction, context retrieval, or provider logic.
- New panes, new providers, or settings UI expansion.

---

## 6. Tech/Architecture Alignment

- Keep alignment with current plugin command and view architecture:
  - Command constants and names
  - Command ID type union
  - Existing view activation helper behavior

---

## 7. Decisions / Assumptions

- Current semantic search and chat panes already exist and are the target destinations for the new commands.
- Existing view activation semantics (reuse existing leaf when present) are accepted for this increment.
- Proposed command IDs are acceptable unless a naming preference is provided.

---

## 8. Next Steps

- Architect confirms/adjusts final command IDs and names if needed.
- Implementer adds the two commands and corresponding type/constant updates.
- QA verifies command palette discoverability and pane open/reveal behavior for both commands.
