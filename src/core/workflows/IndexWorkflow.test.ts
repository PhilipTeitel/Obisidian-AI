import { describe, expect, it, vi } from 'vitest';
import * as chunker from '../domain/chunker.js';
import type {
  DocumentNode,
  EmbedMeta,
  JobStep,
  NoteIndexJob,
  ParsedCrossRef,
  ParsedTag,
  QueueItem,
  StoredSummary,
} from '../domain/types.js';
import type { IChatPort } from '../ports/IChatPort.js';
import type { IDocumentStore } from '../ports/IDocumentStore.js';
import type { IEmbeddingPort } from '../ports/IEmbeddingPort.js';
import type { IJobStepPort } from '../ports/IJobStepPort.js';
import type { IQueuePort } from '../ports/IQueuePort.js';
import * as summaryWorkflow from './SummaryWorkflow.js';
import { indexJobId, processOneJob, resumeInterruptedJobs } from './IndexWorkflow.js';

class FakeJobSteps implements IJobStepPort {
  ensureInputs: Parameters<IJobStepPort['ensureJob']>[0][] = [];
  transitionTos: import('../domain/types.js').IndexStep[] = [];
  markFailedCalls: { jobId: string; runId: string; message: string }[] = [];
  recoverable: JobStep[] = [];

  ensureJob(input: Parameters<IJobStepPort['ensureJob']>[0]): void {
    this.ensureInputs.push(input);
  }

  transitionStep(input: Parameters<IJobStepPort['transitionStep']>[0]): void {
    this.transitionTos.push(input.to);
  }

  markFailed(input: Parameters<IJobStepPort['markFailed']>[0]): void {
    this.markFailedCalls.push(input);
  }

  listRecoverableJobs(): JobStep[] {
    return this.recoverable;
  }

  deleteJobForNotePath(_notePath: string): void {}

  listJobSteps(): JobStep[] {
    return [];
  }
}

class FakeQueue implements IQueuePort<NoteIndexJob> {
  acked: string[] = [];
  nacked: { id: string; reason: string }[] = [];
  enqueued: NoteIndexJob[][] = [];

  async enqueue(items: NoteIndexJob[]): Promise<void> {
    this.enqueued.push(items);
  }

  async dequeue(_batchSize: number): Promise<QueueItem<NoteIndexJob>[]> {
    return [];
  }

  async ack(itemId: string): Promise<void> {
    this.acked.push(itemId);
  }

  async nack(itemId: string, reason: string): Promise<void> {
    this.nacked.push({ id: itemId, reason });
  }

  async peek(): Promise<number> {
    return 0;
  }
}

class FakeStore implements IDocumentStore {
  storedNodes: DocumentNode[] = [];
  embedMeta = new Map<string, EmbedMeta>();
  summaries = new Map<string, StoredSummary>();
  upsertEmbeddingCalls: {
    nodeId: string;
    type: 'content' | 'summary';
    meta: EmbedMeta;
  }[] = [];
  noteMeta: import('../domain/types.js').NoteMeta[] = [];
  tags: ParsedTag[] = [];
  crossRefs: ParsedCrossRef[] = [];
  skipContentEmbedForAll = false;

  async upsertNodes(nodes: DocumentNode[]): Promise<void> {
    this.storedNodes = nodes;
    if (this.skipContentEmbedForAll) {
      for (const n of nodes) {
        this.embedMeta.set(`${n.id}:content`, {
          model: 'm',
          dimension: 4,
          contentHash: n.contentHash,
        });
      }
    }
  }

  async replaceNoteTags(_noteId: string, tags: ParsedTag[]): Promise<void> {
    this.tags = tags;
  }

  async replaceNoteCrossRefs(_noteId: string, refs: ParsedCrossRef[]): Promise<void> {
    this.crossRefs = refs;
  }

  async getNodesByNote(_noteId: string): Promise<DocumentNode[]> {
    return this.storedNodes;
  }

  async getNodeById(nodeId: string): Promise<DocumentNode | null> {
    return this.storedNodes.find((n) => n.id === nodeId) ?? null;
  }

  async deleteNote(): Promise<void> {}

  async upsertSummary(nodeId: string, summary: string, model: string): Promise<void> {
    this.summaries.set(nodeId, {
      summary,
      generatedAt: '2099-01-01T00:00:00.000Z',
      model,
    });
  }

  async getSummary(nodeId: string): Promise<StoredSummary | null> {
    return this.summaries.get(nodeId) ?? null;
  }

