import {
  AGENT_PLANNER_BUDGETS,
  AgentPlanValidationError,
  normalizeAgentPlanResult,
  normalizeNeedsScopePlan,
  type AgentPlanInput,
  type AgentPlanResult,
  type AgentPlanResultDraft,
} from '../../core/domain/agentRetrievalPlan.js';
import { normalizeProviderTokenUsage } from '../../core/domain/agentRunTrace.js';
import type { IAgentPlannerPort } from '../../core/ports/IAgentPlannerPort.js';

export interface OllamaAgentPlannerConfig {
  baseUrl: string;
  model: string;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaAgentPlannerError extends Error {
  constructor(
    message: string,
    readonly metadata: { status?: number; baseUrl: string; model: string },
  ) {
    super(message);
    this.name = 'OllamaAgentPlannerError';
  }
}

function trimBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function ollamaChatUrl(baseUrl: string): string {
  return `${trimBaseUrl(baseUrl)}/api/chat`;
}

export class OllamaAgentPlannerAdapter implements IAgentPlannerPort {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: OllamaAgentPlannerConfig) {
    this.baseUrl = trimBaseUrl(config.baseUrl);
    this.model = config.model.trim();
  }

  async planRetrieval(input: AgentPlanInput): Promise<AgentPlanResult> {
    const res = await fetch(ollamaChatUrl(this.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: 'json',
        options: {
          num_predict: AGENT_PLANNER_BUDGETS.maxPlannerOutputTokens,
        },
        messages: buildPlannerMessages(input),
      }),
    });
    if (!res.ok) {
      throw new OllamaAgentPlannerError(`Ollama planner HTTP ${res.status} for model ${this.model}`, {
        status: res.status,
        baseUrl: this.baseUrl,
        model: this.model,
      });
    }

    const body = parseChatResponse(await res.json(), this.baseUrl, this.model);
    const usage = normalizeProviderTokenUsage({
      promptTokens: body.prompt_eval_count,
      completionTokens: body.eval_count,
    });

    let plan: AgentPlanResult;
    try {
      const draft = parsePlannerDraft(body.message?.content);
      plan = normalizeAgentPlanResult(input, draft);
    } catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof AgentPlanValidationError)) {
        throw error;
      }
      plan = failClosedNeedsScopePlan(input);
    }

    return {
      ...plan,
      usage,
    };
  }
}

function buildPlannerMessages(input: AgentPlanInput): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: [
        'You are a vault-only retrieval planner.',
        'Return only one JSON object and no prose.',
        'Allowed statuses: ready, needs_scope.',
        'Allowed ready tool types: search_notes, read_note, assemble_draft.',
        'A needs_scope plan must not include search_notes or read_note tool calls.',
        'Never request or allow external sources, raw note content, API keys, secrets, vault writes, or tool execution.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        userPrompt: input.userPrompt,
        vaultOrganizationPrompt: input.vaultOrganizationPrompt,
        explicitPathGlobs: input.explicitPathGlobs,
        explicitDateRange: input.explicitDateRange,
        dailyNotePathGlobs: input.dailyNotePathGlobs,
        anchorDate: input.anchorDate,
        modelConfigId: input.modelConfigId,
        vaultIndexFingerprint: input.vaultIndexFingerprint,
      }),
    },
  ];
}

function parseChatResponse(value: unknown, baseUrl: string, model: string): OllamaChatResponse {
  if (value === null || typeof value !== 'object') {
    throw new OllamaAgentPlannerError('Ollama planner response must be an object', {
      baseUrl,
      model,
    });
  }
  const record = value as Record<string, unknown>;
  const message = record.message;
  let content: string | undefined;
  if (message !== null && typeof message === 'object') {
    const candidate = (message as Record<string, unknown>).content;
    if (typeof candidate === 'string') {
      content = candidate;
    }
  }
  return {
    ...(content !== undefined ? { message: { content } } : {}),
    ...(typeof record.prompt_eval_count === 'number' ? { prompt_eval_count: record.prompt_eval_count } : {}),
    ...(typeof record.eval_count === 'number' ? { eval_count: record.eval_count } : {}),
  };
}

function parsePlannerDraft(raw: string | undefined): AgentPlanResultDraft {
  if (raw === undefined) {
    throw new SyntaxError('Ollama planner response missing JSON plan');
  }
  const parsed = JSON.parse(stripOptionalJsonFence(raw)) as unknown;
  if (parsed === null || typeof parsed !== 'object') {
    throw new SyntaxError('Ollama planner JSON plan must be an object');
  }
  return parsed as AgentPlanResultDraft;
}

function stripOptionalJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const match = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function failClosedNeedsScopePlan(input: AgentPlanInput): AgentPlanResult {
  return normalizeNeedsScopePlan(input, {
    reason: 'Planner response was invalid or unsafe; provide a topic, folder, tag, or date scope before I search.',
    missing: ['scope'],
  });
}
