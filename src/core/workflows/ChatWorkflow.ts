import { DEFAULT_SEARCH_ASSEMBLY, validateSearchAssemblyOptions } from '../domain/contextAssembly.js';
import type { ChatMessage, SearchAssemblyOptions, Source } from '../domain/types.js';
import type { ChatCompletionOptions, IChatPort } from '../ports/IChatPort.js';
import type { SearchWorkflowDeps } from './SearchWorkflow.js';
import { withChatCompletionControls } from './chatStreamGuard.js';
import { DEFAULT_SEARCH_K, runSearch } from './SearchWorkflow.js';

/**
 * Sidecar-computed RAG chat: retrieval uses the same path as semantic search (`runSearch`, ADR-003 / RET-1–2).
 */
export interface ChatWorkflowDeps extends SearchWorkflowDeps {
  chat: IChatPort;
}

export interface ChatWorkflowOptions {
  search?: SearchAssemblyOptions;
  apiKey?: string;
  k?: number;
  tags?: string[];
  pathGlobs?: string[];
  dateRange?: { start?: string; end?: string };
  coarseK?: number;
  enableHybridSearch?: boolean;
  /** ADR-009: passed through to chat streaming guard + `IChatPort.complete`. */
  completion?: ChatCompletionOptions;
}

export interface ChatWorkflowResult {
  sources: Source[];
}

function lastUserContent(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'user') {
      const t = m.content.trim();
      return t.length > 0 ? t : null;
    }
  }
  return null;
}

/**
 * Vault-only RAG: embed + phased ANN + assembly via `runSearch`, then stream `IChatPort.complete`.
 */
export async function* runChatStream(
  deps: ChatWorkflowDeps,
  messages: ChatMessage[],
  options: ChatWorkflowOptions,
): AsyncGenerator<string, ChatWorkflowResult> {
  const query = lastUserContent(messages);
  if (query === null) {
    throw new Error('ChatWorkflow: no user message with non-empty content');
  }

  const searchAssembly = options.search ?? DEFAULT_SEARCH_ASSEMBLY;
  validateSearchAssemblyOptions(searchAssembly);

  const searchRes = await runSearch(
    deps,
    {
      query,
      apiKey: options.apiKey,
      k: options.k ?? DEFAULT_SEARCH_K,
      tags: options.tags,
      pathGlobs: options.pathGlobs,
      dateRange: options.dateRange,
      coarseK: options.coarseK,
      enableHybridSearch: options.enableHybridSearch,
    },
    searchAssembly,
  );

  const context =
    searchRes.results.length > 0 ? searchRes.results.map((r) => r.snippet).join('\n\n---\n\n') : '';

  const stream = deps.chat.complete(messages, context, options.apiKey, options.completion);
  for await (const delta of withChatCompletionControls(stream, options.completion)) {
    yield delta;
  }

  const sources: Source[] = searchRes.results.map((r) => ({
    notePath: r.notePath,
    nodeId: r.nodeId,
  }));

  return { sources };
}
