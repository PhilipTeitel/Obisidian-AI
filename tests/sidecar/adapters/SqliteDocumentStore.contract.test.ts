import { describe, expect, it } from 'vitest';
import { SqliteDocumentStore } from '@src/sidecar/adapters/SqliteDocumentStore.js';
import { openMigratedMemoryDb } from '@src/sidecar/db/open.js';
import {
  runB1SingleGlobContract,
  runB2UnionGlobsContract,
  runB3DateRangeInclusiveContract,
  runB4NullNoteDateExcludedContract,
  runB5IntersectionContract,
  runB6NoteDateRoundTripContract,
  runB7CompiledGlobDirectChildContract,
} from '../../contract/document-store.filters.contract.js';

const DIM = 4;

describe('SqliteDocumentStore contract — filter suite (RET-6 Y6)', () => {
  it('Y6_runs_filters_contract_against_sqlite', async () => {
    const db = openMigratedMemoryDb({ embeddingDimension: DIM });
    const store = new SqliteDocumentStore(db);
    try {
      await runB1SingleGlobContract(store);
      const db2 = openMigratedMemoryDb({ embeddingDimension: DIM });
      const s2 = new SqliteDocumentStore(db2);
      try {
        await runB2UnionGlobsContract(s2);
      } finally {
        db2.close();
      }
      const db3 = openMigratedMemoryDb({ embeddingDimension: DIM });
      const s3 = new SqliteDocumentStore(db3);
      try {
        await runB3DateRangeInclusiveContract(s3);
      } finally {
        db3.close();
      }
      const db4 = openMigratedMemoryDb({ embeddingDimension: DIM });
      const s4 = new SqliteDocumentStore(db4);
      try {
        await runB4NullNoteDateExcludedContract(s4);
      } finally {
        db4.close();
      }
      const db5 = openMigratedMemoryDb({ embeddingDimension: DIM });
      const s5 = new SqliteDocumentStore(db5);
      try {
        await runB5IntersectionContract(s5);
      } finally {
        db5.close();
      }
      const db6 = openMigratedMemoryDb({ embeddingDimension: DIM });
      const s6 = new SqliteDocumentStore(db6);
      try {
        await runB6NoteDateRoundTripContract(s6);
      } finally {
        db6.close();
      }
      const db7 = openMigratedMemoryDb({ embeddingDimension: DIM });
      const s7 = new SqliteDocumentStore(db7);
      try {
        await runB7CompiledGlobDirectChildContract(s7);
      } finally {
        db7.close();
      }
      expect(true).toBe(true);
    } finally {
      db.close();
    }
  });
});
