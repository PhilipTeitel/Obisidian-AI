import type { AgentServiceContract, RuntimeBootstrapContext } from "../types";

export interface AgentServiceDeps {
  getSettings: RuntimeBootstrapContext["getSettings"];
  notify: RuntimeBootstrapContext["notify"];
}

export class AgentService implements AgentServiceContract {
  private disposed = false;
  private readonly deps: AgentServiceDeps;

  public constructor(deps: AgentServiceDeps) {
    this.deps = deps;
  }

  public async init(): Promise<void> {
    this.disposed = false;
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
  }

  public async createNote(path: string, content: string): Promise<void> {
    if (this.disposed) {
      throw new Error("AgentService is disposed.");
    }

    const maxNoteSize = this.deps.getSettings().maxGeneratedNoteSize;
    if (content.length > maxNoteSize) {
      this.deps.notify(`Create note blocked: content exceeds max size (${maxNoteSize}).`);
      return;
    }

    this.deps.notify(`Create note is not implemented yet for path: ${path}`);
  }

  public async updateNote(path: string, content: string): Promise<void> {
    if (this.disposed) {
      throw new Error("AgentService is disposed.");
    }

    const maxNoteSize = this.deps.getSettings().maxGeneratedNoteSize;
    if (content.length > maxNoteSize) {
      this.deps.notify(`Update note blocked: content exceeds max size (${maxNoteSize}).`);
      return;
    }

    this.deps.notify(`Update note is not implemented yet for path: ${path}`);
  }
}
