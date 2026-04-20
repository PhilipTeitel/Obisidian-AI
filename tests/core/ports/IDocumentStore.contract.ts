import { expect } from 'vitest';
import type { DocumentNode } from '@src/core/domain/types.js';
import { SUMMARY_RUBRIC_VERSION } from '@src/core/domain/summaryPrompts.js';
import type { IDocumentStore } from '@src/core/ports/IDocumentStore.js';

function sampleNode(overrides: Partial<DocumentNode> = {}): DocumentNode {
  return {
    id: 'n_contract',
    noteId: 'note_contract',
    parentId: null,
    type: 'note',
    headingTrail: [],
    depth: 0,
    siblingOrder: 0,
    content: 'contract body',
    contentHash: 'h_contract',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Assert `promptVersion` round-trips for any {@link IDocumentStore} implementation (WKF-4 Y8). */
export async function assertPromptVersionRoundTrip(store: IDocumentStore): Promise<void> {
  await store.upsertNodes([sampleNode()]);
  const v = 'custom_prompt_v_test';
  await store.upsertSummary('n_contract', 'summary body', 'model-z', v);
  const row = await store.getSummary('n_contract');
  expect(row?.summary).toBe('summary body');
  expect(row?.promptVersion).toBe(v);
  await store.upsertSummary('n_contract', 'summary body', 'model-z', SUMMARY_RUBRIC_VERSION);
  const row2 = await store.getSummary('n_contract');
  expect(row2?.promptVersion).toBe(SUMMARY_RUBRIC_VERSION);
}
