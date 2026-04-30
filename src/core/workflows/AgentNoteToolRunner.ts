import {
  AGENT_NOTE_TOOL_BUDGETS,
  type AgentDraftToolResult,
  type AgentNoteToolResult,
  type AgentNoteToolRunInput,
  type AgentReadNode,
  type AgentReadToolResult,
  type AgentSearchToolResult,
  buildToolTrace,
  boundedSearchResults,
  isAgentNoteToolName,
  scopeForTool,
  sourcesFromUsedNodes,
  stableUniqueStrings,
  unsupportedToolResult,
  usedNodesFromSearchResults,
} from '../domain/agentNoteTools.js';
import type { AgentToolCallPlan, RetrievalPlan } from '../domain/agentRetrievalPlan.js';
import { estimateTokens } from '../domain/tokenEstimator.js';
import type { DocumentNode, NoteMeta, UsedNodeRecord } from '../domain/types.js';
import { vaultPathMatchesAnyGlob } from '../domain/pathGlob.js';
import type { IDocumentStore } from '../ports/IDocumentStore.js';
import type { IAgentNoteToolPort } from '../ports/IAgentNoteToolPort.js';
import type { SearchWorkflowDeps } from './SearchWorkflow.js';
import { runSearch } from './SearchWorkflow.js';

export type AgentNoteToolRunnerDeps = SearchWorkflowDeps;

export class AgentNoteToolRunner implements IAgentNoteToolPort {
  constructor(private readonly deps: AgentNoteToolRunnerDeps) {}

  async runTool(input: AgentNoteToolRunInput): Promise<AgentNoteToolResult> {
    if (input.priorResults.length >= AGENT_NOTE_TOOL_BUDGETS.maxToolSteps) {
      return budgetExceededResult(input.plan, input.toolCall);
    }

    if (!isAgentNoteToolName(input.toolCall.type)) {
      return unsupportedToolResult(input.plan, input.toolCall);
    }

    switch (input.toolCall.type) {
      case 'search_notes':
        return this.runSearchNotes(input);
      case 'read_note':
        return this.runReadNote(input);
      case 'assemble_draft':
        return this.runAssembleDraft(input);
    }
  }

  private async runSearchNotes(input: AgentNoteToolRunInput): Promise<AgentSearchToolResult> {
    const scope = scopeForTool(input.plan, input.toolCall);
    const query = input.toolCall.query ?? input.plan.topic;
    const response = await runSearch(
      this.deps,
      {
        query,
        apiKey: input.apiKey,
        k: input.k ?? AGENT_NOTE_TOOL_BUDGETS.maxSearchResults,
        coarseK: input.coarseK,
        enableHybridSearch: input.enableHybridSearch,
        search: input.search,
        pathGlobs: scope.pathGlobs,
        dateRange: scope.dateRange,
        tags: scope.tags,
      },
      input.search,
    );
    const bounded = boundedSearchResults(response.results);
    const usedNodes = usedNodesFromSearchResults(bounded.results);
    const sources = sourcesFromUsedNodes(usedNodes);

    return {
      type: 'search_notes',
      status: bounded.status,
      results: bounded.results,
      sources,
      usedNodes,
      trace: buildToolTrace(input.plan, input.toolCall, bounded.status, {
        resultCount: bounded.results.length,
        sourceCount: sources.length,
        usedNodeCount: usedNodes.length,
        budgetExceeded: bounded.budgetExceeded,
      }),
    };
  }

  private async runReadNote(input: AgentNoteToolRunInput): Promise<AgentReadToolResult> {
    const targetIds = await resolveReadTargetNodeIds(this.deps.store, input.toolCall, input.priorResults);
    if (targetIds.length === 0) {
      return readResult(input.plan, input.toolCall, 'needs_target', [], false);
    }

    const budgetExceeded = targetIds.length > AGENT_NOTE_TOOL_BUDGETS.maxReadNodes;
    const nodes: AgentReadNode[] = [];
    for (const nodeId of targetIds.slice(0, AGENT_NOTE_TOOL_BUDGETS.maxReadNodes)) {
      const node = await this.deps.store.getNodeById(nodeId);
      if (node === null) {
        continue;
      }
      const meta = await this.deps.store.getNoteMeta(node.noteId);
      if (meta === null || !(await noteMatchesToolScope(this.deps.store, node, meta, input.plan, input.toolCall))) {
        continue;
      }
      nodes.push({
        nodeId: node.id,
        notePath: meta.vaultPath,
        content: node.content,
        headingTrail: node.headingTrail,
      });
    }

    return readResult(input.plan, input.toolCall, budgetExceeded ? 'budget_exceeded' : 'ok', nodes, budgetExceeded);
  }

