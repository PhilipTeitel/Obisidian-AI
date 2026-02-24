import type { SearchResult } from "../types";

const normalizeHeadingAnchor = (heading: string | undefined): string | null => {
  if (!heading) {
    return null;
  }
  const trimmed = heading.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const buildSearchResultLink = (result: Pick<SearchResult, "notePath" | "heading">): string => {
  const heading = normalizeHeadingAnchor(result.heading);
  if (!heading) {
    return result.notePath;
  }
  return `${result.notePath}#${heading}`;
};
