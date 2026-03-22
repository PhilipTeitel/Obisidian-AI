import type { ChunkContextKind, ChunkRecord, ChunkerInput, ChunkerOptions, CrossReference, DocumentNode, DocumentTree, NodeType } from "../types";
import { createRuntimeLogger } from "../logging/runtimeLogger";
import { splitBySentence } from "./sentenceSplitter";
import { extractWikilinks } from "./wikilinkParser";
const logger = createRuntimeLogger("hierarchicalChunker");

interface FrontmatterParseResult {
  body: string;
  tags: string[];
}

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const BULLET_PATTERN = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/;
const INLINE_TAG_PATTERN = /(^|[\s(])#([a-z0-9][a-z0-9/_-]*)/gi;

const normalizeTag = (raw: string): string | null => {
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, "");
  const withoutPound = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  const normalized = withoutPound.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return normalized;
};

const collectTag = (target: Set<string>, rawTag: string): void => {
  const normalized = normalizeTag(rawTag);
  if (normalized) {
    target.add(normalized);
  }
};

const parseFrontmatterTagValue = (rawValue: string, tagSet: Set<string>): void => {
  const value = rawValue.trim();
  if (!value) {
    return;
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1);
    for (const candidate of inner.split(",")) {
      collectTag(tagSet, candidate);
    }
    return;
  }
  if (value.includes(",")) {
    for (const candidate of value.split(",")) {
      collectTag(tagSet, candidate);
    }
    return;
  }
  collectTag(tagSet, value);
};

const parseFrontmatter = (markdown: string): FrontmatterParseResult => {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { body: normalized, tags: [] };
  }

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex < 0) {
    return { body: normalized, tags: [] };
  }

  const frontmatterLines = lines.slice(1, closingIndex);
  const body = lines.slice(closingIndex + 1).join("\n");
  const tags = new Set<string>();

  for (let index = 0; index < frontmatterLines.length; index += 1) {
    const current = frontmatterLines[index].trim();
    const inlineMatch = current.match(/^tags\s*:\s*(.+)\s*$/i);
    if (inlineMatch) {
      parseFrontmatterTagValue(inlineMatch[1], tags);
      continue;
    }

    const blockMatch = current.match(/^tags\s*:\s*$/i);
    if (!blockMatch) {
      continue;
    }

    let blockIndex = index + 1;
    while (blockIndex < frontmatterLines.length) {
      const itemLine = frontmatterLines[blockIndex];
      const itemMatch = itemLine.match(/^\s*-\s+(.+)\s*$/);
      if (!itemMatch) {
        break;
      }
      collectTag(tags, itemMatch[1]);
      blockIndex += 1;
    }
    index = blockIndex - 1;
  }

  return {
    body,
    tags: [...tags].sort()
  };
};

const extractInlineTags = (markdownBody: string): string[] => {
  const tagSet = new Set<string>();
  const lines = markdownBody.replace(/\r\n?/g, "\n").split("\n");
  let inCodeFence = false;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      continue;
    }

    for (const match of line.matchAll(INLINE_TAG_PATTERN)) {
      collectTag(tagSet, match[2]);
    }
  }

  return [...tagSet].sort();
};

export const extractTagsFromMarkdown = (markdown: string): string[] => {
  const frontmatter = parseFrontmatter(markdown);
  const merged = new Set<string>();

  for (const tag of frontmatter.tags) {
    merged.add(tag);
  }
  for (const tag of extractInlineTags(frontmatter.body)) {
    merged.add(tag);
  }

  return [...merged].sort();
};

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const splitByMaxChunkChars = (content: string, maxChunkChars?: number): string[] => {
  if (!maxChunkChars || maxChunkChars <= 0 || content.length <= maxChunkChars) {
    return [content];
  }

  const parts: string[] = [];
  let remaining = content.trim();

  while (remaining.length > maxChunkChars) {
    const slice = remaining.slice(0, maxChunkChars + 1);
    const breakAt = slice.lastIndexOf(" ");
    if (breakAt <= 0) {
      parts.push(remaining.slice(0, maxChunkChars));
      remaining = remaining.slice(maxChunkChars).trimStart();
      continue;
    }
    parts.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt + 1).trimStart();
  }

  if (remaining.length > 0) {
    parts.push(remaining);
  }

  return parts;
};

