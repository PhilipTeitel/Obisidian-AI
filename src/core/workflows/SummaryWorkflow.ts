/**
 * Bottom-up LLM summaries (WKF-1, ADR-002 / ADR-008).
 *
 * Prompt shape: system message states role; user message lists each child with heading trail,
 * node type, and text — either the child's stored summary (non-leaf) or raw content (leaf).
 */
import { chunkNote } from '../domain/chunker.js';
import type { ChunkNoteResult, DocumentNode } from '../domain/types.js';
import type { IChatPort } from '../ports/IChatPort.js';
import type { IDocumentStore } from '../ports/IDocumentStore.js';

export interface SummaryWorkflowInput {
  noteId: string;
  vaultPath: string;
  noteTitle: string;
  markdown: string;
  maxEmbeddingTokens?: number;
  chatModelLabel: string;
  apiKey?: string;
  /**
   * When set, skips `chunkNote` so node ids are stable across calls (tests and callers
   * that already parsed the note).
   */
  precomputed?: ChunkNoteResult;
}

export interface SummaryWorkflowDeps {
  chat: IChatPort;
  store: IDocumentStore;
}

function buildChildrenMap(nodes: DocumentNode[]): Map<string | null, DocumentNode[]> {
  const m = new Map<string | null, DocumentNode[]>();
  for (const n of nodes) {
    const p = n.parentId;
    if (!m.has(p)) m.set(p, []);
    m.get(p)!.push(n);
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => a.siblingOrder - b.siblingOrder);
  }
  return m;
}

function findNoteRootId(nodes: DocumentNode[]): string {
  const root = nodes.find((n) => n.type === 'note' && n.parentId === null);
  if (!root) {
    throw new Error('SummaryWorkflow: expected exactly one root note node');
  }
  return root.id;
}

function isNonLeaf(nodes: DocumentNode[], nodeId: string): boolean {
  return nodes.some((n) => n.parentId === nodeId);
}

/** Pre-order: parent before children (children by sibling_order). */
function preorder(nodes: DocumentNode[], rootId: string): DocumentNode[] {
  const byParent = buildChildrenMap(nodes);
  const idToNode = new Map(nodes.map((n) => [n.id, n]));
  const out: DocumentNode[] = [];
  function walk(id: string): void {
    const node = idToNode.get(id);
    if (!node) return;
    out.push(node);
    for (const ch of byParent.get(id) ?? []) {
      walk(ch.id);
    }
  }
  walk(rootId);
  return out;
}

/** Post-order: children first, then parent. */
function postorder(nodes: DocumentNode[], rootId: string): DocumentNode[] {
  const byParent = buildChildrenMap(nodes);
  const idToNode = new Map(nodes.map((n) => [n.id, n]));
  const out: DocumentNode[] = [];
  function walk(id: string): void {
    for (const ch of byParent.get(id) ?? []) {
      walk(ch.id);
    }
    const node = idToNode.get(id);
    if (node) out.push(node);
  }
  walk(rootId);
  return out;
}

/**
 * Zip pre-order lists: structural/content mismatch marks the new node and all its ancestors dirty.
 */
export function computeDirtyNodeIds(
  oldNodes: DocumentNode[],
  newNodes: DocumentNode[],
): Set<string> {
  const dirty = new Set<string>();
  const newById = new Map(newNodes.map((n) => [n.id, n]));

  function markAncestors(id: string): void {
    let cur = newById.get(id);
    while (cur) {
      dirty.add(cur.id);
      if (cur.parentId === null) break;
      cur = newById.get(cur.parentId);
    }
  }

  if (oldNodes.length === 0) {
    for (const n of newNodes) {
      if (isNonLeaf(newNodes, n.id)) dirty.add(n.id);
    }
    return dirty;
  }

  let oldRoot: string;
  let newRoot: string;
  try {
    oldRoot = findNoteRootId(oldNodes);
    newRoot = findNoteRootId(newNodes);
  } catch {
    for (const n of newNodes) {
      if (isNonLeaf(newNodes, n.id)) dirty.add(n.id);
    }
    return dirty;
  }

  const oldPo = preorder(oldNodes, oldRoot);
  const newPo = preorder(newNodes, newRoot);

  if (oldPo.length !== newPo.length) {
    for (const n of newNodes) {
      if (isNonLeaf(newNodes, n.id)) dirty.add(n.id);
    }
    return dirty;
  }

  for (let i = 0; i < newPo.length; i++) {
    const o = oldPo[i];
    const ne = newPo[i];
    if (o.type !== ne.type || o.contentHash !== ne.contentHash) {
      markAncestors(ne.id);
    }
  }
  return dirty;
}

