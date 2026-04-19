import { sha256 as sha256bytes } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type {
  BlockContent,
  Heading,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
} from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type {
  ChunkNoteInput,
  ChunkNoteResult,
  DocumentNode,
  ParsedCrossRef,
  ParsedTag,
} from './types.js';
import { parseFrontmatterForTags } from './frontmatterTags.js';
import { extractInlineTagsFromText } from './inlineTags.js';
import { canonicalParagraphBody, splitIntoSentences } from './sentenceSplitter.js';
import { DEFAULT_MAX_EMBEDDING_TOKENS, estimateTokens } from './tokenEstimator.js';
import { extractCrossRefsFromContent, vaultDirOf } from './wikilinkParser.js';

export { DEFAULT_MAX_EMBEDDING_TOKENS } from './tokenEstimator.js';

function sha256Hex(s: string): string {
  return bytesToHex(sha256bytes(new TextEncoder().encode(s)));
}

function randomId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Split leading YAML frontmatter from body (CHK-1 / CHK-5). */
export function partitionFrontmatter(markdown: string): {
  frontmatter: string | null;
  body: string;
} {
  const t = markdown.trimStart();
  if (!t.startsWith('---')) return { frontmatter: null, body: markdown };
  const afterFirst = t.slice(3);
  const firstNl = afterFirst.indexOf('\n');
  const rest = firstNl === -1 ? afterFirst : afterFirst.slice(firstNl + 1);
  const endMarker = '\n---';
  const endIdx = rest.indexOf(endMarker);
  if (endIdx === -1) return { frontmatter: null, body: markdown };
  const fm = rest.slice(0, endIdx).replace(/\s+$/u, '');
  let body = rest.slice(endIdx + endMarker.length);
  if (body.startsWith('\r')) body = body.slice(1);
  if (body.startsWith('\n')) body = body.slice(1);
  return { frontmatter: fm, body };
}

function parseMarkdown(body: string): Root {
  const file = unified().use(remarkParse).use(remarkGfm).parse(body);
  return file as Root;
}

export function phrasingToMarkdown(nodes: readonly PhrasingContent[]): string {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        out += n.value;
        break;
      case 'inlineCode':
        out += '`' + n.value + '`';
        break;
      case 'break':
        out += '\n';
        break;
      case 'strong':
        out += '**' + phrasingToMarkdown(n.children) + '**';
        break;
      case 'emphasis':
        out += '*' + phrasingToMarkdown(n.children) + '*';
        break;
      case 'link':
        out += '[' + phrasingToMarkdown(n.children) + '](' + n.url + ')';
        break;
      case 'image':
        out += '![' + (n.alt ?? '') + '](' + n.url + ')';
        break;
      case 'delete':
        out += '~~' + phrasingToMarkdown(n.children) + '~~';
        break;
      default:
        if ('children' in n && Array.isArray((n as { children?: unknown }).children)) {
          out += phrasingToMarkdown((n as { children: PhrasingContent[] }).children);
        }
        break;
    }
  }
  return out;
}

function blockToFallbackText(node: BlockContent): string {
  return toString(node);
}

function listItemParts(item: ListItem): {
  text: string;
  nestedLists: List[];
} {
  const paras: string[] = [];
  const nested: List[] = [];
  for (const c of item.children) {
    if (c.type === 'paragraph') {
      paras.push(phrasingToMarkdown(c.children));
    } else if (c.type === 'list') {
      nested.push(c);
    } else if (c.type === 'blockquote' || c.type === 'code') {
      paras.push(blockToFallbackText(c as BlockContent));
    } else {
      paras.push(blockToFallbackText(c as BlockContent));
    }
  }
  return { text: paras.join('\n\n'), nestedLists: nested };
}

interface StackEntry {
  id: string;
  depth: number;
  title: string;
}

class ChunkerCtx {
  readonly input: ChunkNoteInput;
  readonly nodes: DocumentNode[] = [];
  readonly byId = new Map<string, DocumentNode>();
  stack: StackEntry[] = [];
  sectionParentId = '';

  constructor(input: ChunkNoteInput) {
    this.input = input;
  }

  nextSiblingOrder(parentId: string | null): number {
    return this.nodes.filter((n) => n.parentId === parentId).length;
  }

