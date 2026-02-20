export const SEARCH_VIEW_TYPE = "obsidian-ai:search-view";
export const CHAT_VIEW_TYPE = "obsidian-ai:chat-view";

export const COMMAND_IDS = {
  REINDEX_VAULT: "obsidian-ai:reindex-vault",
  INDEX_CHANGES: "obsidian-ai:index-changes",
  SEARCH_SELECTION: "obsidian-ai:search-selection"
} as const;

export const COMMAND_NAMES = {
  REINDEX_VAULT: "Reindex vault",
  INDEX_CHANGES: "Index changes",
  SEARCH_SELECTION: "Semantic search selection"
} as const;