function generatedAtNotBeforeNodeUpdatedAt(generatedAt: string, nodeUpdatedAt: string): boolean {
  const g = Date.parse(generatedAt);
  const u = Date.parse(nodeUpdatedAt);
  if (!Number.isNaN(g) && !Number.isNaN(u)) {
    return g >= u;
  }
  return generatedAt >= nodeUpdatedAt;
}

async function shouldSkipNonLeaf(
  store: IDocumentStore,
  node: DocumentNode,
  dirty: Set<string>,
): Promise<boolean> {
  if (dirty.has(node.id)) return false;
  const row = await store.getSummary(node.id);
  if (!row) return false;
  return generatedAtNotBeforeNodeUpdatedAt(row.generatedAt, node.updatedAt);
}

async function childTextForPrompt(
  store: IDocumentStore,
  nodes: DocumentNode[],
  child: DocumentNode,
): Promise<string> {
  if (isNonLeaf(nodes, child.id)) {
    const s = await store.getSummary(child.id);
    if (s?.summary) return s.summary;
  }
  return child.content;
}

async function summarizeNonLeaf(
  deps: SummaryWorkflowDeps,
  input: SummaryWorkflowInput,
  nodes: DocumentNode[],
  node: DocumentNode,
): Promise<void> {
  const byParent = buildChildrenMap(nodes);
  const children = byParent.get(node.id) ?? [];
  const sections: string[] = [];
  for (const ch of children) {
    const text = await childTextForPrompt(deps.store, nodes, ch);
    const trail = ch.headingTrail.length ? ch.headingTrail.join(' > ') : '(root)';
    sections.push(`### ${ch.type} (${trail})\n${text}`);
  }
  const system = `You are a concise note indexer. Produce a short summary (2–4 sentences) of the child sections for hierarchical search. Model: ${input.chatModelLabel}.`;
  const user = sections.join('\n\n');
  let out = '';
  try {
    for await (const delta of deps.chat.complete(
      [{ role: 'system', content: system }],
      user,
      input.apiKey,
    )) {
      out += delta;
    }
  } catch (e) {
    console.warn('SummaryWorkflow: chat.complete failed', { nodeId: node.id, error: e });
    throw e;
  }
  const summary = out.trim();
  if (!summary) {
    throw new Error(`SummaryWorkflow: empty summary for node ${node.id}`);
  }
  await deps.store.upsertSummary(node.id, summary, input.chatModelLabel);
}

/**
 * Generate bottom-up summaries for one note; uses `chunkNote` unless `input.precomputed` is set.
 */
export async function summarizeNote(
  deps: SummaryWorkflowDeps,
  input: SummaryWorkflowInput,
): Promise<void> {
  const oldNodes = await deps.store.getNodesByNote(input.noteId);
  const result =
    input.precomputed ??
    chunkNote({
      noteId: input.noteId,
      noteTitle: input.noteTitle,
      vaultPath: input.vaultPath,
      markdown: input.markdown,
      maxEmbeddingTokens: input.maxEmbeddingTokens,
    });
  const newNodes = result.nodes;
  const dirty = computeDirtyNodeIds(oldNodes, newNodes);
  const rootId = findNoteRootId(newNodes);
  const order = postorder(newNodes, rootId);

  for (const node of order) {
    if (!isNonLeaf(newNodes, node.id)) continue;
    if (await shouldSkipNonLeaf(deps.store, node, dirty)) {
      console.debug('SummaryWorkflow: skip fresh summary', { nodeId: node.id });
      continue;
    }
    await summarizeNonLeaf(deps, input, newNodes, node);
  }
}
