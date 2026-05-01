import type { AgentNoteToolTrace } from './agentNoteTools.js';
import { AGENT_NOTE_TOOL_BUDGETS } from './agentNoteTools.js';
import { AGENT_PLANNER_BUDGETS, type AgentPlanResult, type RetrievalPlan } from './agentRetrievalPlan.js';
import { hashText } from './hashText.js';
import type { Source } from './types.js';

export interface ProviderTokenUsage {
  source: 'reported' | 'unavailable';
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AgentPlanTraceSummary {
  planKey: string;
  status: AgentPlanResult['status'];
  taskLabel?: string;
  topicLabel?: string;
  missing?: string[];
  filters?: RetrievalPlan['filters'];
  outputKind?: RetrievalPlan['output']['kind'];
  requestedFormatLabel?: string;
  toolCallCount: number;
}

export interface AgentToolTraceSummary {
  planKey: string;
  toolCallId: string;
  toolType: string;
  status: AgentNoteToolTrace['status'];
  resultCount: number;
  sourceCount: number;
  usedNodeCount: number;
  budgetExceeded: boolean;
}

export interface AgentSourceTraceSummary {
  sourceCount: number;
  notePaths: string[];
  hasNodeAnchors: boolean;
}

export interface AgentBudgetWarning {
  budgetName: string;
  configured: number;
  observed: number;
  planKey?: string;
  toolCallId?: string;
}

export type AgentUsageStage = 'planner' | 'completion';

export type AgentRunTraceEvent =
  | { type: 'plan'; plan: AgentPlanResult }
  | { type: 'tool'; tool: AgentToolTraceSummary }
  | { type: 'sources'; sources: Source[] }
  | { type: 'usage'; stage: AgentUsageStage; usage: ProviderTokenUsage }
  | ({ type: 'budget' } & AgentBudgetWarning);

export function safeTraceLabel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  return `sha256:${hashText(trimmed)}`;
}

export function summarizeAgentPlan(plan: AgentPlanResult): AgentPlanTraceSummary {
  if (plan.status === 'needs_scope') {
    return {
      planKey: plan.stablePlanKey,
      status: plan.status,
      missing: plan.missing,
      toolCallCount: 0,
    };
  }

  return {
    planKey: plan.stablePlanKey,
    status: plan.status,
    ...(safeTraceLabel(plan.task) !== undefined ? { taskLabel: safeTraceLabel(plan.task) } : {}),
    ...(safeTraceLabel(plan.topic) !== undefined ? { topicLabel: safeTraceLabel(plan.topic) } : {}),
    filters: plan.filters,
    outputKind: plan.output.kind,
    ...(safeTraceLabel(plan.output.requestedFormat) !== undefined
      ? { requestedFormatLabel: safeTraceLabel(plan.output.requestedFormat) }
      : {}),
    toolCallCount: plan.toolCalls.length,
  };
}

export function summarizeAgentToolTrace(trace: AgentNoteToolTrace): AgentToolTraceSummary {
  return {
    planKey: trace.planKey,
    toolCallId: trace.toolCallId,
    toolType: trace.toolType,
    status: trace.status,
    resultCount: trace.resultCount,
    sourceCount: trace.sourceCount,
    usedNodeCount: trace.usedNodeCount,
    budgetExceeded: trace.budgetExceeded,
  };
}

export function summarizeAgentSources(sources: readonly Source[]): AgentSourceTraceSummary {
  return {
    sourceCount: sources.length,
    notePaths: sources.map((source) => source.notePath),
    hasNodeAnchors: sources.some((source) => source.nodeId !== undefined),
  };
}

export function normalizeProviderTokenUsage(
  usage:
    | {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
      }
    | undefined,
): ProviderTokenUsage {
  if (usage === undefined) {
    return { source: 'unavailable' };
  }
  const promptTokens = normalizeNonNegativeInt(usage.promptTokens);
  const completionTokens = normalizeNonNegativeInt(usage.completionTokens);
  const totalTokens = normalizeNonNegativeInt(usage.totalTokens) ?? sumIfAvailable(promptTokens, completionTokens);
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return { source: 'unavailable' };
  }
  return {
    source: 'reported',
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

export function unavailableProviderTokenUsage(): ProviderTokenUsage {
  return { source: 'unavailable' };
}

export function plannerToolCallBudgetWarning(plan: AgentPlanResult): AgentBudgetWarning | null {
  if (plan.status !== 'ready' || plan.toolCalls.length <= AGENT_PLANNER_BUDGETS.maxToolCalls) {
    return null;
  }
  return {
    budgetName: 'agent.planner.tool_calls',
    configured: AGENT_PLANNER_BUDGETS.maxToolCalls,
    observed: plan.toolCalls.length,
    planKey: plan.stablePlanKey,
  };
}

export function toolBudgetWarning(tool: AgentToolTraceSummary): AgentBudgetWarning | null {
  if (!tool.budgetExceeded) {
    return null;
  }
  const configured = configuredBudgetForTool(tool.toolType);
  return {
    budgetName: `agent.tool.${tool.toolType}`,
    configured,
    observed: Math.max(tool.resultCount, tool.sourceCount, tool.usedNodeCount),
    planKey: tool.planKey,
    toolCallId: tool.toolCallId,
  };
}

function configuredBudgetForTool(toolType: string): number {
  switch (toolType) {
    case 'search_notes':
      return AGENT_NOTE_TOOL_BUDGETS.maxSearchResults;
    case 'read_note':
      return AGENT_NOTE_TOOL_BUDGETS.maxReadNodes;
    case 'assemble_draft':
      return AGENT_NOTE_TOOL_BUDGETS.maxDraftSourceTokens;
    default:
      return AGENT_NOTE_TOOL_BUDGETS.maxToolSteps;
  }
}

function normalizeNonNegativeInt(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

function sumIfAvailable(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined || b === undefined) {
    return undefined;
  }
  return a + b;
}
