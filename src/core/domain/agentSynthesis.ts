import type { AgentNoteToolResult } from './agentNoteTools.js';
import { AGENT_RETRIEVAL_DEFAULT_FORMAT, type AgentOutputKind, type RetrievalPlan } from './agentRetrievalPlan.js';
import type { ChatMessage, Source, UsedNodeRecord } from './types.js';

export interface AgentSynthesisInput {
  plan: RetrievalPlan;
  toolResults: AgentNoteToolResult[];
  messages: ChatMessage[];
  systemPrompt?: string;
  vaultOrganizationPrompt?: string;
}

export interface AgentSynthesisContext {
  retrievalContext: string;
  sources: Source[];
  usedNodes: UsedNodeRecord[];
  outputKind: AgentOutputKind;
  requestedFormat?: string;
  isInsufficient: boolean;
  insufficientReason?: string;
}

export interface AgentSynthesisOptions {
  maxIncludedItems?: number;
}

interface SynthesisContentItem {
  label: string;
  content: string;
  sourceRecords: UsedNodeRecord[];
}

const INSUFFICIENT_REASON = 'No usable vault context was returned by the planned note tools.';

export function buildAgentSynthesisContext(
  input: AgentSynthesisInput,
  options: AgentSynthesisOptions = {},
): AgentSynthesisContext {
  const includedItems = contentItemsFromToolResults(input.toolResults).slice(0, options.maxIncludedItems);
  const usedNodes = firstUseRecords(includedItems.flatMap((item) => item.sourceRecords));
  if (includedItems.length === 0 || usedNodes.length === 0) {
    return {
      retrievalContext: '',
      sources: [],
      usedNodes: [],
      outputKind: input.plan.output.kind,
      ...(input.plan.output.requestedFormat !== undefined ? { requestedFormat: input.plan.output.requestedFormat } : {}),
      isInsufficient: true,
      insufficientReason: INSUFFICIENT_REASON,
    };
  }

  return {
    retrievalContext: buildRetrievalContext(input.plan, includedItems),
    sources: sourcesFromUsedNodes(usedNodes),
    usedNodes,
    outputKind: input.plan.output.kind,
    ...(input.plan.output.requestedFormat !== undefined ? { requestedFormat: input.plan.output.requestedFormat } : {}),
    isInsufficient: false,
  };
}

function buildRetrievalContext(plan: RetrievalPlan, items: SynthesisContentItem[]): string {
  const lines = [
    '## Synthesis instructions',
    `- Output kind: ${plan.output.kind}`,
    '- Use only the source context below plus the conversation history.',
    '- State the gap when the source context does not support a requested fact.',
  ];
  if (plan.output.kind === 'draft_note') {
    lines.push('- Return draft content in chat only.');
  }
  if (plan.output.requestedFormat !== undefined) {
    lines.push(`- Requested output format: ${plan.output.requestedFormat}`);
  } else if (plan.output.defaultFormat === AGENT_RETRIEVAL_DEFAULT_FORMAT) {
    lines.push('- Default output format: bullet list');
  }
  lines.push('', '## Source context');

  for (const item of items) {
    lines.push('', `### ${item.label}`, item.content);
  }

  return lines.join('\n');
}

function contentItemsFromToolResults(results: AgentNoteToolResult[]): SynthesisContentItem[] {
  const items: SynthesisContentItem[] = [];
  for (const result of results) {
    if (result.type === 'search_notes') {
      for (const searchResult of result.results) {
        const content = searchResult.snippet.trim();
        if (content.length === 0) continue;
        items.push({
          label: `${searchResult.notePath}#${searchResult.nodeId}`,
          content,
          sourceRecords: [
            {
              nodeId: searchResult.nodeId,
              notePath: searchResult.notePath,
              insertionOrder: items.length,
            },
          ],
        });
      }
    } else if (result.type === 'read_note') {
      for (const node of result.nodes) {
        const content = node.content.trim();
        if (content.length === 0) continue;
        items.push({
          label: `${node.notePath}#${node.nodeId}`,
          content,
          sourceRecords: [
            {
              nodeId: node.nodeId,
              notePath: node.notePath,
              insertionOrder: items.length,
            },
          ],
        });
      }
    } else {
      const content = result.draftMarkdown.trim();
      if (content.length === 0) continue;
      const insertionBase = items.length;
      items.push({
        label: 'Draft tool output',
        content,
        sourceRecords: result.usedNodes.map((record, index) => ({
          nodeId: record.nodeId,
          notePath: record.notePath,
          insertionOrder: insertionBase + index,
        })),
      });
    }
  }
  return items;
}

function firstUseRecords(records: UsedNodeRecord[]): UsedNodeRecord[] {
  const seen = new Set<string>();
  const out: UsedNodeRecord[] = [];
  for (const record of records) {
    const key = `${record.notePath}\u0000${record.nodeId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      nodeId: record.nodeId,
      notePath: record.notePath,
      insertionOrder: out.length,
    });
  }
  return out;
}

function sourcesFromUsedNodes(records: UsedNodeRecord[]): Source[] {
  const seenPath = new Set<string>();
  const sources: Source[] = [];
  for (const record of records) {
    if (seenPath.has(record.notePath)) {
      continue;
    }
    seenPath.add(record.notePath);
    sources.push({ notePath: record.notePath, nodeId: record.nodeId });
  }
  return sources;
}
