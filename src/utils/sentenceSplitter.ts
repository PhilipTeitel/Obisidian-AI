import { createRuntimeLogger } from "../logging/runtimeLogger";

const logger = createRuntimeLogger("sentenceSplitter");

export interface SentenceSplit {
  text: string;
  sequenceIndex: number;
}

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt",
  "dept", "corp", "inc", "ltd", "vs", "approx", "est",
  "vol", "rev", "gen", "gov", "sgt", "cpl", "pvt",
  "fig", "eq", "no", "op",
]);

const MULTI_PERIOD_ABBREVS = ["e.g", "i.e", "etc", "a.m", "p.m"];

const SENTINEL = "\uE000";
const URL_PLACEHOLDER_PREFIX = `${SENTINEL}URL`;
const ABBREV_PLACEHOLDER_PREFIX = `${SENTINEL}ABBR`;
const ELLIPSIS_PLACEHOLDER = `${SENTINEL}ELLIPSIS${SENTINEL}`;

function protectSpecialPatterns(
  content: string,
): { protected: string; urls: string[]; abbrevs: string[] } {
  let text = content;
  const urls: string[] = [];
  const abbrevs: string[] = [];

  text = text.replace(/https?:\/\/[^\s)]+/g, (match) => {
    const idx = urls.length;
    urls.push(match);
    return `${URL_PLACEHOLDER_PREFIX}${idx}${SENTINEL}`;
  });

  text = text.replace(/ftp:\/\/[^\s)]+/g, (match) => {
    const idx = urls.length;
    urls.push(match);
    return `${URL_PLACEHOLDER_PREFIX}${idx}${SENTINEL}`;
  });

  text = text.replace(/\.{3,}/g, ELLIPSIS_PLACEHOLDER);

  for (const abbrev of MULTI_PERIOD_ABBREVS) {
    const escaped = abbrev.replace(/\./g, "\\.");
    const regex = new RegExp(`${escaped}\\.`, "gi");
    text = text.replace(regex, (match) => {
      const idx = abbrevs.length;
      abbrevs.push(match);
      return `${ABBREV_PLACEHOLDER_PREFIX}${idx}${SENTINEL}`;
    });
  }

  return { protected: text, urls, abbrevs };
}

function restorePlaceholders(
  text: string,
  urls: string[],
  abbrevs: string[],
): string {
  let restored = text;

  for (let i = 0; i < urls.length; i++) {
    restored = restored.replace(`${URL_PLACEHOLDER_PREFIX}${i}${SENTINEL}`, urls[i]);
  }

  for (let i = 0; i < abbrevs.length; i++) {
    restored = restored.replace(
      `${ABBREV_PLACEHOLDER_PREFIX}${i}${SENTINEL}`,
      abbrevs[i],
    );
  }

  restored = restored.replaceAll(ELLIPSIS_PLACEHOLDER, "...");

  return restored;
}

function isAbbreviation(text: string, periodIndex: number): boolean {
  let wordStart = periodIndex - 1;
  while (wordStart >= 0 && /[a-zA-Z]/.test(text[wordStart])) {
    wordStart--;
  }
  const word = text.slice(wordStart + 1, periodIndex).toLowerCase();
  if (ABBREVIATIONS.has(word)) {
    return true;
  }

  if (periodIndex > 0 && /\d/.test(text[periodIndex - 1])) {
    if (periodIndex + 1 < text.length && /\d/.test(text[periodIndex + 1])) {
      return true;
    }
  }

  if (wordStart >= 0 && text[wordStart] === "$") {
    if (periodIndex + 1 < text.length && /\d/.test(text[periodIndex + 1])) {
      return true;
    }
  }

  return false;
}

function splitIntoSentences(content: string): string[] {
  const { protected: protectedText, urls, abbrevs } =
    protectSpecialPatterns(content);

  const sentences: string[] = [];
  let current = "";

  for (let i = 0; i < protectedText.length; i++) {
    const ch = protectedText[i];
    current += ch;

    if (ch === "." || ch === "!" || ch === "?") {
      if (ch === "." && isAbbreviation(protectedText, i)) {
        continue;
      }

      const nextChar = i + 1 < protectedText.length ? protectedText[i + 1] : null;
      if (nextChar === null || /\s/.test(nextChar)) {
        const restored = restorePlaceholders(current.trim(), urls, abbrevs);
        if (restored.length > 0) {
          sentences.push(restored);
        }
        current = "";
      }
    }
  }

  const remaining = restorePlaceholders(current.trim(), urls, abbrevs);
  if (remaining.length > 0) {
    sentences.push(remaining);
  }

  return sentences;
}

export function splitBySentence(
  content: string,
  maxChunkChars: number,
): SentenceSplit[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const trimmed = content.trim();

  if (trimmed.length <= maxChunkChars) {
    return [{ text: trimmed, sequenceIndex: 0 }];
  }

  const sentences = splitIntoSentences(trimmed);

  if (sentences.length === 0) {
    return [];
  }

  const chunks: SentenceSplit[] = [];
  let currentChunk = "";
  let sequenceIndex = 0;

  for (const sentence of sentences) {
    if (currentChunk.length === 0) {
      currentChunk = sentence;
      continue;
    }

    const combined = `${currentChunk} ${sentence}`;
    if (combined.length <= maxChunkChars) {
      currentChunk = combined;
    } else {
      chunks.push({ text: currentChunk, sequenceIndex });
      sequenceIndex++;
      currentChunk = sentence;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push({ text: currentChunk, sequenceIndex });
  }

  logger.debug({
    event: "sentence.split.completed",
    message: `Split content into ${chunks.length} chunks from ${sentences.length} sentences`,
    context: {
      inputLength: trimmed.length,
      sentenceCount: sentences.length,
      chunkCount: chunks.length,
      maxChunkChars,
    },
  });

  return chunks;
}
