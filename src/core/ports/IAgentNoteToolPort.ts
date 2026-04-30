import type { AgentNoteToolResult, AgentNoteToolRunInput } from '../domain/agentNoteTools.js';

/** Provider-neutral bounded note-tool runner port (AGT-3 / ADR-018). */
export interface IAgentNoteToolPort {
  runTool(input: AgentNoteToolRunInput): Promise<AgentNoteToolResult>;
}