  private runAssembleDraft(input: AgentNoteToolRunInput): AgentDraftToolResult {
    const sections: string[] = [`# Draft: ${input.plan.topic}`, '', `Output: ${input.plan.output.kind}`];
    if (input.plan.output.requestedFormat !== undefined) {
      sections.push(`Requested format: ${input.plan.output.requestedFormat}`);
    }
    sections.push('', '## Source Notes');

    const usedNodes: UsedNodeRecord[] = [];
    let tokenBudget = 0;
    let budgetExceeded = false;
    for (const result of input.priorResults) {
      for (const item of contentItemsFromResult(result)) {
        const nextTokens = estimateTokens(item.content);
        if (tokenBudget + nextTokens > AGENT_NOTE_TOOL_BUDGETS.maxDraftSourceTokens) {
          budgetExceeded = true;
          break;
        }
        tokenBudget += nextTokens;
        usedNodes.push({
          nodeId: item.nodeId,
          notePath: item.notePath,
          insertionOrder: usedNodes.length,
        });
        sections.push(`- ${item.notePath}#${item.nodeId}: ${item.content}`);
      }
      if (budgetExceeded) {
        break;
      }
    }

    if (usedNodes.length === 0) {
      sections.push('- No indexed source content was available to assemble.');
    }

    const sources = sourcesFromUsedNodes(usedNodes);
    const status: AgentDraftToolResult['status'] = budgetExceeded ? 'budget_exceeded' : 'ok';
    return {
      type: 'assemble_draft',
      status,
      draftMarkdown: sections.join('\n'),
      output: input.plan.output,
      sources,
      usedNodes,
      trace: buildToolTrace(input.plan, input.toolCall, status, {
        resultCount: usedNodes.length,
        sourceCount: sources.length,
        usedNodeCount: usedNodes.length,
        budgetExceeded,
      }),
    };
  }
}

function budgetExceededResult(plan: RetrievalPlan, toolCall: AgentToolCallPlan): AgentDraftToolResult {
  return {
    type: 'assemble_draft',
    status: 'budget_exceeded',
    draftMarkdown: '',
    output: plan.output,
    sources: [],
    usedNodes: [],
    trace: buildToolTrace(plan, toolCall, 'budget_exceeded', {
      resultCount: 0,
      sourceCount: 0,
      usedNodeCount: 0,
      budgetExceeded: true,
    }),
  };
}

function readResult(
  plan: RetrievalPlan,
  toolCall: AgentToolCallPlan,
  status: AgentReadToolResult['status'],
  nodes: AgentReadNode[],
  budgetExceeded: boolean,
): AgentReadToolResult {
  const usedNodes = nodes.map((node, index) => ({
    nodeId: node.nodeId,
    notePath: node.notePath,
    insertionOrder: index,
  }));
  const sources = sourcesFromUsedNodes(usedNodes);
  return {
    type: 'read_note',
    status,
    ...(sources[0] !== undefined ? { notePath: sources[0].notePath } : {}),
    nodes,
    sources,
    usedNodes,
    trace: buildToolTrace(plan, toolCall, status, {
      resultCount: nodes.length,
      sourceCount: sources.length,
      usedNodeCount: usedNodes.length,
      budgetExceeded,
    }),
  };
}

async function resolveReadTargetNodeIds(
  store: IDocumentStore,
  toolCall: AgentToolCallPlan,
  priorResults: AgentNoteToolResult[],
): Promise<string[]> {
  const explicit = stableUniqueStrings(toolCall.nodeIds);
  if (explicit.length > 0) {
    return explicit;
  }

  const hasSearchResults = priorResults.some((result) => result.type === 'search_notes');
  if (toolCall.notePath !== undefined && !hasSearchResults) {
    const nodes = await store.getNodesByNote(toolCall.notePath);
    return stableUniqueStrings(nodes.map((node) => node.id));
  }

  const priorSearchNodeIds = new Set<string>();
  for (const result of priorResults) {
    if (result.type !== 'search_notes') {
      continue;
    }
    for (const searchResult of result.results) {
      if (toolCall.notePath !== undefined && searchResult.notePath !== toolCall.notePath) {
        continue;
      }
      priorSearchNodeIds.add(searchResult.nodeId);
    }
  }

  const requestedFromPrior = stableUniqueStrings(toolCall.fromPreviousSearchResultIds);
  if (requestedFromPrior.length > 0) {
    return requestedFromPrior.filter((nodeId) => priorSearchNodeIds.has(nodeId));
  }

  return [...priorSearchNodeIds].sort((a, b) => a.localeCompare(b));
}

async function noteMatchesToolScope(
  store: IDocumentStore,
  node: DocumentNode,
  meta: NoteMeta,
  plan: RetrievalPlan,
  toolCall: AgentToolCallPlan,
): Promise<boolean> {
  const scope = scopeForTool(plan, toolCall);
  if (scope.pathGlobs !== undefined && !vaultPathMatchesAnyGlob(meta.vaultPath, scope.pathGlobs)) {
    return false;
  }
  const noteDate = meta.noteDate ?? undefined;
  if (scope.dateRange?.start !== undefined && (noteDate === undefined || noteDate < scope.dateRange.start)) {
    return false;
  }
  if (scope.dateRange?.end !== undefined && (noteDate === undefined || noteDate > scope.dateRange.end)) {
    return false;
  }
  if (scope.tags !== undefined && !(await store.noteMatchesTagFilter(node.noteId, scope.tags))) {
    return false;
  }
  return true;
}

function contentItemsFromResult(result: AgentNoteToolResult): Array<{ nodeId: string; notePath: string; content: string }> {
  if (result.type === 'search_notes') {
    return result.results.map((item) => ({
      nodeId: item.nodeId,
      notePath: item.notePath,
      content: item.snippet,
    }));
  }
  if (result.type === 'read_note') {
    return result.nodes.map((node) => ({
      nodeId: node.nodeId,
      notePath: node.notePath,
      content: node.content,
    }));
  }
  return [];
}
