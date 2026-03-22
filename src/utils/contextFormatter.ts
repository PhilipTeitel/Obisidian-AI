import type { HierarchicalContextBlock } from "../types";

const CONTEXT_PREAMBLE = "Use only the vault context below when answering the user.";

const renderHeadingTrail = (headingTrail: string[]): string => {
  if (headingTrail.length === 0) {
    return "";
  }
  return headingTrail
    .map((heading, index) => {
      const level = "#".repeat(Math.min(index + 1, 6));
      return `${level} ${heading}`;
    })
    .join("\n");
};

const renderBlock = (block: HierarchicalContextBlock): string => {
  const parts: string[] = [];

  parts.push(`Source: ${block.notePath}`);

  const headings = renderHeadingTrail(block.headingTrail);
  if (headings.length > 0) {
    parts.push(headings);
  }

  if (block.parentSummary.length > 0) {
    parts.push(`Summary: ${block.parentSummary}`);
  }

  if (block.matchedContent.length > 0) {
    parts.push(block.matchedContent);
  }

  if (block.siblingContent.length > 0) {
    parts.push(block.siblingContent);
  }

  return parts.join("\n");
};

export const formatHierarchicalContext = (blocks: HierarchicalContextBlock[]): string => {
  if (blocks.length === 0) {
    return "";
  }

  const formatted = blocks.map(renderBlock).join("\n\n");
  return `${CONTEXT_PREAMBLE}\n\n${formatted}`;
};
