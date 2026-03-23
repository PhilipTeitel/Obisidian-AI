import type {
  AssembledContext,
  ContextAssemblyServiceContract,
  ContextTierUsage,
  HierarchicalContextBlock,
  HierarchicalStoreContract,
  LeafMatch,
  ObsidianAISettings
} from "../types";
import { createRuntimeLogger } from "../logging/runtimeLogger";
import { estimateTokens, truncateToTokenBudget } from "../utils/tokenEstimator";

export const DEFAULT_MATCHED_CONTENT_BUDGET = 2000;
export const DEFAULT_SIBLING_CONTEXT_BUDGET = 1000;
export const DEFAULT_PARENT_SUMMARY_BUDGET = 1000;

const logger = createRuntimeLogger("ContextAssemblyService");

export interface ContextAssemblyServiceDeps {
  hierarchicalStore: HierarchicalStoreContract;
  getSettings: () => ObsidianAISettings;
}

interface TokenBudgets {
  matchedContentBudget: number;
  siblingContextBudget: number;
  parentSummaryBudget: number;
}

const resolveBudgets = (settings: ObsidianAISettings): TokenBudgets => ({
  matchedContentBudget: settings.matchedContentBudget ?? DEFAULT_MATCHED_CONTENT_BUDGET,
  siblingContextBudget: settings.siblingContextBudget ?? DEFAULT_SIBLING_CONTEXT_BUDGET,
  parentSummaryBudget: settings.parentSummaryBudget ?? DEFAULT_PARENT_SUMMARY_BUDGET
});

export class ContextAssemblyService implements ContextAssemblyServiceContract {
  private disposed = false;
  private readonly deps: ContextAssemblyServiceDeps;

  public constructor(deps: ContextAssemblyServiceDeps) {
    this.deps = deps;
  }

  public async init(): Promise<void> {
    this.disposed = false;
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
  }

  public async assemble(matches: LeafMatch[]): Promise<AssembledContext> {
    this.ensureNotDisposed();
    const operationLogger = logger.withOperation();
    const startTime = Date.now();

    if (matches.length === 0) {
      const emptyResult: AssembledContext = {
        blocks: [],
        tierUsage: { matchedContentTokens: 0, siblingContextTokens: 0, parentSummaryTokens: 0 }
      };
      operationLogger.info({
        event: "retrieval.phase3.completed",
        message: "Phase 3 context assembly completed: 0 matches.",
        context: { blockCount: 0, elapsedMs: 0 }
      });
      return emptyResult;
    }

    const budgets = resolveBudgets(this.deps.getSettings());
    const store = this.deps.hierarchicalStore;

    const blocks: HierarchicalContextBlock[] = [];
    const tierUsage: ContextTierUsage = {
      matchedContentTokens: 0,
      siblingContextTokens: 0,
      parentSummaryTokens: 0
    };

    let remainingMatchedBudget = budgets.matchedContentBudget;
    let remainingSiblingBudget = budgets.siblingContextBudget;
    let remainingParentBudget = budgets.parentSummaryBudget;

    for (const match of matches) {
      const { node, ancestorChain } = match;

      const headingTrail = node.headingTrail.length > 0
        ? node.headingTrail
        : ancestorChain
            .slice()
            .reverse()
            .filter((a) => a.nodeType === "topic" || a.nodeType === "subtopic")
            .map((a) => a.headingTrail[a.headingTrail.length - 1] ?? a.content.slice(0, 80))
            .filter(Boolean);

      const matchedContent = truncateToTokenBudget(node.content, remainingMatchedBudget);
      const matchedTokens = estimateTokens(matchedContent);
      remainingMatchedBudget = Math.max(0, remainingMatchedBudget - matchedTokens);
      tierUsage.matchedContentTokens += matchedTokens;

      let siblingContent = "";
      if (node.parentId && remainingSiblingBudget > 0) {
        const siblings = await store.getSiblings(node.nodeId);
        const otherSiblings = siblings.filter((s) => s.nodeId !== node.nodeId);
        const siblingTexts = otherSiblings.map((s) => s.content);
        const joined = siblingTexts.join("\n\n");
        siblingContent = truncateToTokenBudget(joined, remainingSiblingBudget);
        const siblingTokens = estimateTokens(siblingContent);
        remainingSiblingBudget = Math.max(0, remainingSiblingBudget - siblingTokens);
        tierUsage.siblingContextTokens += siblingTokens;
      }

      let parentSummary = "";
      if (remainingParentBudget > 0) {
        const summaryParts: string[] = [];
        for (const ancestor of ancestorChain) {
          const summary = await store.getSummary(ancestor.nodeId);
          if (summary) {
            summaryParts.push(summary.summary);
          }
        }
        const joined = summaryParts.join(" ");
        parentSummary = truncateToTokenBudget(joined, remainingParentBudget);
        const parentTokens = estimateTokens(parentSummary);
        remainingParentBudget = Math.max(0, remainingParentBudget - parentTokens);
        tierUsage.parentSummaryTokens += parentTokens;
      }

      blocks.push({
        notePath: node.notePath,
        noteTitle: node.noteTitle,
        headingTrail,
        matchedContent,
        siblingContent,
        parentSummary,
        score: match.score
      });
    }

    const elapsed = Date.now() - startTime;

    operationLogger.info({
      event: "retrieval.phase3.completed",
      message: `Phase 3 context assembly completed: ${blocks.length} blocks.`,
      context: {
        blockCount: blocks.length,
        elapsedMs: elapsed
      }
    });

    operationLogger.info({
      event: "context.assembly.budget_usage",
      message: "Context assembly token budget usage.",
      context: {
        matchedContentTokens: tierUsage.matchedContentTokens,
        siblingContextTokens: tierUsage.siblingContextTokens,
        parentSummaryTokens: tierUsage.parentSummaryTokens,
        matchedContentBudget: budgets.matchedContentBudget,
        siblingContextBudget: budgets.siblingContextBudget,
        parentSummaryBudget: budgets.parentSummaryBudget
      }
    });

    return { blocks, tierUsage };
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error("ContextAssemblyService is disposed.");
    }
  }
}
