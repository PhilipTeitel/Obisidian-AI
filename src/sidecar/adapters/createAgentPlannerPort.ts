import type { IAgentPlannerPort } from '../../core/ports/IAgentPlannerPort.js';
import { OllamaAgentPlannerAdapter } from './OllamaAgentPlannerAdapter.js';

export interface AgentPlannerAdapterConfig {
  baseUrl: string;
  model: string;
}

export function createAgentPlannerPort(kind: 'ollama', config: AgentPlannerAdapterConfig): IAgentPlannerPort {
  const c = { baseUrl: config.baseUrl.trim(), model: config.model.trim() };
  if (kind === 'ollama') {
    return new OllamaAgentPlannerAdapter(c);
  }
  const exhaustive: never = kind;
  throw new Error(`Unsupported agent planner provider: ${exhaustive}`);
}
