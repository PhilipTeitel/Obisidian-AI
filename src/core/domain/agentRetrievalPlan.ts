import type { ChatMessage } from './types.js';
import { hashText } from './hashText.js';
import type { ProviderTokenUsage } from './agentRunTrace.js';

export const AGENT_RETRIEVAL_PLAN_VERSION = 'v1';
export const AGENT_RETRIEVAL_DEFAULT_FORMAT = 'bullet_list';

/** Fixed first-slice budgets (ADR-018). These are code constants, not user-configurable values. */
export const AGENT_PLANNER_BUDGETS = {
  maxPlanningSteps: 6,
  maxToolCalls: 8,
  maxPlannerOutputTokens: 2048,
} as const;

export type AgentPlanStatus = 'ready' | 'needs_scope';
export type AgentOutputKind = 'answer' | 'draft_note';

export interface AgentDateRange {
  start?: string;
  end?: string;
  defaulted?: boolean;
}

export interface AgentPlanInput {
  userPrompt: string;
  conversation: ChatMessage[];
  vaultOrganizationPrompt?: string;
  explicitPathGlobs?: string[];
  explicitDateRange?: { start?: string; end?: string };
  dailyNotePathGlobs?: string[];
  anchorDate: string;
  modelConfigId: string;
  vaultIndexFingerprint: string;
}

export interface AgentToolCallPlan {
  id: string;
  type: 'search_notes' | 'read_note' | 'assemble_draft';
  reason: string;
  query?: string;
  pathGlobs?: string[];
  dateRange?: AgentDateRange;
  tags?: string[];
  notePath?: string;
  nodeIds?: string[];
  fromPreviousSearchResultIds?: string[];
}

export interface RetrievalPlan {
  planVersion: typeof AGENT_RETRIEVAL_PLAN_VERSION;
  status: 'ready';
  task: string;
  topic: string;
  entities: string[];
  filters: {
    pathGlobs?: string[];
    dateRange?: AgentDateRange;
    tags?: string[];
  };
  output: {
    kind: AgentOutputKind;
    requestedFormat?: string;
    defaultFormat: typeof AGENT_RETRIEVAL_DEFAULT_FORMAT;
  };
  toolCalls: AgentToolCallPlan[];
  stablePlanKey: string;
  usage?: ProviderTokenUsage;
}

export interface NeedsScopePlan {
  planVersion: typeof AGENT_RETRIEVAL_PLAN_VERSION;
  status: 'needs_scope';
  reason: string;
  missing: Array<'topic' | 'scope' | 'output'>;
  stablePlanKey: string;
  usage?: ProviderTokenUsage;
}

export type AgentPlanResult = RetrievalPlan | NeedsScopePlan;

export interface AgentGroundingValidation {
  allowedSource?: 'vault' | 'external';
  allowExternalSources?: boolean;
  groundingPolicyOverride?: string;
}

export type RetrievalPlanDraft = Omit<
  RetrievalPlan,
  'planVersion' | 'status' | 'stablePlanKey' | 'entities' | 'filters' | 'output' | 'toolCalls'
> & {
  planVersion?: typeof AGENT_RETRIEVAL_PLAN_VERSION;
  status?: 'ready';
  entities?: string[];
  filters?: RetrievalPlan['filters'];
  output?: {
    kind?: AgentOutputKind;
    requestedFormat?: string;
    defaultFormat?: typeof AGENT_RETRIEVAL_DEFAULT_FORMAT;
  };
  toolCalls?: AgentToolCallPlan[];
  dateBoundedSynthesis?: boolean;
  grounding?: AgentGroundingValidation;
};

export type NeedsScopePlanDraft = Omit<
  NeedsScopePlan,
  'planVersion' | 'status' | 'stablePlanKey' | 'missing'
> & {
  planVersion?: typeof AGENT_RETRIEVAL_PLAN_VERSION;
  status?: 'needs_scope';
  missing: Array<'topic' | 'scope' | 'output'>;
  toolCalls?: AgentToolCallPlan[];
  grounding?: AgentGroundingValidation;
};

export type AgentPlanResultDraft = RetrievalPlanDraft | NeedsScopePlanDraft;

export class AgentPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentPlanValidationError';
  }
}

export function normalizeAgentPlanResult(input: AgentPlanInput, draft: AgentPlanResultDraft): AgentPlanResult {
  if (isNeedsScopePlanDraft(draft)) {
    return normalizeNeedsScopePlan(input, draft);
  }
  return normalizeRetrievalPlan(input, draft);
}

function isNeedsScopePlanDraft(draft: AgentPlanResultDraft): draft is NeedsScopePlanDraft {
  return draft.status === 'needs_scope' || 'missing' in draft;
}

