import type { AgentPlanInput, AgentPlanResult } from '../domain/agentRetrievalPlan.js';

/** Provider-neutral pre-retrieval planner port (AGT-2 / ADR-005 / ADR-018). */
export interface IAgentPlannerPort {
  planRetrieval(input: AgentPlanInput): Promise<AgentPlanResult>;
}
