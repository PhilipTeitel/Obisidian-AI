import type { AgentToolCallPlan, RetrievalPlan } from './agentRetrievalPlan.js';
import type { SearchAssemblyOptions, SearchResult, Source, UsedNodeRecord } from './types.js';

export const AGENT_NOTE_TOOL_BUDGETS = {
  maxToolSteps: 8,
  maxSearchResults: 12,
  maxReadNodes: 40,
  maxDraftSourceTokens: 6000,
} as const;

export type AgentNoteToolName = 'search_notes' | 'read_note' | 'assemble_draft';

export type AgentNoteToolStatus = 'ok' | 'skipped' | 'needs_target' | 'budget_exceeded' | 'unsupported_tool';

export interface AgentNoteToolTrace {
  planKey: string;
  toolCallId: string;
  toolType: string;
  status: AgentNoteToolStatus;
  resultCount: number;
  sourceCount: number;
  usedNodeCount: number;
  budgetExceeded: boolean;
}

export interface AgentReadNode {
  nodeId: string;
  notePath: string;
  content: string;
  headingTrail: string[];
}

export interface AgentNoteToolRunInput {
  plan: RetrievalPlan;
  toolCall: AgentToolCallPlan;
  priorResults: AgentNoteToolResult[];
  search?: SearchAssemblyOptions;
  apiKey?: string;
  coarseK?: number;
  k?: number;
  enableHybridSearch?: boolean;
}

export interface AgentSearchToolResult {
  type: 'search_notes';
  status: AgentNoteToolStatus;
  results: SearchResult[];
  sources: Source[];
  usedNodes: UsedNodeRecord[];
  trace: AgentNoteToolTrace;
}

export interface AgentReadToolResult {
  type: 'read_note';
  status: AgentNoteToolStatus;
  notePath?: string;
  nodes: AgentReadNode[];
  sources: Source[];
  usedNodes: UsedNodeRecord[];
  trace: AgentNoteToolTrace;
}

export interface AgentDraftToolResult {
  type: 'assemble_draft';
  status: AgentNoteToolStatus;
  draftMarkdown: string;
  output: RetrievalPlan['output'];
  sources: Source[];
  usedNodes: UsedNodeRecord[];
  trace: AgentNoteToolTrace;
}

export type AgentNoteToolResult = AgentSearchToolResult | AgentReadToolResult | AgentDraftToolResult;

export function isAgentNoteToolName(value: string): value is AgentNoteToolName {
  return value === 'search_notes' || value === 'read_note' || value === 'assemble_draft';
}

export function isWriteLikeToolName(value: string): boolean {
  return /(^|_)(write|create|modify|delete|append|patch|save|vault|file)($|_)/i.test(value);
}

export function unsupportedToolResult(plan: RetrievalPlan, toolCall: AgentToolCallPlan): AgentDraftToolResult {
  return {
    type: 'assemble_draft',
    status: 'unsupported_tool',
    draftMarkdown: '',
    output: plan.output,
    sources: [],
    usedNodes: [],
    trace: buildToolTrace(plan, toolCall, 'unsupported_tool', {
      resultCount: 0,
      sourceCount: 0,
      usedNodeCount: 0,
      budgetExceeded: false,
    }),
  };
}

export function buildToolTrace(
  plan: RetrievalPlan,
  toolCall: AgentToolCallPlan,
  status: AgentNoteToolStatus,
  counts: {
    resultCount: number;
    sourceCount: number;
    usedNodeCount: number;
    budgetExceeded: boolean;
  },
): AgentNoteToolTrace {
  return {
    planKey: plan.stablePlanKey,
    toolCallId: toolCall.id,
    toolType: toolCall.type,
    status,
    resultCount: counts.resultCount,
    sourceCount: counts.sourceCount,
    usedNodeCount: counts.usedNodeCount,
    budgetExceeded: counts.budgetExceeded,
  };
}

export function scopeForTool(plan: RetrievalPlan, toolCall: AgentToolCallPlan): {
  pathGlobs?: string[];
  dateRange?: RetrievalPlan['filters']['dateRange'];
  tags?: string[];
} {
  const pathGlobs = stableUniqueStrings(plan.filters.pathGlobs).length
    ? stableUniqueStrings(plan.filters.pathGlobs)
    : stableUniqueStrings(toolCall.pathGlobs);
  const tags = stableUniqueStrings(plan.filters.tags).length
    ? stableUniqueStrings(plan.filters.tags)
    : stableUniqueStrings(toolCall.tags);
  return {
    ...(pathGlobs.length > 0 ? { pathGlobs } : {}),
    ...(plan.filters.dateRange !== undefined ? { dateRange: plan.filters.dateRange } : toolCall.dateRange !== undefined ? { dateRange: toolCall.dateRange } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

export function boundedSearchResults(results: SearchResult[]): {
  results: SearchResult[];
  status: AgentNoteToolStatus;
  budgetExceeded: boolean;
} {
  const ordered = [...results].sort(compareSearchResult).slice(0, AGENT_NOTE_TOOL_BUDGETS.maxSearchResults);
  const budgetExceeded = results.length > AGENT_NOTE_TOOL_BUDGETS.maxSearchResults;
  return {
    results: ordered,
    status: budgetExceeded ? 'budget_exceeded' : 'ok',
    budgetExceeded,
  };
}

export function usedNodesFromSearchResults(results: SearchResult[]): UsedNodeRecord[] {
  return results.map((result, index) => ({
    nodeId: result.nodeId,
    notePath: result.notePath,
    insertionOrder: index,
  }));
}

export function sourcesFromUsedNodes(records: UsedNodeRecord[]): Source[] {
  const seen = new Set<string>();
  const sorted = [...records].sort((a, b) => a.insertionOrder - b.insertionOrder || a.notePath.localeCompare(b.notePath));
  const sources: Source[] = [];
  for (const record of sorted) {
    if (!seen.has(record.notePath)) {
      seen.add(record.notePath);
      sources.push({ notePath: record.notePath, nodeId: record.nodeId });
    }
  }
  return sources;
}

export function stableUniqueStrings(values: readonly string[] | undefined): string[] {
  if (values === undefined) {
    return [];
  }
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function compareSearchResult(a: SearchResult, b: SearchResult): number {
  return a.score - b.score || a.notePath.localeCompare(b.notePath) || a.nodeId.localeCompare(b.nodeId);
}
