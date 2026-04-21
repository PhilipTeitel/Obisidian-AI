/**
 * Versioned structured summary rubric (WKF-4, ADR-013). Pure strings + helpers — no sidecar / provider imports.
 */

export const SUMMARY_RUBRIC_VERSION = 'SUMMARY_RUBRIC_V1';

/** ~512-token char budget after per-field clipping (WKF-4 §9; REQ-005 open question). */
export const SUMMARY_RUBRIC_MAX_CHARS = 2048;

/** Section headers in model output (order matters for {@link clipRubricToCaps}). */
export const SUMMARY_RUBRIC_SECTION_LABELS = [
  'topics',
  'entities',
  'dates',
  'actions',
  'tags',
] as const;

const FIELD_ORDER = SUMMARY_RUBRIC_SECTION_LABELS;

/** Per-field item caps (documented inline in {@link SUMMARY_RUBRIC_V1}). */
export const SUMMARY_RUBRIC_FIELD_CAPS: Readonly<Record<(typeof FIELD_ORDER)[number], number>> = {
  topics: 10,
  entities: 15,
  dates: 15,
  actions: 15,
  tags: 50,
};

/**
 * User-message rubric: model must emit these five labeled sections once each, using `- ` list items
 * under each header. Caps are enforced in {@link clipRubricToCaps} before persistence.
 */
export const SUMMARY_RUBRIC_V1 = `You are extracting a breadth-preserving index of the subtree below for hierarchical semantic search (not narrative prose).

Output format — include every label below exactly once, in this order, with this spelling:

topics:
- (up to ${SUMMARY_RUBRIC_FIELD_CAPS.topics} short phrases, one distinct theme per line)

entities:
- (up to ${SUMMARY_RUBRIC_FIELD_CAPS.entities} names: people, orgs, products, codenames)

dates:
- (up to ${SUMMARY_RUBRIC_FIELD_CAPS.dates} absolute or relative time references)

actions:
- (up to ${SUMMARY_RUBRIC_FIELD_CAPS.actions} decisions or imperatives)

tags:
- (up to ${SUMMARY_RUBRIC_FIELD_CAPS.tags} inline or inferred tags from the subtree)

Rules:
- Prefer breadth over depth; do not collapse the subtree into narrative prose.
- Use a hyphen bullet per item; omit bullets for a section if there is nothing to list (keep the section header).
- Stay within the per-section item limits above; if there are more items, list the most important first (extras may be dropped by the indexer).`;

export type SummarizableNodeType = 'note' | 'topic' | 'subtopic';

/** Returns the rubric user instructions for node types that receive LLM summaries; null means skip (bullet_group / leaves). */
export function selectSummaryPrompt(nodeType: string): string | null {
  if (nodeType === 'note' || nodeType === 'topic' || nodeType === 'subtopic') {
    return SUMMARY_RUBRIC_V1;
  }
  return null;
}

function fieldFromLine(line: string): (typeof FIELD_ORDER)[number] | null {
  const t = line.trim();
  for (const f of FIELD_ORDER) {
    if (t === `${f}:` || t.startsWith(`${f}:`)) return f;
  }
  return null;
}

/** Drops excess `- ` list lines per rubric field; leaves other lines unchanged. */
export function clipRubricToCaps(raw: string): string {
  const lines = raw.split('\n');
  const out: string[] = [];
  let currentField: (typeof FIELD_ORDER)[number] | null = null;
  let countInField = 0;

  for (const line of lines) {
    const field = fieldFromLine(line);
    if (field) {
      currentField = field;
      countInField = 0;
      out.push(line);
      continue;
    }
    if (currentField && /^\s*-\s/.test(line)) {
      const cap = SUMMARY_RUBRIC_FIELD_CAPS[currentField];
      if (countInField < cap) {
        out.push(line);
        countInField += 1;
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

export interface TruncateSummaryResult {
  text: string;
  truncated: boolean;
  preTruncationSize: number;
}

/** Truncates at a newline or word boundary when over budget (Y5 / C1). */
export function truncateSummaryToBudget(text: string, maxChars: number): TruncateSummaryResult {
  const preTruncationSize = text.length;
  if (text.length <= maxChars) {
    return { text, truncated: false, preTruncationSize };
  }
  const slice = text.slice(0, maxChars);
  let cut = maxChars;
  const lastNl = slice.lastIndexOf('\n');
  if (lastNl > maxChars * 0.5) cut = lastNl;
  else {
    const lastSp = slice.lastIndexOf(' ');
    if (lastSp > maxChars * 0.5) cut = lastSp;
  }
  return {
    text: text.slice(0, cut).trimEnd(),
    truncated: true,
    preTruncationSize,
  };
}
