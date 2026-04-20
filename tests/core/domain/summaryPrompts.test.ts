import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SUMMARY_RUBRIC_SECTION_LABELS,
  SUMMARY_RUBRIC_V1,
  SUMMARY_RUBRIC_VERSION,
  clipRubricToCaps,
  selectSummaryPrompt,
} from '@src/core/domain/summaryPrompts.js';

const sourcePath = fileURLToPath(new URL('../../../src/core/domain/summaryPrompts.ts', import.meta.url));

describe('summaryPrompts', () => {
  it('B1_rubric_headers_and_caps', () => {
    for (const label of SUMMARY_RUBRIC_SECTION_LABELS) {
      const re = new RegExp(`^${label}:`, 'm');
      expect(SUMMARY_RUBRIC_V1.match(re)?.length ?? 0).toBe(1);
    }
    expect(SUMMARY_RUBRIC_V1).toMatch(/up to \d+ short phrases/);
    expect(SUMMARY_RUBRIC_V1).toMatch(/up to \d+ names/);
    expect(SUMMARY_RUBRIC_V1).not.toMatch(/2[–-]4/);
    expect(SUMMARY_RUBRIC_V1.toLowerCase()).not.toMatch(/\nlocations:\s*/);
  });

  it('Y3_label_set_pinned', () => {
    expect(SUMMARY_RUBRIC_SECTION_LABELS).toEqual([
      'topics',
      'entities',
      'dates',
      'actions',
      'tags',
    ]);
    expect(SUMMARY_RUBRIC_VERSION).toBe('SUMMARY_RUBRIC_V1');
    const src = readFileSync(sourcePath, 'utf8');
    const exportMatch = src.match(/export const SUMMARY_RUBRIC_VERSION = '([^']+)';/);
    expect(exportMatch?.[1]).toBe('SUMMARY_RUBRIC_V1');
  });

  it('selectSummaryPrompt bullet_group and leaves', () => {
    expect(selectSummaryPrompt('note')).toBe(SUMMARY_RUBRIC_V1);
    expect(selectSummaryPrompt('topic')).toBe(SUMMARY_RUBRIC_V1);
    expect(selectSummaryPrompt('subtopic')).toBe(SUMMARY_RUBRIC_V1);
    expect(selectSummaryPrompt('bullet_group')).toBeNull();
    expect(selectSummaryPrompt('paragraph')).toBeNull();
  });

  it('clipRubricToCaps drops excess bullets', () => {
    const topics = Array.from({ length: 15 }, (_, i) => `- t${i}`).join('\n');
    const raw = `topics:\n${topics}\n\nentities:\n- only\n`;
    const clipped = clipRubricToCaps(raw);
    const topicLines = clipped.split('\n').filter((l) => /^\s*-\s/.test(l) && clipped.indexOf(l) < clipped.indexOf('entities:'));
    expect(topicLines.length).toBeLessThanOrEqual(10);
  });
});