export function normalizeRetrievalPlan(input: AgentPlanInput, draft: RetrievalPlanDraft): RetrievalPlan {
  assertVaultOnlyGrounding(draft.grounding);
  assertNonEmpty('task', draft.task);
  assertNonEmpty('topic', draft.topic);

  const outputKind = draft.output?.kind ?? 'answer';
  const requestedFormat = cleanOptionalString(draft.output?.requestedFormat);
  const dateRange = resolvePlanDateRange(input, draft);
  const pathGlobs =
    stableUniqueStrings(draft.filters?.pathGlobs ?? input.explicitPathGlobs).length > 0
      ? stableUniqueStrings(draft.filters?.pathGlobs ?? input.explicitPathGlobs)
      : dateRange?.defaulted === true
        ? stableUniqueStrings(input.dailyNotePathGlobs)
        : undefined;
  const tags = stableUniqueStrings(draft.filters?.tags);
  const filters: RetrievalPlan['filters'] = {
    ...(pathGlobs !== undefined && pathGlobs.length > 0 ? { pathGlobs } : {}),
    ...(dateRange !== undefined ? { dateRange } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
  const toolCalls = normalizeToolCalls(draft.toolCalls ?? [], filters);
  if (!toolCalls.some((toolCall) => toolCall.type === 'search_notes')) {
    throw new AgentPlanValidationError('ready plans must include at least one search_notes tool call');
  }

  const normalizedWithoutKey: Omit<RetrievalPlan, 'stablePlanKey'> = {
    planVersion: AGENT_RETRIEVAL_PLAN_VERSION,
    status: 'ready',
    task: draft.task.trim(),
    topic: draft.topic.trim(),
    entities: stableUniqueStrings(draft.entities),
    filters,
    output: {
      kind: outputKind,
      ...(requestedFormat !== undefined ? { requestedFormat } : {}),
      defaultFormat: AGENT_RETRIEVAL_DEFAULT_FORMAT,
    },
    toolCalls,
  };

  return {
    ...normalizedWithoutKey,
    stablePlanKey: createStablePlanKey(input, normalizedWithoutKey),
  };
}

export function normalizeNeedsScopePlan(input: AgentPlanInput, draft: NeedsScopePlanDraft): NeedsScopePlan {
  assertVaultOnlyGrounding(draft.grounding);
  if (draft.toolCalls?.some((toolCall) => toolCall.type === 'search_notes' || toolCall.type === 'read_note')) {
    throw new AgentPlanValidationError('needs_scope plans must not include search or read tool calls');
  }
  assertNonEmpty('reason', draft.reason);

  const normalizedWithoutKey: Omit<NeedsScopePlan, 'stablePlanKey'> = {
    planVersion: AGENT_RETRIEVAL_PLAN_VERSION,
    status: 'needs_scope',
    reason: draft.reason.trim(),
    missing: stableMissingFields(draft.missing),
  };

  return {
    ...normalizedWithoutKey,
    stablePlanKey: createStablePlanKey(input, normalizedWithoutKey),
  };
}

export function defaultOneWeekDateRange(anchorDate: string): AgentDateRange {
  const anchor = parseIsoDate(anchorDate);
  const start = new Date(Date.UTC(anchor.year, anchor.monthIndex, anchor.day - 6));
  return {
    start: formatUtcYmd(start),
    end: anchorDate,
    defaulted: true,
  };
}

export function createStablePlanKey(
  input: AgentPlanInput,
  normalizedPlan: Omit<AgentPlanResult, 'stablePlanKey'>,
): string {
  const keyMaterial = {
    planVersion: AGENT_RETRIEVAL_PLAN_VERSION,
    input: {
      userPromptHash: hashText(input.userPrompt),
      conversationHash: hashText(canonicalJson(input.conversation)),
      vaultOrganizationPromptHash:
        input.vaultOrganizationPrompt === undefined ? undefined : hashText(input.vaultOrganizationPrompt),
      explicitPathGlobs: stableUniqueStrings(input.explicitPathGlobs),
      explicitDateRange: normalizeDateRange(input.explicitDateRange),
      dailyNotePathGlobs: stableUniqueStrings(input.dailyNotePathGlobs),
      anchorDate: input.anchorDate,
      modelConfigId: input.modelConfigId,
      vaultIndexFingerprint: input.vaultIndexFingerprint,
    },
    plan: normalizedPlan,
  };
  return `agent-plan:${AGENT_RETRIEVAL_PLAN_VERSION}:${hashText(canonicalJson(keyMaterial))}`;
}

function resolvePlanDateRange(input: AgentPlanInput, draft: RetrievalPlanDraft): AgentDateRange | undefined {
  const explicitDateRange = normalizeDateRange(input.explicitDateRange);
  if (explicitDateRange !== undefined) {
    return explicitDateRange;
  }

  const draftDateRange = normalizeDateRange(draft.filters?.dateRange);
  if (draftDateRange !== undefined) {
    return draftDateRange;
  }

  if (draft.dateBoundedSynthesis === true) {
    return defaultOneWeekDateRange(input.anchorDate);
  }

  return undefined;
}

function normalizeToolCalls(toolCalls: AgentToolCallPlan[], inheritedFilters: RetrievalPlan['filters']): AgentToolCallPlan[] {
  const normalized = toolCalls.map((toolCall): Omit<AgentToolCallPlan, 'id'> => {
    const pathGlobs = stableUniqueStrings(toolCall.pathGlobs ?? inheritedFilters.pathGlobs);
    return {
      type: toolCall.type,
      reason: toolCall.reason.trim(),
      ...(cleanOptionalString(toolCall.query) !== undefined ? { query: cleanOptionalString(toolCall.query) } : {}),
      ...(pathGlobs.length > 0 ? { pathGlobs } : {}),
      ...(normalizeDateRange(toolCall.dateRange ?? inheritedFilters.dateRange) !== undefined
        ? { dateRange: normalizeDateRange(toolCall.dateRange ?? inheritedFilters.dateRange) }
        : {}),
      ...(stableUniqueStrings(toolCall.tags).length > 0 ? { tags: stableUniqueStrings(toolCall.tags) } : {}),
      ...(cleanOptionalString(toolCall.notePath) !== undefined ? { notePath: cleanOptionalString(toolCall.notePath) } : {}),
      ...(stableUniqueStrings(toolCall.nodeIds).length > 0 ? { nodeIds: stableUniqueStrings(toolCall.nodeIds) } : {}),
      ...(stableUniqueStrings(toolCall.fromPreviousSearchResultIds).length > 0
        ? { fromPreviousSearchResultIds: stableUniqueStrings(toolCall.fromPreviousSearchResultIds) }
        : {}),
    };
  });

  const uniqueBySemantics = new Map<string, Omit<AgentToolCallPlan, 'id'>>();
  for (const toolCall of normalized) {
    uniqueBySemantics.set(canonicalJson(toolCall), toolCall);
  }

  return [...uniqueBySemantics.values()]
    .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)))
    .map((toolCall, index) => ({
      id: `${toolCall.type}-${index + 1}`,
      ...toolCall,
    }));
}

