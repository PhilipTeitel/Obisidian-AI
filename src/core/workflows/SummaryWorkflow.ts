/**
 * Bottom-up LLM summaries (WKF-1, ADR-002 / ADR-008 / WKF-4).
 *
 * Prompt shape: system message states role; context string lists the structured rubric plus each child
 * with heading trail, node type, and text — either the child's stored summary (non-leaf) or raw content (leaf).
 */
import { chunkNote } from '../domain/chunker.js';
import {
  SUMMARY_RUBRIC_MAX_CHARS,
  SUMMARY_RUBRIC_VERSION,
  clipRubricToCaps,
  selectSummaryPrompt,
  truncateSummaryToBudget,
} from '../domain/summaryPrompts.js';
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
  if (dirty.has(node.id)) {
    console.debug('SummaryWorkflow: will summarize (dirty)', {
      nodeId: node.id,
      nodeType: node.type,
      promptVersion: SUMMARY_RUBRIC_VERSION,
    });
    return false;
  }
  const row = await store.getSummary(node.id);
  if (!row) return false;
  if (row.promptVersion !== SUMMARY_RUBRIC_VERSION) {
    console.debug('SummaryWorkflow: will summarize (prompt version stale)', {
      nodeId: node.id,
      nodeType: node.type,
      storedPromptVersion: row.promptVersion,
      promptVersion: SUMMARY_RUBRIC_VERSION,
    });
    return false;
  }
  if (!generatedAtNotBeforeNodeUpdatedAt(row.generatedAt, node.updatedAt)) return false;
  console.debug('SummaryWorkflow: skip fresh summary', {
    nodeId: node.id,
    nodeType: node.type,
    promptVersion: row.promptVersion,
    reason: 'hash-and-version-skip',
  });
  return true;
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
  const rubric = selectSummaryPrompt(node.type);
  if (rubric === null) {
    return;
  }

  const byParent = buildChildrenMap(nodes);
  const children = byParent.get(node.id) ?? [];
  const sections: string[] = [];
  for (const ch of children) {
    const text = await childTextForPrompt(deps.store, nodes, ch);
    const trail = ch.headingTrail.length ? ch.headingTrail.join(' > ') : '(root)';
    sections.push(`### ${ch.type} (${trail})\n${text}`);
  }
  const system = `You are a concise note indexer for hierarchical search. Follow the rubric in the context exactly. Model: ${input.chatModelLabel}.`;
  const context = `${rubric}\n\n-----\n\n${sections.join('\n\n')}`;
  console.debug('SummaryWorkflow: summarizing', {
    nodeId: node.id,
    nodeType: node.type,
    promptVersion: SUMMARY_RUBRIC_VERSION,
  });
  let out = '';
  try {
    for await (const delta of deps.chat.complete(
      [{ role: 'system', content: system }],
      context,
      input.apiKey,
    )) {
      out += delta;
    }
  } catch (e) {
    console.warn('SummaryWorkflow: chat.complete failed', { nodeId: node.id, error: e });
    throw e;
  }
  let summary = clipRubricToCaps(out.trim());
  const trunc = truncateSummaryToBudget(summary, SUMMARY_RUBRIC_MAX_CHARS);
  summary = trunc.text;
  if (trunc.truncated) {
    console.warn('SummaryWorkflow: summary truncated to budget', {
      nodeId: node.id,
      nodeType: node.type,
      preTruncationSize: trunc.preTruncationSize,
      budgetChars: SUMMARY_RUBRIC_MAX_CHARS,
    });
  }
  if (!summary) {
    throw new Error(`SummaryWorkflow: empty summary for node ${node.id}`);
  }
  await deps.store.upsertSummary(node.id, summary, input.chatModelLabel, SUMMARY_RUBRIC_VERSION);
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
    if (selectSummaryPrompt(node.type) === null) {
      console.debug('SummaryWorkflow: skip non-summarized node type', {
        nodeId: node.id,
        nodeType: node.type,
      });
      continue;
    }
    if (await shouldSkipNonLeaf(deps.store, node, dirty)) {
      continue;
    }
    await summarizeNonLeaf(deps, input, newNodes, node);
  }
}
