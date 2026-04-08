import { describe, expect, it } from 'vitest';
import type { NoteIndexJob, NoteMeta } from '@src/core/domain/types.js';
import type { IDocumentStore } from '@src/core/ports/IDocumentStore.js';
import type { IJobStepPort } from '@src/core/ports/IJobStepPort.js';
import type { IQueuePort } from '@src/core/ports/IQueuePort.js';
import { planAndApplyIncrementalIndex } from '@src/core/workflows/IncrementalIndexPlanner.js';

class PlannerFakeStore implements IDocumentStore {
  noteMeta = new Map<string, NoteMeta>();
  deleted: string[] = [];

  seedMeta(m: NoteMeta): void {
    this.noteMeta.set(m.noteId, m);
  }

  async upsertNodes(): Promise<void> {
    throw new Error('unused');
  }

  async replaceNoteTags(): Promise<void> {
    throw new Error('unused');
  }

  async replaceNoteCrossRefs(): Promise<void> {
    throw new Error('unused');
  }

  async getNodesByNote(): Promise<[]> {
    return [];
  }

  async getNodeById(): Promise<null> {
    return null;
  }

  async deleteNote(noteId: string): Promise<void> {
    this.deleted.push(noteId);
    this.noteMeta.delete(noteId);
  }

  async upsertSummary(): Promise<void> {
    throw new Error('unused');
  }

  async getSummary(): Promise<null> {
    return null;
  }

  async getEmbeddingMeta(): Promise<null> {
    return null;
  }

  async upsertEmbedding(): Promise<void> {
    throw new Error('unused');
  }

  async searchSummaryVectors(): Promise<[]> {
    return [];
  }

  async searchContentVectors(): Promise<[]> {
    return [];
  }

  async getAncestors(): Promise<[]> {
    return [];
  }

  async getSiblings(): Promise<[]> {
    return [];
  }

  async getNoteMeta(noteId: string): Promise<NoteMeta | null> {
    return this.noteMeta.get(noteId) ?? null;
  }

  async upsertNoteMeta(): Promise<void> {
    throw new Error('unused');
  }

  async noteMatchesTagFilter(): Promise<boolean> {
    return true;
  }
}

class PlannerFakeQueue implements IQueuePort<NoteIndexJob> {
  batches: NoteIndexJob[][] = [];

  async enqueue(items: NoteIndexJob[]): Promise<void> {
    this.batches.push(items);
  }

  async dequeue(): Promise<[]> {
    return [];
  }

  async ack(): Promise<void> {}

  async nack(): Promise<void> {}

  async peek(): Promise<number> {
    return 0;
  }
}

class PlannerFakeJobSteps implements IJobStepPort {
  deletedPaths: string[] = [];

  ensureJob(): void {}

  transitionStep(): void {}

  markFailed(): void {}

  listRecoverableJobs() {
    return [];
  }

  deleteJobForNotePath(notePath: string): void {
    this.deletedPaths.push(notePath);
  }

  listJobSteps() {
    return [];
  }
}

describe('IncrementalIndexPlanner', () => {
  it('A1_skip_unchanged', async () => {
    const store = new PlannerFakeStore();
    store.seedMeta({
      noteId: 'a.md',
      vaultPath: 'a.md',
      contentHash: 'same',
      indexedAt: 't',
      nodeCount: 1,
    });
    const queue = new PlannerFakeQueue();
    const jobSteps = new PlannerFakeJobSteps();
    const r = await planAndApplyIncrementalIndex(
      { store, queue, jobSteps },
      {
        runId: 'r',
        files: [{ path: 'a.md', content: 'x', hash: 'same' }],
        deletedPaths: [],
      },
    );
    expect(r.skipped).toBe(1);
    expect(r.enqueued).toBe(0);
    expect(queue.batches).toHaveLength(0);
  });

  it('A2_enqueue_changed', async () => {
    const store = new PlannerFakeStore();
    store.seedMeta({
      noteId: 'b.md',
      vaultPath: 'b.md',
      contentHash: 'old',
      indexedAt: 't',
      nodeCount: 1,
    });
    const queue = new PlannerFakeQueue();
    const jobSteps = new PlannerFakeJobSteps();
    const r = await planAndApplyIncrementalIndex(
      { store, queue, jobSteps },
      {
        runId: 'r',
        files: [{ path: 'b.md', content: 'new body', hash: 'newhash' }],
        deletedPaths: [],
      },
    );
    expect(r.enqueued).toBe(1);
    expect(r.skipped).toBe(0);
    expect(queue.batches).toHaveLength(1);
    expect(queue.batches[0]).toHaveLength(1);
    expect(queue.batches[0][0]).toMatchObject({
      runId: 'r',
      noteId: 'b.md',
      vaultPath: 'b.md',
      contentHash: 'newhash',
      markdown: 'new body',
    });
  });

  it('A2b_force_reindex_unchanged', async () => {
    const store = new PlannerFakeStore();
    store.seedMeta({
      noteId: 'same.md',
      vaultPath: 'same.md',
      contentHash: 'samehash',
      indexedAt: 't',
      nodeCount: 1,
    });
    const queue = new PlannerFakeQueue();
    const jobSteps = new PlannerFakeJobSteps();
    const r = await planAndApplyIncrementalIndex(
      { store, queue, jobSteps },
      {
        runId: 'r',
        files: [{ path: 'same.md', content: 'body', hash: 'samehash' }],
        deletedPaths: [],
        forceReindex: true,
      },
    );
    expect(r.enqueued).toBe(1);
    expect(r.skipped).toBe(0);
    expect(queue.batches).toHaveLength(1);
  });

  it('A3_enqueue_new_note', async () => {
    const store = new PlannerFakeStore();
    const queue = new PlannerFakeQueue();
    const jobSteps = new PlannerFakeJobSteps();
    const r = await planAndApplyIncrementalIndex(
      { store, queue, jobSteps },
      {
        runId: 'r',
        files: [{ path: 'new.md', content: 'c', hash: 'h1' }],
        deletedPaths: [],
      },
    );
    expect(r.enqueued).toBe(1);
    expect(queue.batches[0][0].noteId).toBe('new.md');
  });

  it('B1_delete_note_store', async () => {
    const store = new PlannerFakeStore();
    const queue = new PlannerFakeQueue();
    const jobSteps = new PlannerFakeJobSteps();
    await planAndApplyIncrementalIndex(
      { store, queue, jobSteps },
      {
        runId: 'r',
        files: [],
        deletedPaths: ['gone.md'],
      },
    );
    expect(store.deleted).toEqual(['gone.md']);
    expect(jobSteps.deletedPaths).toEqual(['gone.md']);
  });

  it('Y1_core_only', () => {
    expect(import.meta.url).toContain('/tests/core/workflows/');
  });
});
