/**
 * Per-note indexing state machine (WKF-2, ADR-007 / ADR-008).
 *
 * Content embeddings: batched via `IEmbeddingPort.embed` (single batch per pass for all nodes
 * that need new content vectors). Summary vectors: second batch for non-leaf summaries whose
 * hash (SHA-256 of summary text) does not match stored `embedding_meta.content_hash`.
 */
import { chunkNote } from '../domain/chunker.js';
import { parseDailyNoteDate } from '../domain/dailyNoteDate.js';
import { hashText } from '../domain/hashText.js';
import { vaultPathMatchesAnyGlob } from '../domain/pathGlob.js';
import type { DocumentNode, NoteIndexJob, QueueItem } from '../domain/types.js';
import type { IChatPort } from '../ports/IChatPort.js';
import type { IDocumentStore } from '../ports/IDocumentStore.js';
import type { IEmbeddingPort } from '../ports/IEmbeddingPort.js';
import type { IJobStepPort } from '../ports/IJobStepPort.js';
import type { IQueuePort } from '../ports/IQueuePort.js';
import { summarizeNote } from './SummaryWorkflow.js';

export interface IndexWorkflowDeps {
  queue: IQueuePort<NoteIndexJob>;
  store: IDocumentStore;
  embed: IEmbeddingPort;
  chat: IChatPort;
  jobSteps: IJobStepPort;
  embeddingModel: string;
  embeddingDimension: number;
  chatModelLabel: string;
}

export function indexJobId(job: Pick<NoteIndexJob, 'runId' | 'vaultPath'>): string {
  return `${job.runId}:${job.vaultPath}`;
}

/** `job_id` format is `<runId>:<vaultPath>` (first `:` separates run). */
export function runIdFromJobId(jobId: string): string {
  const i = jobId.indexOf(':');
  if (i <= 0) return 'recovery';
  return jobId.slice(0, i);
}

const DEFAULT_DAILY_NOTE_GLOBS = ['Daily/**/*.md'] as const;

function stemFromVaultPath(vaultPath: string): string {
  const base = vaultPath.split('/').pop() ?? vaultPath;
  const dot = base.lastIndexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
}

function resolveNoteDateForJob(job: NoteIndexJob): string | null {
  const globs =
    job.dailyNotePathGlobs && job.dailyNotePathGlobs.length > 0
      ? job.dailyNotePathGlobs
      : [...DEFAULT_DAILY_NOTE_GLOBS];
  const pattern = job.dailyNoteDatePattern ?? 'YYYY-MM-DD';
  if (!vaultPathMatchesAnyGlob(job.vaultPath, globs)) return null;
  return parseDailyNoteDate(stemFromVaultPath(job.vaultPath), pattern);
}

function isNonLeaf(nodes: DocumentNode[], nodeId: string): boolean {
  return nodes.some((n) => n.parentId === nodeId);
}

function assertEmbeddingBatch(
  vectors: Float32Array[],
  ids: string[],
  expectedDimension: number,
  label: 'content' | 'summary',
): void {
  if (vectors.length !== ids.length) {
    throw new Error(
      `${label} embeddings: provider returned ${vectors.length} vectors for ${ids.length} inputs`,
    );
  }
  for (let i = 0; i < vectors.length; i++) {
    const vector = vectors[i];
    if (vector.length !== expectedDimension) {
      throw new Error(
        `${label} embeddings: node ${ids[i]} expected length ${expectedDimension}, got ${vector.length}`,
      );
    }
  }
}