function normalizeDateRange(dateRange: AgentDateRange | undefined): AgentDateRange | undefined {
  if (dateRange === undefined) {
    return undefined;
  }
  const start = cleanOptionalString(dateRange.start);
  const end = cleanOptionalString(dateRange.end);
  if (start === undefined && end === undefined) {
    return undefined;
  }
  if (start !== undefined) {
    parseIsoDate(start);
  }
  if (end !== undefined) {
    parseIsoDate(end);
  }
  return {
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
    ...(dateRange.defaulted === true ? { defaulted: true } : {}),
  };
}

function assertVaultOnlyGrounding(grounding: AgentGroundingValidation | undefined): void {
  if (grounding === undefined) {
    return;
  }
  if (grounding.allowedSource === 'external' || grounding.allowExternalSources === true) {
    throw new AgentPlanValidationError('plans cannot allow off-vault sources');
  }
  if (cleanOptionalString(grounding.groundingPolicyOverride) !== undefined) {
    throw new AgentPlanValidationError('plans cannot override the built-in grounding policy');
  }
}

function stableUniqueStrings(values: readonly string[] | undefined): string[] {
  if (values === undefined) {
    return [];
  }
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function stableMissingFields(values: Array<'topic' | 'scope' | 'output'>): Array<'topic' | 'scope' | 'output'> {
  const order: Array<'topic' | 'scope' | 'output'> = ['topic', 'scope', 'output'];
  const unique = new Set(values);
  return order.filter((value) => unique.has(value));
}

function cleanOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function assertNonEmpty(fieldName: string, value: string): void {
  if (value.trim().length === 0) {
    throw new AgentPlanValidationError(`${fieldName} is required`);
  }
}

function parseIsoDate(value: string): { year: number; monthIndex: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    throw new AgentPlanValidationError(`date must be YYYY-MM-DD: ${value}`);
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (formatUtcYmd(date) !== value) {
    throw new AgentPlanValidationError(`date must be a real YYYY-MM-DD value: ${value}`);
  }
  return {
    year,
    monthIndex,
    day,
  };
}

function formatUtcYmd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value));
}

function toCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toCanonicalValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort((a, b) => a.localeCompare(b))) {
      if (input[key] !== undefined) {
        output[key] = toCanonicalValue(input[key]);
      }
    }
    return output;
  }
  return value;
}
