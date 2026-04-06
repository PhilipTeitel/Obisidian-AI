/**
 * Incremental index orchestration (WKF-3, ADR-008 §6).
 *
 * `IndexFilePayload.hash` must match `note_meta.content_hash` and enqueue-time hashes:
 * SHA-256 of file bytes as UTF-8, **lowercase hex** (same convention as `DocumentNode.contentHash`
 * from the chunker).
 */
import type { IndexFilePayload, NoteIndexJob } from '../domain/types.js';
import type { IDocumentStore } from '../ports/IDocumentStore.js';
import type { IJobStepPort } from '../ports/IJobStepPort.js';
import type { IQueuePort } from '../ports/IQueuePort.js';

export interface IncrementalIndexInput {
  runId: string;
  files: IndexFilePayload[];
  deletedPaths: string[];
  /** Optional display titles; default is the last path segment of each file `path`. */
  noteTitlesByPath?: Record<string, string>;
}

export interface IncrementalIndexDeps {
  store: IDocumentStore;
  queue: IQueuePort<NoteIndexJob>;
  jobSteps: IJobStepPort;
}

function noteTitleForPath(path: string, titles: Record<string, string> | undefined): string {
  if (titles?.[path]) return titles[path];
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export async function planAndApplyIncrementalIndex(
  deps: IncrementalIndexDeps,
  input: IncrementalIndexInput,
): Promise<{ enqueued: number; deleted: number; skipped: number }> {
  let enqueued = 0;
  let deleted = 0;
  let skipped = 0;

  for (const path of input.deletedPaths) {
    await deps.store.deleteNote(path);
    deps.jobSteps.deleteJobForNotePath(path);
    deleted += 1;
  }

  const titles = input.noteTitlesByPath ?? {};
  for (const f of input.files) {
    const path = f.path;
    const meta = await deps.store.getNoteMeta(path);
    if (meta?.contentHash === f.hash) {
      skipped += 1;
      continue;
    }
    const job: NoteIndexJob = {
      runId: input.runId,
      noteId: path,
      vaultPath: path,
      noteTitle: noteTitleForPath(path, titles),
      markdown: f.content,
      contentHash: f.hash,
    };
    await deps.queue.enqueue([job]);
    enqueued += 1;
  }

  if (enqueued > 0 || deleted > 0) {
    console.debug('planAndApplyIncrementalIndex', {
      runId: input.runId,
      enqueued,
      deleted,
      skipped,
    });
  }

  return { enqueued, deleted, skipped };
}