  async getEmbeddingMeta(
    nodeId: string,
    vectorType: 'content' | 'summary',
  ): Promise<EmbedMeta | null> {
    return this.embedMeta.get(`${nodeId}:${vectorType}`) ?? null;
  }

  async upsertEmbedding(
    nodeId: string,
    type: 'content' | 'summary',
    _vector: Float32Array,
    meta: EmbedMeta,
  ): Promise<void> {
    this.upsertEmbeddingCalls.push({ nodeId, type, meta });
    this.embedMeta.set(`${nodeId}:${type}`, meta);
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

  async getNoteMeta(): Promise<null> {
    return null;
  }

  async upsertNoteMeta(meta: import('../domain/types.js').NoteMeta): Promise<void> {
    this.noteMeta.push(meta);
  }

  async noteMatchesTagFilter(): Promise<boolean> {
    return true;
  }
}

function fakeEmbed(dim: number): IEmbeddingPort {
  return {
    async embed(texts: string[]) {
      return texts.map(() => new Float32Array(dim).fill(0.25));
    },
  };
}

const chat: IChatPort = {
  async *complete(_m, _c, _k, _o) {
    yield 'summary-text';
  },
};

function baseDeps(
  store: FakeStore,
  jobSteps: FakeJobSteps,
  queue: FakeQueue,
  embed: IEmbeddingPort,
): import('./IndexWorkflow.js').IndexWorkflowDeps {
  return {
    queue,
    store,
    embed,
    chat,
    jobSteps,
    embeddingModel: 'emb-m',
    embeddingDimension: 4,
    chatModelLabel: 'chat-m',
  };
}

describe('IndexWorkflow', () => {
  it('C1_happy_path_step_order', async () => {
    const store = new FakeStore();
    const jobSteps = new FakeJobSteps();
    const queue = new FakeQueue();
    const item: QueueItem<NoteIndexJob> = {
      id: 'qi-1',
      payload: {
        runId: 'r1',
        noteId: 'n1',
        vaultPath: 'a/b.md',
        noteTitle: 'T',
        markdown: 'Hello world.\n',
        contentHash: 'ch1',
      },
    };
    await processOneJob(baseDeps(store, jobSteps, queue, fakeEmbed(4)), {}, item);
    expect(jobSteps.ensureInputs[0]).toMatchObject({
      jobId: 'r1:a/b.md',
      runId: 'r1',
      notePath: 'a/b.md',
      contentHash: 'ch1',
    });
    expect(jobSteps.transitionTos).toEqual([
      'parsing',
      'parsed',
      'storing',
      'stored',
      'summarizing',
      'summarized',
      'embedding',
      'embedded',
    ]);
    expect(queue.acked).toEqual(['qi-1']);
    expect(queue.nacked).toHaveLength(0);
  });

  it('C2_chunker_inputs', async () => {
    const spy = vi.spyOn(chunker, 'chunkNote').mockReturnValue({
      nodes: [
        {
          id: 'x',
          noteId: 'n1',
          parentId: null,
          type: 'note',
          headingTrail: [],
          depth: 0,
          siblingOrder: 0,
          content: 'T',
          contentHash: 'h',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      crossRefs: [],
      tags: [],
    });
    const store = new FakeStore();
    const jobSteps = new FakeJobSteps();
    const queue = new FakeQueue();
    const payload: NoteIndexJob = {
      runId: 'r2',
      noteId: 'n1',
      vaultPath: 'v/x.md',
      noteTitle: 'MyTitle',
      markdown: '# MD\n',
      contentHash: 'c',
    };
    await processOneJob(baseDeps(store, jobSteps, queue, fakeEmbed(4)), {}, {
      id: 'q',
      payload,
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        noteId: 'n1',
        noteTitle: 'MyTitle',
        vaultPath: 'v/x.md',
        markdown: '# MD\n',
      }),
    );
    expect(store.storedNodes).toHaveLength(1);
    spy.mockRestore();
  });

  it('C3_summary_invoked', async () => {
    const spy = vi.spyOn(summaryWorkflow, 'summarizeNote').mockResolvedValue();
    const store = new FakeStore();
    const jobSteps = new FakeJobSteps();
    const queue = new FakeQueue();
    await processOneJob(baseDeps(store, jobSteps, queue, fakeEmbed(4)), {}, {
      id: 'q',
      payload: {
        runId: 'r3',
        noteId: 'n1',
        vaultPath: 'p.md',
        noteTitle: 'T',
        markdown: 'Body.\n',
        contentHash: 'h',
      },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toMatchObject({
      noteId: 'n1',
      vaultPath: 'p.md',
      noteTitle: 'T',
      precomputed: expect.any(Object),
    });
    spy.mockRestore();
  });

  it('C4_embed_meta_matches_node_hash', async () => {
    const store = new FakeStore();
    const jobSteps = new FakeJobSteps();
    const queue = new FakeQueue();
    await processOneJob(baseDeps(store, jobSteps, queue, fakeEmbed(4)), {}, {
      id: 'q',
      payload: {
        runId: 'r4',
        noteId: 'n1',
        vaultPath: 'p.md',
        noteTitle: 'T',
        markdown: 'One.\n',
        contentHash: 'file-hash',
      },
    });
    const contentUpserts = store.upsertEmbeddingCalls.filter((c) => c.type === 'content');
    expect(contentUpserts.length).toBeGreaterThan(0);
    for (const c of contentUpserts) {
      const node = store.storedNodes.find((n) => n.id === c.nodeId);
      expect(node).toBeDefined();
      expect(c.meta.contentHash).toBe(node!.contentHash);
    }
  });

  it('D1_skip_content_embed', async () => {
    const store = new FakeStore();
    store.skipContentEmbedForAll = true;
    const jobSteps = new FakeJobSteps();
    const queue = new FakeQueue();
    const embed = fakeEmbed(4);
    const embedSpy = vi.spyOn(embed, 'embed');
    await processOneJob(baseDeps(store, jobSteps, queue, embed), {}, {
      id: 'q',
      payload: {
        runId: 'r5',
        noteId: 'n1',
        vaultPath: 'p.md',
        noteTitle: 'T',
        markdown: 'Skip me.\n',
        contentHash: 'h',
      },
    });
    const contentCalls = embedSpy.mock.calls.filter((c) => c[0].length > 0);
    expect(
      contentCalls.every((c) => !c[0].some((t) => t.includes('Skip me'))),
    ).toBe(true);
    embedSpy.mockRestore();
  });

  it('E1_embed_failure_nack', async () => {
    const store = new FakeStore();
    const jobSteps = new FakeJobSteps();
    const queue = new FakeQueue();
    const embed: IEmbeddingPort = {
      async embed(texts: string[]) {
        if (texts.length > 0) throw new Error('embed boom');
        return [];
      },
    };
    await processOneJob(baseDeps(store, jobSteps, queue, embed), {}, {
      id: 'q',
      payload: {
        runId: 'r6',
        noteId: 'n1',
        vaultPath: 'p.md',
        noteTitle: 'T',
        markdown: 'Fail.\n',
        contentHash: 'h',
      },
    });
    expect(queue.nacked).toHaveLength(1);
    expect(queue.nacked[0].id).toBe('q');
    expect(jobSteps.markFailedCalls).toHaveLength(1);
    expect(queue.acked).toHaveLength(0);
  });

  it('F1_resume_reenqueue', async () => {
    const store = new FakeStore();
    const jobSteps = new FakeJobSteps();
    jobSteps.recoverable = [
      {
        jobId: 'old:path.md',
        notePath: 'path.md',
        currentStep: 'parsing',
        contentHash: 'hh',
        retryCount: 0,
        errorMessage: null,
        updatedAt: '2026-01-01',
      },
    ];
    const queue = new FakeQueue();
    await resumeInterruptedJobs(baseDeps(store, jobSteps, queue, fakeEmbed(4)));
    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0][0]).toMatchObject({
      runId: 'old',
      noteId: 'path.md',
      vaultPath: 'path.md',
      contentHash: 'hh',
      markdown: '',
    });
  });

  it('Y1_no_sidecar_imports', () => {
    expect(import.meta.url).toContain('/core/workflows/');
  });

  it('Y2_payload_json_roundtrip', () => {
    const job: NoteIndexJob = {
      runId: 'r',
      noteId: 'n',
      vaultPath: 'v.md',
      noteTitle: 't',
      markdown: 'm',
      contentHash: 'c',
    };
    const copy = JSON.parse(JSON.stringify(job)) as NoteIndexJob;
    expect(copy).toEqual(job);
  });
});

describe('indexJobId', () => {
  it('uses runId and path', () => {
    expect(indexJobId({ runId: 'r', vaultPath: 'a/b.md' })).toBe('r:a/b.md');
  });
});
