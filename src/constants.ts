export const SEARCH_VIEW_TYPE = "obsidian-ai:search-view";
export const CHAT_VIEW_TYPE = "obsidian-ai:chat-view";

export const COMMAND_IDS = {
  REINDEX_VAULT: "obsidian-ai:reindex-vault",
  INDEX_CHANGES: "obsidian-ai:index-changes",
  SEARCH_SELECTION: "obsidian-ai:search-selection",
  OPEN_SEMANTIC_SEARCH_PANE: "obsidian-ai:open-semantic-search-pane",
  OPEN_CHAT_PANE: "obsidian-ai:open-chat-pane"
} as const;

export const COMMAND_NAMES = {
  REINDEX_VAULT: "Reindex vault",
  INDEX_CHANGES: "Index changes",
  SEARCH_SELECTION: "Semantic search selection",
  OPEN_SEMANTIC_SEARCH_PANE: "Open semantic search pane",
  OPEN_CHAT_PANE: "Open chat pane"
} as const;
