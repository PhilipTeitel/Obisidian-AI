import { DEFAULT_SEARCH_ASSEMBLY, validateSearchAssemblyOptions } from '../domain/contextAssembly.js';
import type {
  BuildGroundedMessagesHooks,
  ChatMessage,
  GroundingContext,
  GroundingOutcome,
  SearchAssemblyOptions,
  Source,
} from '../domain/types.js';
import { CHAT_GROUNDING_POLICY_WIRE_VERSION } from '../domain/types.js';
import type { ChatCompletionOptions, IChatPort } from '../ports/IChatPort.js';
import type { SearchWorkflowDeps } from './SearchWorkflow.js';
import { withChatCompletionControls } from './chatStreamGuard.js';
import { DEFAULT_SEARCH_K, runSearch } from './SearchWorkflow.js';

/**
 * Sidecar-computed RAG chat: retrieval uses the same path as semantic search (`runSearch`, ADR-003 / RET-1–2).
 */
export interface ChatWorkflowDeps extends SearchWorkflowDeps {
  chat: IChatPort;
  /** Injected from sidecar so core stays free of `src/sidecar` imports (CHAT-3 Y6). */
  buildGroundedMessages: (
    messages: ChatMessage[],
    grounding: GroundingContext,
    hooks?: BuildGroundedMessagesHooks,
  ) => ChatMessage[];
  /** Sidecar wires `pino.warn` for user-prompt truncation (CHAT-4). */
  onUserPromptTruncation?: (ratio: number) => void;
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
  /** CHAT-3 / ADR-011 reserved slots (settings UI CHAT-4). */
  systemPrompt?: string;
  vaultOrganizationPrompt?: string;
}

export interface ChatWorkflowResult {
  sources: Source[];
  groundingOutcome: GroundingOutcome;
  /** Must match `GROUNDING_POLICY_VERSION` in sidecar `chatProviderMessages.ts`. */
  groundingPolicyVersion: string;
}

/** Product-owned copy for zero-hit path (CHAT-3 B4); not model-generated. */
export const INSUFFICIENT_EVIDENCE_STREAM_MESSAGE =
  "I couldn't find notes in your vault that answer this. Try narrowing your search with a folder path, a tag, or a date range — then ask again.";

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

  if (searchRes.results.length === 0) {
    yield INSUFFICIENT_EVIDENCE_STREAM_MESSAGE;
    return {
      sources: [],
      groundingOutcome: 'insufficient_evidence',
      groundingPolicyVersion: CHAT_GROUNDING_POLICY_WIRE_VERSION,
    };
  }

  const context = searchRes.results.map((r) => r.snippet).join('\n\n---\n\n');
  const hooks =
    deps.onUserPromptTruncation !== undefined
      ? { onUserPromptTruncated: deps.onUserPromptTruncation }
      : undefined;
  const assembled = deps.buildGroundedMessages(
    messages,
    {
      retrievalContext: context,
      systemPrompt: options.systemPrompt,
      vaultOrganizationPrompt: options.vaultOrganizationPrompt,
    },
    hooks,
  );

  const stream = deps.chat.complete(assembled, '', options.apiKey, options.completion);
  for await (const delta of withChatCompletionControls(stream, options.completion)) {
    yield delta;
  }

  const sources: Source[] = searchRes.results.map((r) => ({
    notePath: r.notePath,
    nodeId: r.nodeId,
  }));

  return {
    sources,
    groundingOutcome: 'answered',
    groundingPolicyVersion: CHAT_GROUNDING_POLICY_WIRE_VERSION,
  };
}