export async function processOneJob(
  deps: IndexWorkflowDeps,
  ctx: { apiKey?: string },
  item: QueueItem<NoteIndexJob>,
): Promise<void> {
  const job = item.payload;
  const jid = indexJobId(job);
  const runId = job.runId;
  let ensured = false;
  try {
    deps.jobSteps.ensureJob({
      jobId: jid,
      runId,
      notePath: job.vaultPath,
      contentHash: job.contentHash,
    });
    ensured = true;

    deps.jobSteps.transitionStep({ jobId: jid, runId, to: 'parsing' });
    const parsed = chunkNote({
      noteId: job.noteId,
      noteTitle: job.noteTitle,
      vaultPath: job.vaultPath,
      markdown: job.markdown,
    });
    deps.jobSteps.transitionStep({ jobId: jid, runId, to: 'parsed' });

    deps.jobSteps.transitionStep({ jobId: jid, runId, to: 'storing' });
    await deps.store.upsertNodes(parsed.nodes);
    await deps.store.replaceNoteTags(job.noteId, parsed.tags);
    await deps.store.replaceNoteCrossRefs(job.noteId, parsed.crossRefs);
    const now = new Date().toISOString();
    await deps.store.upsertNoteMeta({
      noteId: job.noteId,
      vaultPath: job.vaultPath,
      contentHash: job.contentHash,
      indexedAt: now,
      nodeCount: parsed.nodes.length,
      noteDate: resolveNoteDateForJob(job),
    });
    deps.jobSteps.transitionStep({ jobId: jid, runId, to: 'stored' });

    deps.jobSteps.transitionStep({ jobId: jid, runId, to: 'summarizing' });
    await summarizeNote(
      { chat: deps.chat, store: deps.store },
      {
        noteId: job.noteId,
        vaultPath: job.vaultPath,
        noteTitle: job.noteTitle,
        markdown: job.markdown,
        chatModelLabel: deps.chatModelLabel,
        apiKey: ctx.apiKey,
        precomputed: parsed,
      },
    );
    deps.jobSteps.transitionStep({ jobId: jid, runId, to: 'summarized' });

    deps.jobSteps.transitionStep({ jobId: jid, runId, to: 'embedding' });

    const contentTexts: string[] = [];
    const contentIds: string[] = [];
    const idToNode = new Map(parsed.nodes.map((n) => [n.id, n]));
    for (const n of parsed.nodes) {
      const meta = await deps.store.getEmbeddingMeta(n.id, 'content');
      if (meta?.contentHash === n.contentHash) continue;
      contentTexts.push(n.content);
      contentIds.push(n.id);
    }
    if (contentTexts.length > 0) {
      const vecs = await deps.embed.embed(contentTexts, ctx.apiKey);
      assertEmbeddingBatch(vecs, contentIds, deps.embeddingDimension, 'content');
      for (let i = 0; i < contentIds.length; i++) {
        const nid = contentIds[i];
        const node = idToNode.get(nid);
        if (!node) continue;
        await deps.store.upsertEmbedding(nid, 'content', vecs[i], {
          model: deps.embeddingModel,
          dimension: deps.embeddingDimension,
          contentHash: node.contentHash,
        });
      }
    }

    const summaryTexts: string[] = [];
    const summaryIds: string[] = [];
    for (const n of parsed.nodes) {
      if (!isNonLeaf(parsed.nodes, n.id)) continue;
      const row = await deps.store.getSummary(n.id);
      if (!row) continue;
      const h = hashText(row.summary);
      const meta = await deps.store.getEmbeddingMeta(n.id, 'summary');
      if (meta?.contentHash === h) continue;
      summaryTexts.push(row.summary);
      summaryIds.push(n.id);
    }
    if (summaryTexts.length > 0) {
      const vecs = await deps.embed.embed(summaryTexts, ctx.apiKey);
      assertEmbeddingBatch(vecs, summaryIds, deps.embeddingDimension, 'summary');
      for (let i = 0; i < summaryIds.length; i++) {
        const nid = summaryIds[i];
        const row = await deps.store.getSummary(nid);
        if (!row) continue;
        await deps.store.upsertEmbedding(nid, 'summary', vecs[i], {
          model: deps.embeddingModel,
          dimension: deps.embeddingDimension,
          contentHash: hashText(row.summary),
        });
      }
    }

    deps.jobSteps.transitionStep({ jobId: jid, runId, to: 'embedded' });
    await deps.queue.ack(item.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('IndexWorkflow: job failed', { jobId: jid, error: msg });
    if (ensured) {
      deps.jobSteps.markFailed({ jobId: jid, runId, message: msg });
    }
    await deps.queue.nack(item.id, msg);
  }
}

/**
 * Re-queue jobs that were interrupted (ADR-008). Payloads omit `markdown`; caller must refill
 * before processing or re-fetch from vault (WKF-3).
 */
export async function resumeInterruptedJobs(deps: IndexWorkflowDeps): Promise<void> {
  const jobs = deps.jobSteps.listRecoverableJobs();
  if (jobs.length === 0) return;
  const payloads: NoteIndexJob[] = jobs.map((j) => ({
    runId: runIdFromJobId(j.jobId),
    noteId: j.notePath,
    vaultPath: j.notePath,
    noteTitle: j.notePath.split('/').pop() ?? j.notePath,
    markdown: '',
    contentHash: j.contentHash,
  }));
  await deps.queue.enqueue(payloads);
}
