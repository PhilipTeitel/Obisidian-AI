import {
  DEFAULT_SEARCH_ASSEMBLY,
  resolveChatStitchMaxTokens,
  stitchRetrievalSnippetsForChat,
  validateSearchAssemblyOptions,
} from '../domain/contextAssembly.js';
import {
  anchorCalendarYmd,
  clampUtcOffsetHoursForResolver,
  resolveDateRangeFromPrompt,
  type ResolverClock,
  type ResolverMatch,
} from '../domain/dateRangeResolver.js';
import { formatNoteDateIso } from '../domain/dailyNoteDate.js';
import type { AgentNoteToolResult } from '../domain/agentNoteTools.js';
import { buildAgentSynthesisContext } from '../domain/agentSynthesis.js';
import type {
  AgentPlanInput,
  RetrievalPlan,
  AgentToolCallPlan,
} from '../domain/agentRetrievalPlan.js';
import type {
  BuildGroundedMessagesHooks,
  ChatMessage,
  GroundingContext,
  GroundingOutcome,
  SearchAssemblyOptions,
  Source,
  UsedNodeRecord,
} from '../domain/types.js';
import { CHAT_GROUNDING_POLICY_WIRE_VERSION } from '../domain/types.js';
import type { IAgentNoteToolPort } from '../ports/IAgentNoteToolPort.js';
import type { IAgentPlannerPort } from '../ports/IAgentPlannerPort.js';
import type { ChatCompletionOptions, IChatPort } from '../ports/IChatPort.js';
import type { SearchWorkflowDeps } from './SearchWorkflow.js';
import { withChatCompletionControls } from './chatStreamGuard.js';
import { DEFAULT_SEARCH_K, runSearch } from './SearchWorkflow.js';

/**
 * Sidecar-computed RAG chat: retrieval uses the same path as semantic search (`runSearch`, ADR-003 / RET-1–2).
 */