const flattenParagraphLines = (lines: string[]): string => {
  return lines.map((line) => line.trim()).join(" ").replace(/\s+/g, " ").trim();
};

export const chunkMarkdownNote = (input: ChunkerInput, options: ChunkerOptions = {}): ChunkRecord[] => {
  const frontmatter = parseFrontmatter(input.markdown);
  const tags = extractTagsFromMarkdown(input.markdown);
  const bodyLines = frontmatter.body.replace(/\r\n?/g, "\n").split("\n");
  const chunks: ChunkRecord[] = [];
  const headingTrail: string[] = [];
  let paragraphLines: string[] = [];
  let chunkCounter = 0;

  const pushChunk = (rawContent: string, contextKind: ChunkContextKind): void => {
    const normalizedContent = rawContent.replace(/\s+/g, " ").trim();
    if (!normalizedContent) {
      return;
    }

    const splitContent = splitByMaxChunkChars(normalizedContent, options.maxChunkChars);
    for (const content of splitContent) {
      chunkCounter += 1;
      const blockRef = `${contextKind}-${String(chunkCounter).padStart(4, "0")}`;
      const idSeed = `${input.notePath}|${headingTrail.join(">")}|${blockRef}|${content}`;
      chunks.push({
        id: stableHash(`id|${idSeed}`),
        source: {
          notePath: input.notePath,
          noteTitle: input.noteTitle,
          headingTrail: [...headingTrail],
          blockRef,
          tags,
          contextKind
        },
        content,
        hash: stableHash(`hash|${content}`),
        updatedAt: input.updatedAt
      });
    }
  };

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) {
      return;
    }
    const paragraph = flattenParagraphLines(paragraphLines);
    paragraphLines = [];
    pushChunk(paragraph, "paragraph");
  };

  for (let index = 0; index < bodyLines.length; index += 1) {
    const currentLine = bodyLines[index];
    const trimmed = currentLine.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const headingMatch = trimmed.match(HEADING_PATTERN);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length;
      const headingTitle = headingMatch[2].trim();
      headingTrail.splice(level - 1);
      headingTrail[level - 1] = headingTitle;
      continue;
    }

    const bulletMatch = currentLine.match(BULLET_PATTERN);
    if (bulletMatch) {
      flushParagraph();
      const bulletParts: string[] = [bulletMatch[3].trim()];
      let lookahead = index + 1;
      while (lookahead < bodyLines.length) {
        const nextLine = bodyLines[lookahead];
        if (!nextLine.trim()) {
          break;
        }
        if (nextLine.trim().match(HEADING_PATTERN) || nextLine.match(BULLET_PATTERN)) {
          break;
        }
        if (!/^\s+/.test(nextLine)) {
          break;
        }
        bulletParts.push(nextLine.trim());
        lookahead += 1;
      }
      pushChunk(bulletParts.join(" "), "bullet");
      index = lookahead - 1;
      continue;
    }

    paragraphLines.push(currentLine);
  }

  flushParagraph();
  return chunks;
};

// ── Hierarchical Chunker ────────────────────────────────────────────────

export interface HierarchicalChunkerOptions {
  maxParagraphChars?: number;
}

export interface HierarchicalChunkerResult {
  tree: DocumentTree;
  crossReferences: CrossReference[];
}

interface PendingBullet {
  indent: number;
  content: string;
}

const computeNodeId = (
  notePath: string,
  headingTrail: string[],
  nodeType: NodeType,
  sequenceIndex: number,
  content: string,
): string => {
  const contentPrefix = content.slice(0, 50);
  return stableHash(`node|${notePath}|${headingTrail.join(">")}|${nodeType}|${sequenceIndex}|${contentPrefix}`);
};

const computeContentHash = (content: string): string => {
  return stableHash(`hash|${content}`);
};

const extractInlineTagsFromContent = (content: string): string[] => {
  const tagSet = new Set<string>();
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let inCodeFence = false;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      continue;
    }
    for (const match of line.matchAll(INLINE_TAG_PATTERN)) {
      const normalized = normalizeTag(match[2]);
      if (normalized) {
        tagSet.add(normalized);
      }
    }
  }

  return [...tagSet].sort();
};

