import type { ChunkContextKind, ChunkRecord, ChunkerInput, ChunkerOptions } from "../types";

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