export interface ChatWorkflowDeps extends SearchWorkflowDeps {
  chat: IChatPort;
  planner?: IAgentPlannerPort;
  noteTools?: IAgentNoteToolPort;
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
  /** BUG-3 / ADR-016: when set, NL date phrases in the last user message constrain retrieval. */
  resolverClock?: ResolverClock;
  timezoneUtcOffsetHours?: number;
  dailyNotePathGlobs?: string[];
  /** AGT-4: provider/model identity included in deterministic planner input. */
  modelConfigId?: string;
  /** AGT-4: caller-supplied vault/index state fingerprint for planner determinism. */
  vaultIndexFingerprint?: string;
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

const AGENTIC_BUDGET_MESSAGE =
  "I stopped before generating an answer because the planned note-tool budget was exceeded. Try narrowing the topic, folder, tag, or date range — then ask again.";

function usedNodeRecordsToSources(records: UsedNodeRecord[]): Source[] {
  const seenPath = new Set<string>();
  const out: Source[] = [];
  for (const r of records) {
    if (seenPath.has(r.notePath)) continue;
    seenPath.add(r.notePath);
    out.push({ notePath: r.notePath, nodeId: r.nodeId });
  }
  return out;
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

function hasExplicitDateRange(dr?: { start?: string; end?: string }): boolean {
  return dr !== undefined && (dr.start !== undefined || dr.end !== undefined);
}

function mergePathGlobs(a?: string[], b?: string[]): string[] | undefined {
  const all = [...(a ?? []), ...(b ?? [])];
  return all.length > 0 ? [...new Set(all)] : undefined;
}

function anchorDateForPlanner(options: ChatWorkflowOptions): string {
  const clock =
    options.resolverClock ??
    ({
      now: () => new Date(),
      timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    } satisfies ResolverClock);
  const anchor = anchorCalendarYmd(clock, clampUtcOffsetHoursForResolver(options.timezoneUtcOffsetHours));
  return formatNoteDateIso(anchor.y, anchor.m, anchor.d);
}

function buildPlannerInput(
  messages: ChatMessage[],
  userPrompt: string,
  options: ChatWorkflowOptions,
  pathGlobs?: string[],
  dateRange?: { start?: string; end?: string },
): AgentPlanInput {
  return {
    userPrompt,
    conversation: messages,
    ...(options.vaultOrganizationPrompt !== undefined
      ? { vaultOrganizationPrompt: options.vaultOrganizationPrompt }
      : {}),
    ...(pathGlobs !== undefined ? { explicitPathGlobs: pathGlobs } : {}),
    ...(dateRange !== undefined ? { explicitDateRange: dateRange } : {}),
    ...(options.dailyNotePathGlobs !== undefined ? { dailyNotePathGlobs: options.dailyNotePathGlobs } : {}),
    anchorDate: anchorDateForPlanner(options),
    modelConfigId: options.modelConfigId ?? 'unspecified-model',
    vaultIndexFingerprint: options.vaultIndexFingerprint ?? 'unspecified-vault-index',
  };
}

function hasBudgetExceeded(result: AgentNoteToolResult): boolean {
  return result.status === 'budget_exceeded' || result.trace.budgetExceeded;
}

async function runAgenticTools(
  noteTools: IAgentNoteToolPort,
  plan: RetrievalPlan,
  options: ChatWorkflowOptions,
  searchAssembly: SearchAssemblyOptions,
): Promise<{ results: AgentNoteToolResult[]; budgetExceeded: boolean }> {
  const results: AgentNoteToolResult[] = [];

  for (const toolCall of plan.toolCalls) {
    const result = await noteTools.runTool({
      plan,
      toolCall: toolCall as AgentToolCallPlan,
      priorResults: results,
      search: searchAssembly,
      apiKey: options.apiKey,
      coarseK: options.coarseK,
      k: options.k,
      enableHybridSearch: options.enableHybridSearch,
    });
    results.push(result);
    if (hasBudgetExceeded(result)) {
      return { results, budgetExceeded: true };
    }
  }

  return { results, budgetExceeded: false };
}

/** After NL date resolution, keep filters but drop the matched phrase from the embedding/BM25 query (REQ-006 / ADR-016). */
export function stripMatchedNLDatePhraseForRetrieval(query: string, match: ResolverMatch | null): string {
  if (match === null) return query;
  const phrase = match.matchedPhrase.trim();
  if (phrase.length === 0) return query;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const next = query.replace(new RegExp(escaped, 'gi'), ' ').replace(/\s+/g, ' ').trim();
  return next.length > 0 ? next : query;
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

  let pathGlobs = options.pathGlobs;
  let dateRange = options.dateRange;
  let nlDateMatch: ResolverMatch | null = null;
  if (options.resolverClock !== undefined && !hasExplicitDateRange(options.dateRange)) {
    const match = resolveDateRangeFromPrompt(query, options.resolverClock, {
      utcOffsetHoursFallback: clampUtcOffsetHoursForResolver(options.timezoneUtcOffsetHours),
      dailyNotePathGlobs: options.dailyNotePathGlobs,
    });
    if (match !== null) {
      nlDateMatch = match;
      deps.log?.debug(
        {
          matchRuleId: match.matchRuleId,
          dateRange: match.dateRange,
          pathGlobs: match.pathGlobs,
        },
        'chat.date_range_resolved',
      );
      deps.log?.info?.({ naturalLanguageDateFilterApplied: true }, 'chat.nl_date_filter_applied');
      pathGlobs = mergePathGlobs(pathGlobs, match.pathGlobs);
      dateRange = match.dateRange;
    }
  }

  const retrievalQuery = stripMatchedNLDatePhraseForRetrieval(query, nlDateMatch);
  if (retrievalQuery !== query) {
    deps.log?.debug(
      { retrievalQueryLen: retrievalQuery.length, matchRuleId: nlDateMatch?.matchRuleId },
      'chat.retrieval_query_stripped_nl_date',
    );
  }

  if (deps.planner !== undefined && deps.noteTools !== undefined) {
    const plan = await deps.planner.planRetrieval(
      buildPlannerInput(messages, query, options, pathGlobs, dateRange),
    );

    if (plan.status === 'needs_scope') {
      yield `${INSUFFICIENT_EVIDENCE_STREAM_MESSAGE}\n\nMissing scope: ${plan.reason}`;
      return {
        sources: [],
        groundingOutcome: 'insufficient_evidence',
        groundingPolicyVersion: CHAT_GROUNDING_POLICY_WIRE_VERSION,
      };
    }

    const toolRun = await runAgenticTools(deps.noteTools, plan, options, searchAssembly);
    if (toolRun.budgetExceeded) {
      deps.log?.warn?.({ stablePlanKey: plan.stablePlanKey }, 'chat.agentic_tool_budget_exceeded');
      yield AGENTIC_BUDGET_MESSAGE;
      return {
        sources: [],
        groundingOutcome: 'insufficient_evidence',
        groundingPolicyVersion: CHAT_GROUNDING_POLICY_WIRE_VERSION,
      };
    }

    const synthesis = buildAgentSynthesisContext({
      plan,
      toolResults: toolRun.results,
      messages,
      systemPrompt: options.systemPrompt,
      vaultOrganizationPrompt: options.vaultOrganizationPrompt,
    });
    if (synthesis.isInsufficient) {
      deps.log?.info?.({ stablePlanKey: plan.stablePlanKey }, 'chat.agentic_synthesis_insufficient_context');
      yield INSUFFICIENT_EVIDENCE_STREAM_MESSAGE;
      return {
        sources: [],
        groundingOutcome: 'insufficient_evidence',
        groundingPolicyVersion: CHAT_GROUNDING_POLICY_WIRE_VERSION,
      };
    }

    const hooks =
      deps.onUserPromptTruncation !== undefined
        ? { onUserPromptTruncated: deps.onUserPromptTruncation }
        : undefined;
    const assembled = deps.buildGroundedMessages(
      messages,
      {
        retrievalContext: synthesis.retrievalContext,
        systemPrompt: options.systemPrompt,
        vaultOrganizationPrompt: options.vaultOrganizationPrompt,
      },
      hooks,
    );

    const stream = deps.chat.complete(assembled, '', options.apiKey, options.completion);
    for await (const delta of withChatCompletionControls(stream, options.completion)) {
      yield delta;
    }

    const sources = synthesis.sources;
    deps.log?.info?.({ stablePlanKey: plan.stablePlanKey, sourceCount: sources.length }, 'chat.agentic_completion_sources');

    return {
      sources,
      groundingOutcome: 'answered',
      groundingPolicyVersion: CHAT_GROUNDING_POLICY_WIRE_VERSION,
    };
  }

  const searchRes = await runSearch(
    deps,
    {
      query: retrievalQuery,
      apiKey: options.apiKey,
      k: options.k ?? DEFAULT_SEARCH_K,
      tags: options.tags,
      pathGlobs,
      dateRange,
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

  const stitchBudget = resolveChatStitchMaxTokens(searchAssembly);
  const stitched = stitchRetrievalSnippetsForChat(searchRes.results, {
    maxTotalTokens: stitchBudget,
  });
  for (const nodeId of stitched.droppedNodeIds) {
    deps.log?.debug({ nodeId, stitchBudget }, 'chat.retrieval_snippet_dropped_budget');
  }
  const context = stitched.context;
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

  const sources = usedNodeRecordsToSources(stitched.usedRecords);
  deps.log?.info?.({ sourceCount: sources.length }, 'chat.completion_sources');

  return {
    sources,
    groundingOutcome: 'answered',
    groundingPolicyVersion: CHAT_GROUNDING_POLICY_WIRE_VERSION,
  };
}