  pushDocNode(fields: {
    type: DocumentNode['type'];
    parentId: string | null;
    noteId: string;
    headingTrail: string[];
    depth: number;
    siblingOrder: number;
    content: string;
  }): DocumentNode {
    const id = randomId();
    const ts = nowIso();
    const node: DocumentNode = {
      id,
      noteId: fields.noteId,
      parentId: fields.parentId,
      type: fields.type,
      headingTrail: fields.headingTrail,
      depth: fields.depth,
      siblingOrder: fields.siblingOrder,
      content: fields.content,
      contentHash: sha256Hex(fields.content),
      createdAt: ts,
      updatedAt: ts,
    };
    this.nodes.push(node);
    this.byId.set(id, node);
    return node;
  }
}

function maybeSplitParagraph(ctx: ChunkerCtx, p: DocumentNode, maxTokens: number): void {
  if (p.type !== 'paragraph') return;
  const canon = canonicalParagraphBody(p.content);
  if (estimateTokens(canon) <= maxTokens) return;
  const sentences = splitIntoSentences(canon);
  if (sentences.length < 2) return;
  for (let i = 0; i < sentences.length; i++) {
    ctx.pushDocNode({
      type: 'sentence_part',
      parentId: p.id,
      noteId: p.noteId,
      headingTrail: [...p.headingTrail],
      depth: p.depth + 1,
      siblingOrder: i,
      content: sentences[i]!,
    });
  }
}

function processTopLevelList(list: List, ctx: ChunkerCtx): void {
  const section = ctx.byId.get(ctx.sectionParentId)!;
  const trail = ctx.stack.map((s) => s.title);
  const group = ctx.pushDocNode({
    type: 'bullet_group',
    parentId: ctx.sectionParentId,
    noteId: ctx.input.noteId,
    headingTrail: trail,
    depth: section.depth + 1,
    siblingOrder: ctx.nextSiblingOrder(ctx.sectionParentId),
    content: '',
  });
  for (const item of list.children) {
    if (item.type === 'listItem') {
      processListItem(item, group.id, ctx);
    }
  }
}

function processNestedList(list: List, parentBulletId: string, ctx: ChunkerCtx): void {
  const parentBullet = ctx.byId.get(parentBulletId)!;
  for (const item of list.children) {
    if (item.type !== 'listItem') continue;
    const { text, nestedLists } = listItemParts(item);
    const bullet = ctx.pushDocNode({
      type: 'bullet',
      parentId: parentBulletId,
      noteId: ctx.input.noteId,
      headingTrail: [...parentBullet.headingTrail],
      depth: parentBullet.depth + 1,
      siblingOrder: ctx.nextSiblingOrder(parentBulletId),
      content: text,
    });
    for (const nl of nestedLists) {
      processNestedList(nl, bullet.id, ctx);
    }
  }
}

function processListItem(item: ListItem, parentGroupId: string, ctx: ChunkerCtx): void {
  const group = ctx.byId.get(parentGroupId)!;
  const { text, nestedLists } = listItemParts(item);
  const bullet = ctx.pushDocNode({
    type: 'bullet',
    parentId: parentGroupId,
    noteId: ctx.input.noteId,
    headingTrail: [...group.headingTrail],
    depth: group.depth + 1,
    siblingOrder: ctx.nextSiblingOrder(parentGroupId),
    content: text,
  });
  for (const nl of nestedLists) {
    processNestedList(nl, bullet.id, ctx);
  }
}

function addParagraph(ctx: ChunkerCtx, text: string): void {
  const section = ctx.byId.get(ctx.sectionParentId)!;
  const raw = canonicalParagraphBody(text);
  ctx.pushDocNode({
    type: 'paragraph',
    parentId: ctx.sectionParentId,
    noteId: ctx.input.noteId,
    headingTrail: ctx.stack.map((s) => s.title),
    depth: section.depth + 1,
    siblingOrder: ctx.nextSiblingOrder(ctx.sectionParentId),
    content: raw,
  });
}

