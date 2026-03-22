import type { CrossReference } from "../types";
import { createRuntimeLogger } from "../logging/runtimeLogger";

const logger = createRuntimeLogger("wikilinkParser");

const WIKILINK_RE = /\[\[([^\]]+?)\]\]/g;
const CODE_FENCE_RE = /^```/;

function stripInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, "");
}

export function extractWikilinks(
  content: string,
  sourceNodeId: string,
): CrossReference[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const lines = content.split("\n");
  const seen = new Set<string>();
  const results: CrossReference[] = [];
  let insideCodeFence = false;

  for (const line of lines) {
    if (CODE_FENCE_RE.test(line.trimStart())) {
      insideCodeFence = !insideCodeFence;
      continue;
    }

    if (insideCodeFence) {
      continue;
    }

    const sanitized = stripInlineCode(line);
    let match: RegExpExecArray | null;
    WIKILINK_RE.lastIndex = 0;

    while ((match = WIKILINK_RE.exec(sanitized)) !== null) {
      const inner = match[1];

      const pipeIndex = inner.indexOf("|");
      const targetPath = pipeIndex === -1 ? inner : inner.slice(0, pipeIndex);
      const targetDisplay =
        pipeIndex === -1 ? null : inner.slice(pipeIndex + 1);

      if (targetPath.trim().length === 0) {
        continue;
      }

      if (seen.has(targetPath)) {
        continue;
      }

      seen.add(targetPath);
      results.push({ sourceNodeId, targetPath, targetDisplay });
    }
  }

  logger.debug({
    event: "wikilink.extraction.completed",
    message: `Extracted ${results.length} unique wikilinks from content`,
    context: {
      sourceNodeId,
      contentLength: content.length,
      wikilinkCount: results.length,
    },
  });

  return results;
}
