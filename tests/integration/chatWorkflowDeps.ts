import type { IChatPort } from '@src/core/ports/IChatPort.js';
import type { IDocumentStore } from '@src/core/ports/IDocumentStore.js';
import type { IEmbeddingPort } from '@src/core/ports/IEmbeddingPort.js';
import type { ChatWorkflowDeps } from '@src/core/workflows/ChatWorkflow.js';
import { buildGroundedMessages } from '@src/sidecar/adapters/chatProviderMessages.js';

export function chatWorkflowDeps(
  store: IDocumentStore,
  embedder: IEmbeddingPort,
  chat: IChatPort,
): ChatWorkflowDeps {
  return { store, embedder, chat, buildGroundedMessages };
}