function processBlock(node: BlockContent, ctx: ChunkerCtx, noteId: string): void {
  switch (node.type) {
    case 'heading': {
      const h = node as Heading;
      const d = h.depth;
      while (ctx.stack.length && ctx.stack[ctx.stack.length - 1]!.depth >= d) {
        ctx.stack.pop();
      }
      const parentId = ctx.stack.length > 0 ? ctx.stack[ctx.stack.length - 1]!.id : noteId;
      const headingTrail = ctx.stack.map((s) => s.title);
      const parentNode = ctx.byId.get(parentId)!;
      const title = phrasingToMarkdown(h.children);
      const kind: 'topic' | 'subtopic' = d === 1 ? 'topic' : 'subtopic';
      const hn = ctx.pushDocNode({
        type: kind,
        parentId,
        noteId: ctx.input.noteId,
        headingTrail,
        depth: parentNode.depth + 1,
        siblingOrder: ctx.nextSiblingOrder(parentId),
        content: title,
      });
      ctx.stack.push({ id: hn.id, depth: d, title });
      ctx.sectionParentId = hn.id;
      break;
    }
    case 'paragraph':
      addParagraph(ctx, phrasingToMarkdown((node as Paragraph).children));
      break;
    case 'list':
      processTopLevelList(node as List, ctx);
      break;
    case 'blockquote': {
      const inner = (node as { children?: BlockContent[] }).children ?? [];
      for (const c of inner) {
        processBlock(c, ctx, noteId);
      }
      break;
    }
    case 'code': {
      const c = node as { lang?: string | null; value: string };
      const fence = '```' + (c.lang ?? '') + '\n' + c.value + '\n```';
      addParagraph(ctx, fence);
      break;
    }
    case 'thematicBreak':
      addParagraph(ctx, '---');
      break;
    case 'html':
      addParagraph(ctx, (node as { value?: string }).value ?? '');
      break;
    default:
      addParagraph(ctx, blockToFallbackText(node));
  }
}

function dedupeParsedTags(tags: ParsedTag[]): ParsedTag[] {
  const seen = new Set<string>();
  const out: ParsedTag[] = [];
  for (const t of tags) {
    const k = `${t.nodeId}\0${t.tag}\0${t.source}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * Parse one note into hierarchical nodes, cross-references, and tags (CHK-4/5).
 */
export function chunkNote(input: ChunkNoteInput): ChunkNoteResult {
  const { frontmatter, body } = partitionFrontmatter(input.markdown);
  const tree = parseMarkdown(body);

  const ctx = new ChunkerCtx(input);
  const note = ctx.pushDocNode({
    type: 'note',
    parentId: null,
    noteId: input.noteId,
    headingTrail: [],
    depth: 0,
    siblingOrder: 0,
    content: input.noteTitle.trim(),
  });
  ctx.sectionParentId = note.id;

  const fmTags: ParsedTag[] = [];
  if (frontmatter) {
    for (const tag of parseFrontmatterForTags(frontmatter)) {
      fmTags.push({ nodeId: note.id, tag, source: 'frontmatter' });
    }
  }

  for (const child of tree.children) {
    processBlock(child as BlockContent, ctx, note.id);
  }

  const maxT = input.maxEmbeddingTokens ?? DEFAULT_MAX_EMBEDDING_TOKENS;
  const paragraphs = ctx.nodes.filter((n) => n.type === 'paragraph');
  for (const p of paragraphs) {
    maybeSplitParagraph(ctx, p, maxT);
  }

  const vaultDir = vaultDirOf(input.vaultPath);
  const crossRefs: ParsedCrossRef[] = [];
  const inlineTags: ParsedTag[] = [];

  for (const n of ctx.nodes) {
    if (n.type === 'bullet_group' || n.type === 'sentence_part') continue;
    if (!n.content) continue;
    crossRefs.push(...extractCrossRefsFromContent(n.content, n.id, vaultDir));
    inlineTags.push(...extractInlineTagsFromText(n.content, n.id));
  }

  const tags = dedupeParsedTags([...fmTags, ...inlineTags]);

  return {
    nodes: ctx.nodes,
    crossRefs,
    tags,
  };
}

/** @deprecated Prefer `chunkNote`; kept for narrow tests. */
export function chunkNoteToDocumentNodes(input: ChunkNoteInput): DocumentNode[] {
  return chunkNote(input).nodes;
}
