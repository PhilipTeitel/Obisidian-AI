import { describe, it } from 'vitest';
import { assertPromptVersionRoundTrip } from '../../core/ports/IDocumentStore.contract.js';
import { SqliteDocumentStore } from '@src/sidecar/adapters/SqliteDocumentStore.js';
import { openMigratedMemoryDb } from '@src/sidecar/db/open.js';

describe('IDocumentStore promptVersion contract', () => {
  it('promptVersion_round_trip', async () => {
    const db = openMigratedMemoryDb({ embeddingDimension: 4 });
    const store = new SqliteDocumentStore(db);
    try {
      await assertPromptVersionRoundTrip(store);
    } finally {
      db.close();
    }
  });
});
