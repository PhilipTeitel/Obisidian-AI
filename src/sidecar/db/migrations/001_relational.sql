-- STO-1: relational schema only (README §8, non-vector tables).
-- Hierarchical document nodes
CREATE TABLE IF NOT EXISTS nodes (
    id            TEXT PRIMARY KEY,
    note_id       TEXT NOT NULL,
    parent_id     TEXT,
    type          TEXT NOT NULL CHECK (type IN (
                    'note','topic','subtopic',
                    'paragraph','sentence_part',
                    'bullet_group','bullet')),
    heading_trail TEXT,
    depth         INTEGER NOT NULL DEFAULT 0,
    sibling_order INTEGER NOT NULL DEFAULT 0,
    content       TEXT NOT NULL,
    content_hash  TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_nodes_note   ON nodes(note_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_type   ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_hash   ON nodes(content_hash);

-- LLM-generated summaries (one per non-leaf node)
CREATE TABLE IF NOT EXISTS summaries (
    node_id      TEXT PRIMARY KEY,
    summary      TEXT NOT NULL,
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    model        TEXT,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- Tags scoped to nodes
CREATE TABLE IF NOT EXISTS tags (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id   TEXT NOT NULL,
    tag       TEXT NOT NULL,
    source    TEXT NOT NULL CHECK (source IN ('frontmatter','inline')),
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tags_tag     ON tags(tag);
CREATE INDEX IF NOT EXISTS idx_tags_node    ON tags(node_id);

-- Cross-references (wikilinks, markdown links)
CREATE TABLE IF NOT EXISTS cross_refs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    source_node_id TEXT NOT NULL,
    target_path    TEXT NOT NULL,
    link_text      TEXT,
    FOREIGN KEY (source_node_id) REFERENCES nodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_xref_source ON cross_refs(source_node_id);
CREATE INDEX IF NOT EXISTS idx_xref_target ON cross_refs(target_path);

-- Note-level metadata (for incremental indexing)
CREATE TABLE IF NOT EXISTS note_meta (
    note_id       TEXT PRIMARY KEY,
    vault_path    TEXT NOT NULL,
    content_hash  TEXT NOT NULL,
    indexed_at    TEXT NOT NULL DEFAULT (datetime('now')),
    node_count    INTEGER NOT NULL DEFAULT 0
);

-- Queue items (crash recovery for InProcessQueue) [ADR-007]
CREATE TABLE IF NOT EXISTS queue_items (
    id           TEXT PRIMARY KEY,
    queue_name   TEXT NOT NULL,
    payload      TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN (
                   'pending','processing','completed','dead_letter')),
    retry_count  INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    enqueued_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_queue_status ON queue_items(queue_name, status);

-- Job step tracking (idempotent indexing state machine) [ADR-008]
CREATE TABLE IF NOT EXISTS job_steps (
    job_id        TEXT PRIMARY KEY,
    note_path     TEXT NOT NULL,
    current_step  TEXT NOT NULL CHECK (current_step IN (
                    'queued','parsing','parsed','storing','stored',
                    'summarizing','summarized','embedding','embedded',
                    'failed','dead_letter')),
    content_hash  TEXT NOT NULL,
    retry_count   INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_step ON job_steps(current_step);
CREATE INDEX IF NOT EXISTS idx_jobs_note ON job_steps(note_path);