const buildNodeTags = (frontmatterTags: string[], inlineTags: string[]): string[] => {
  const tagSet = new Set<string>();
  for (const tag of frontmatterTags) {
    tagSet.add(tag);
  }
  for (const tag of inlineTags) {
    tagSet.add(tag);
  }
  return [...tagSet].sort();
};

const createDocumentNode = (
  notePath: string,
  noteTitle: string,
  headingTrail: string[],
  depth: number,
  nodeType: NodeType,
  content: string,
  sequenceIndex: number,
  parentId: string | null,
  frontmatterTags: string[],
  updatedAt: number,
): DocumentNode => {
  const inlineTags = extractInlineTagsFromContent(content);
  const tags = buildNodeTags(frontmatterTags, inlineTags);
  const nodeId = computeNodeId(notePath, headingTrail, nodeType, sequenceIndex, content);

  return {
    nodeId,
    parentId,
    childIds: [],
    notePath,
    noteTitle,
    headingTrail: [...headingTrail],
    depth,
    nodeType,
    content,
    sequenceIndex,
    tags,
    contentHash: computeContentHash(content),
    updatedAt,
  };
};

const addChild = (parent: DocumentNode, child: DocumentNode): void => {
  parent.childIds.push(child.nodeId);
};

export const buildDocumentTree = (
  input: ChunkerInput,
  options: HierarchicalChunkerOptions = {},
): HierarchicalChunkerResult => {
  const startTime = Date.now();
  const { notePath, noteTitle, markdown, updatedAt } = input;
  const { maxParagraphChars } = options;

  const frontmatter = parseFrontmatter(markdown);
  const fmTags = frontmatter.tags;

  const allNodes = new Map<string, DocumentNode>();
  const allCrossRefs: CrossReference[] = [];

  const registerNode = (node: DocumentNode): void => {
    allNodes.set(node.nodeId, node);
  };

  const collectCrossRefs = (node: DocumentNode): void => {
    const refs = extractWikilinks(node.content, node.nodeId);
    for (const ref of refs) {
      allCrossRefs.push(ref);
    }
  };

  const root = createDocumentNode(
    notePath, noteTitle, [], 0, "note", noteTitle, 0, null, fmTags, updatedAt,
  );
  registerNode(root);

  const bodyLines = frontmatter.body.replace(/\r\n?/g, "\n").split("\n");

  const headingStack: DocumentNode[] = [];
  let paragraphLines: string[] = [];
  let pendingBullets: PendingBullet[] = [];
  let inCodeFence = false;

  const getCurrentParent = (): DocumentNode => {
    if (headingStack.length > 0) {
      return headingStack[headingStack.length - 1];
    }
    return root;
  };

  const getChildSequenceIndex = (parent: DocumentNode): number => {
    return parent.childIds.length;
  };

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) {
      return;
    }

    const rawContent = paragraphLines.join("\n").trim();
    paragraphLines = [];

    if (!rawContent) {
      return;
    }

    const parent = getCurrentParent();
    const headingTrail = parent.nodeType === "note" ? [] : parent.headingTrail;

    if (maxParagraphChars && rawContent.length > maxParagraphChars) {
      const splits = splitBySentence(rawContent, maxParagraphChars);
      for (const split of splits) {
        const seqIdx = getChildSequenceIndex(parent);
        const paraNode = createDocumentNode(
          notePath, noteTitle, headingTrail, parent.depth + 1,
          "paragraph", split.text, seqIdx, parent.nodeId, fmTags, updatedAt,
        );
        addChild(parent, paraNode);
        registerNode(paraNode);
        collectCrossRefs(paraNode);
      }
    } else {
      const seqIdx = getChildSequenceIndex(parent);
      const paraNode = createDocumentNode(
        notePath, noteTitle, headingTrail, parent.depth + 1,
        "paragraph", rawContent, seqIdx, parent.nodeId, fmTags, updatedAt,
      );
      addChild(parent, paraNode);
      registerNode(paraNode);
      collectCrossRefs(paraNode);
    }
  };

  const flushBullets = (): void => {
    if (pendingBullets.length === 0) {
      return;
    }

    const bullets = [...pendingBullets];
    pendingBullets = [];

    const parent = getCurrentParent();
    const headingTrail = parent.nodeType === "note" ? [] : parent.headingTrail;

    const groupContent = bullets.map((b) => b.content).join("\n");
    const groupSeqIdx = getChildSequenceIndex(parent);
    const bulletGroup = createDocumentNode(
      notePath, noteTitle, headingTrail, parent.depth + 1,
      "bullet_group", groupContent, groupSeqIdx, parent.nodeId, fmTags, updatedAt,
    );
    addChild(parent, bulletGroup);
    registerNode(bulletGroup);
    collectCrossRefs(bulletGroup);

    interface BulletStackEntry {
      node: DocumentNode;
      indent: number;
    }

    const bulletStack: BulletStackEntry[] = [];

    for (const bullet of bullets) {
      const bulletParent = (() => {
        if (bullet.indent === 0) {
          return bulletGroup;
        }
        while (bulletStack.length > 0) {
          const top = bulletStack[bulletStack.length - 1];
          if (top.indent < bullet.indent) {
            return top.node;
          }
          bulletStack.pop();
        }
        return bulletGroup;
      })();

      const bulletSeqIdx = getChildSequenceIndex(bulletParent);
      const bulletNode = createDocumentNode(
        notePath, noteTitle, headingTrail, bulletParent.depth + 1,
        "bullet", bullet.content, bulletSeqIdx, bulletParent.nodeId, fmTags, updatedAt,
      );
      addChild(bulletParent, bulletNode);
      registerNode(bulletNode);
      collectCrossRefs(bulletNode);

      bulletStack.push({ node: bulletNode, indent: bullet.indent });
    }
  };

  for (const line of bodyLines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (!inCodeFence) {
        inCodeFence = true;
        paragraphLines.push(line);
        continue;
      } else {
        inCodeFence = false;
        paragraphLines.push(line);
        continue;
      }
    }

    if (inCodeFence) {
      paragraphLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushBullets();
      continue;
    }

    const headingMatch = trimmed.match(HEADING_PATTERN);
    if (headingMatch) {
      flushParagraph();
      flushBullets();

      const level = headingMatch[1].length;
      const headingTitle = headingMatch[2].trim();

      while (headingStack.length > 0) {
        const top = headingStack[headingStack.length - 1];
        if (top.depth < level) {
          break;
        }
        headingStack.pop();
      }

      const headingParent = headingStack.length > 0
        ? headingStack[headingStack.length - 1]
        : root;

      const newTrail = [...headingParent.headingTrail, headingTitle];
      if (headingParent === root) {
        newTrail.splice(0, newTrail.length, headingTitle);
      } else {
        newTrail.splice(0, newTrail.length, ...headingParent.headingTrail, headingTitle);
      }

      const nodeType: NodeType = level === 1 ? "topic" : "subtopic";
      const seqIdx = getChildSequenceIndex(headingParent);
      const headingNode = createDocumentNode(
        notePath, noteTitle, newTrail, level,
        nodeType, headingTitle, seqIdx, headingParent.nodeId, fmTags, updatedAt,
      );
      addChild(headingParent, headingNode);
      registerNode(headingNode);

      headingStack.push(headingNode);
      continue;
    }

    const bulletMatch = line.match(BULLET_PATTERN);
    if (bulletMatch) {
      flushParagraph();
      const indent = bulletMatch[1].length;
      const bulletContent = bulletMatch[3].trim();
      pendingBullets.push({ indent, content: bulletContent });
      continue;
    }

    flushBullets();
    paragraphLines.push(line);
  }

  if (inCodeFence) {
    flushParagraph();
  } else {
    flushParagraph();
    flushBullets();
  }

  const tree: DocumentTree = { root, nodes: allNodes };

  const elapsed = Date.now() - startTime;
  logger.info({
    event: "hierarchical.chunker.completed",
    message: `Built document tree for "${noteTitle}" with ${allNodes.size} nodes in ${elapsed}ms`,
    context: {
      notePath,
      nodeCount: allNodes.size,
      crossRefCount: allCrossRefs.length,
      elapsedMs: elapsed,
    },
  });

  return { tree, crossReferences: allCrossRefs };
};
