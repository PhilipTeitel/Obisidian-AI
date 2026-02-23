const normalizeLineEndings = (value: string): string => value.replace(/\r\n?/g, "\n");

export const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const hashNormalizedMarkdown = (markdown: string): string => {
  return stableHash(normalizeLineEndings(markdown));
};
