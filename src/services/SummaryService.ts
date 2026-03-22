import type {
  ChatRequest,
  ChatStreamEvent,
  DocumentNode,
  DocumentTree,
  HierarchicalStoreContract,
  ObsidianAISettings,
  ProviderRegistryContract,
  RuntimeServiceLifecycle,
  SummaryRecord
} from "../types";
import { createRuntimeLogger } from "../logging/runtimeLogger";
import { estimateTokens } from "../utils/tokenEstimator";

export const SUMMARY_PROMPT_VERSION = "v1";
export const SHORT_LEAF_TOKEN_THRESHOLD = 200;
export const SUMMARY_MAX_TOKENS_DEFAULT = 100;

const SUMMARY_SYSTEM_PROMPT =
  "You are a summarization assistant. Produce a concise 1–2 sentence summary of the provided content. " +
  "Preserve key terms, entities, and relationships. Do not editorialize or add information not present in the source.";

const buildLeafPrompt = (content: string): string =>
  `Summarize the following content in 1–2 sentences:\n\n${content}`;

const buildParentPrompt = (nodeType: string, childSummaries: string[]): string =>
  `Summarize the following ${nodeType} based on its child summaries. Produce a concise 1–2 sentence summary:\n\n${childSummaries.join("\n\n")}`;

export interface SummaryServiceDeps {
  providerRegistry: ProviderRegistryContract;
  hierarchicalStore: HierarchicalStoreContract;
  getSettings: () => ObsidianAISettings;
}

export interface SummaryGenerationResult {
  nodeId: string;
  skipped: boolean;
  error?: string;
}

export interface StaleSummaryInfo {
  nodeId: string;
  nodeUpdatedAt: number;
  summaryGeneratedAt: number | null;
}

export interface SummaryProgressEvent {
  completed: number;
  total: number;
  currentNodeId: string;
  currentNodeType: string;
}

export interface SummaryGenerationOptions {
  onNodeProcessed?: (event: SummaryProgressEvent) => void;
}

export const SUMMARY_STAGE_LABEL = "Summarize";

const isLeafType = (nodeType: string): boolean =>
  nodeType === "paragraph" || nodeType === "bullet";

const collectTokens = async (stream: AsyncIterable<ChatStreamEvent>): Promise<string> => {
  let result = "";
  for await (const event of stream) {
    if (event.type === "token") {
      result += event.text;
    } else if (event.type === "error") {
      throw new Error(event.message);
    }
  }
  return result.trim();
};

const sortNodesByDepthDesc = (nodes: DocumentNode[]): DocumentNode[] =>
  [...nodes].sort((a, b) => b.depth - a.depth);

export class SummaryService implements RuntimeServiceLifecycle {
  private disposed = false;
  private readonly deps: SummaryServiceDeps;
  private readonly logger = createRuntimeLogger("SummaryService");

  public constructor(deps: SummaryServiceDeps) {
    this.deps = deps;
  }

  public async init(): Promise<void> {
    this.disposed = false;
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
  }

  public async generateSummaries(
    tree: DocumentTree,
    options?: SummaryGenerationOptions
  ): Promise<SummaryGenerationResult[]> {
    this.ensureNotDisposed();

    const allNodes = Array.from(tree.nodes.values());
    const sorted = sortNodesByDepthDesc(allNodes);

    this.logger.info({
      event: "summary.generate.started",
      message: `Starting summary generation for ${sorted.length} nodes.`,
      context: { nodeCount: sorted.length, notePath: tree.root.notePath }
    });

    const startTime = Date.now();
    const results: SummaryGenerationResult[] = [];
    const summaryCache = new Map<string, string>();
    let skippedCount = 0;
    let errorCount = 0;
    let completedCount = 0;

    for (const node of sorted) {
      try {
        const result = await this.processNode(node, tree, summaryCache);
        results.push(result);
        if (result.skipped) {
          skippedCount++;
        }
        if (result.error) {
          errorCount++;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        errorCount++;
        results.push({ nodeId: node.nodeId, skipped: false, error: message });
        this.logger.warn({
          event: "summary.generate.node_failed",
          message: `Summary generation failed for node ${node.nodeId}: ${message}`,
          context: { nodeId: node.nodeId, nodeType: node.nodeType }
        });
      }

      completedCount++;
      this.safeInvokeProgressCallback(options?.onNodeProcessed, {
        completed: completedCount,
        total: sorted.length,
        currentNodeId: node.nodeId,
        currentNodeType: node.nodeType
      });
    }

    const elapsed = Date.now() - startTime;
    this.logger.info({
      event: "summary.generate.completed",
      message: `Summary generation completed: ${results.length} processed, ${skippedCount} skipped, ${errorCount} errors in ${elapsed}ms.`,
      context: {
        totalNodes: results.length,
        skippedCount,
        errorCount,
        elapsedMs: elapsed,
        notePath: tree.root.notePath
      }
    });

    return results;
  }

  public async regenerateFromNode(nodeId: string): Promise<SummaryGenerationResult[]> {
    this.ensureNotDisposed();

    const results: SummaryGenerationResult[] = [];
    const node = await this.deps.hierarchicalStore.getNode(nodeId);
    if (!node) {
      return results;
    }

    const ancestorChain = await this.deps.hierarchicalStore.getAncestorChain(nodeId);
    const nodesToProcess = [node, ...ancestorChain];

    for (const current of nodesToProcess) {
      try {
        const result = await this.processStoredNode(current);
        results.push(result);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ nodeId: current.nodeId, skipped: false, error: message });
        this.logger.warn({
          event: "summary.generate.node_failed",
          message: `Summary regeneration failed for node ${current.nodeId}: ${message}`,
          context: { nodeId: current.nodeId, nodeType: current.nodeType }
        });
      }
    }

    return results;
  }

  public async detectStaleSummaries(nodes: DocumentNode[]): Promise<StaleSummaryInfo[]> {
    this.ensureNotDisposed();
    const stale: StaleSummaryInfo[] = [];

    for (const node of nodes) {
      const summary = await this.deps.hierarchicalStore.getSummary(node.nodeId);
      if (!summary) {
        stale.push({ nodeId: node.nodeId, nodeUpdatedAt: node.updatedAt, summaryGeneratedAt: null });
        continue;
      }
      if (summary.generatedAt < node.updatedAt) {
        stale.push({ nodeId: node.nodeId, nodeUpdatedAt: node.updatedAt, summaryGeneratedAt: summary.generatedAt });
      }
    }

    return stale;
  }

  public async propagateSummariesForChangedNodes(changedNodeIds: string[]): Promise<SummaryGenerationResult[]> {
    this.ensureNotDisposed();

    if (changedNodeIds.length === 0) {
      return [];
    }

    this.logger.info({
      event: "summary.propagate.started",
      message: `Starting incremental summary propagation for ${changedNodeIds.length} changed nodes.`,
      context: { changedNodeCount: changedNodeIds.length }
    });

    const startTime = Date.now();
    const results: SummaryGenerationResult[] = [];
    const processedNodeIds = new Set<string>();

    const sortedNodeIds = await this.sortByDepthDesc(changedNodeIds);

    for (const nodeId of sortedNodeIds) {
      if (processedNodeIds.has(nodeId)) {
        continue;
      }

      const node = await this.deps.hierarchicalStore.getNode(nodeId);
      if (!node) {
        this.logger.debug({
          event: "summary.propagate.node_not_found",
          message: `Skipping non-existent node ${nodeId} during propagation.`,
          context: { nodeId }
        });
        continue;
      }

      const ancestorChain = await this.deps.hierarchicalStore.getAncestorChain(nodeId);
      const nodesToProcess = [node, ...ancestorChain];

      for (const current of nodesToProcess) {
        if (processedNodeIds.has(current.nodeId)) {
          continue;
        }
        processedNodeIds.add(current.nodeId);

        try {
          const result = await this.processStoredNode(current);
          results.push(result);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({ nodeId: current.nodeId, skipped: false, error: message });
          this.logger.warn({
            event: "summary.propagate.node_failed",
            message: `Summary propagation failed for node ${current.nodeId}: ${message}`,
            context: { nodeId: current.nodeId, nodeType: current.nodeType }
          });
        }
      }
    }

    const elapsed = Date.now() - startTime;
    this.logger.info({
      event: "summary.propagate.completed",
      message: `Incremental summary propagation completed: ${results.length} regenerated from ${changedNodeIds.length} changed nodes in ${elapsed}ms.`,
      context: {
        changedNodeCount: changedNodeIds.length,
        regeneratedCount: results.length,
        elapsedMs: elapsed
      }
    });

    return results;
  }

  private async sortByDepthDesc(nodeIds: string[]): Promise<string[]> {
    const nodesWithDepth: Array<{ nodeId: string; depth: number }> = [];
    for (const nodeId of nodeIds) {
      const node = await this.deps.hierarchicalStore.getNode(nodeId);
      if (node) {
        nodesWithDepth.push({ nodeId, depth: node.depth });
      }
    }
    nodesWithDepth.sort((a, b) => b.depth - a.depth);
    return nodesWithDepth.map((n) => n.nodeId);
  }

  private async processNode(
    node: DocumentNode,
    tree: DocumentTree,
    summaryCache: Map<string, string>
  ): Promise<SummaryGenerationResult> {
    const isLeaf = isLeafType(node.nodeType);
    const tokenCount = estimateTokens(node.content);

    if (isLeaf && tokenCount <= SHORT_LEAF_TOKEN_THRESHOLD) {
      await this.storeContentAsSummary(node);
      summaryCache.set(node.nodeId, node.content);
      this.logger.debug({
        event: "summary.generate.skipped",
        message: `Skipped LLM for short leaf node ${node.nodeId} (${tokenCount} tokens).`,
        context: { nodeId: node.nodeId, nodeType: node.nodeType, tokenCount }
      });
      return { nodeId: node.nodeId, skipped: true };
    }

    if (isLeaf) {
      const summary = await this.generateLlmSummary(buildLeafPrompt(node.content));
      await this.storeSummary(node, summary);
      summaryCache.set(node.nodeId, summary);
      this.logger.debug({
        event: "summary.generate.completed",
        message: `Generated summary for leaf node ${node.nodeId} (${summary.length} chars).`,
        context: { nodeId: node.nodeId, nodeType: node.nodeType, summaryLength: summary.length }
      });
      return { nodeId: node.nodeId, skipped: false };
    }

    const childSummaries = this.collectChildSummaries(node, tree, summaryCache);

    if (childSummaries.length === 0) {
      await this.storeContentAsSummary(node);
      summaryCache.set(node.nodeId, node.content);
      this.logger.debug({
        event: "summary.generate.skipped",
        message: `Skipped LLM for node ${node.nodeId} with no child summaries.`,
        context: { nodeId: node.nodeId, nodeType: node.nodeType }
      });
      return { nodeId: node.nodeId, skipped: true };
    }

    const summary = await this.generateLlmSummary(
      buildParentPrompt(node.nodeType, childSummaries)
    );
    await this.storeSummary(node, summary);
    summaryCache.set(node.nodeId, summary);
    this.logger.debug({
      event: "summary.generate.completed",
      message: `Generated summary for ${node.nodeType} node ${node.nodeId} (${summary.length} chars).`,
      context: { nodeId: node.nodeId, nodeType: node.nodeType, summaryLength: summary.length }
    });
    return { nodeId: node.nodeId, skipped: false };
  }

  private async processStoredNode(node: DocumentNode): Promise<SummaryGenerationResult> {
    const isLeaf = isLeafType(node.nodeType);
    const tokenCount = estimateTokens(node.content);

    if (isLeaf && tokenCount <= SHORT_LEAF_TOKEN_THRESHOLD) {
      await this.storeContentAsSummary(node);
      return { nodeId: node.nodeId, skipped: true };
    }

    if (isLeaf) {
      const summary = await this.generateLlmSummary(buildLeafPrompt(node.content));
      await this.storeSummary(node, summary);
      return { nodeId: node.nodeId, skipped: false };
    }

    const children = await this.deps.hierarchicalStore.getChildren(node.nodeId);
    const childSummaries: string[] = [];
    for (const child of children) {
      const stored = await this.deps.hierarchicalStore.getSummary(child.nodeId);
      if (stored) {
        childSummaries.push(stored.summary);
      }
    }

    if (childSummaries.length === 0) {
      await this.storeContentAsSummary(node);
      return { nodeId: node.nodeId, skipped: true };
    }

    const summary = await this.generateLlmSummary(
      buildParentPrompt(node.nodeType, childSummaries)
    );
    await this.storeSummary(node, summary);
    return { nodeId: node.nodeId, skipped: false };
  }

  private collectChildSummaries(
    node: DocumentNode,
    tree: DocumentTree,
    summaryCache: Map<string, string>
  ): string[] {
    const summaries: string[] = [];
    for (const childId of node.childIds) {
      const cached = summaryCache.get(childId);
      if (cached) {
        summaries.push(cached);
      }
    }
    return summaries;
  }

  private async generateLlmSummary(userPrompt: string): Promise<string> {
    const settings = this.deps.getSettings();
    const provider = this.deps.providerRegistry.getChatProvider();

    const request: ChatRequest = {
      providerId: provider.id,
      model: settings.chatModel,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      context: [],
      timeoutMs: settings.chatTimeout
    };

    const stream = provider.complete(request);
    return collectTokens(stream);
  }

  private async storeSummary(node: DocumentNode, summary: string): Promise<void> {
    const settings = this.deps.getSettings();
    const record: SummaryRecord = {
      nodeId: node.nodeId,
      summary,
      modelUsed: settings.chatModel,
      promptVersion: SUMMARY_PROMPT_VERSION,
      generatedAt: Date.now()
    };
    await this.deps.hierarchicalStore.upsertSummary(node.nodeId, record);
  }

  private async storeContentAsSummary(node: DocumentNode): Promise<void> {
    const record: SummaryRecord = {
      nodeId: node.nodeId,
      summary: node.content,
      modelUsed: "content-passthrough",
      promptVersion: SUMMARY_PROMPT_VERSION,
      generatedAt: Date.now()
    };
    await this.deps.hierarchicalStore.upsertSummary(node.nodeId, record);
  }

  private safeInvokeProgressCallback(
    callback: SummaryGenerationOptions["onNodeProcessed"],
    event: SummaryProgressEvent
  ): void {
    if (!callback) {
      return;
    }
    try {
      callback(event);
    } catch (error: unknown) {
      this.logger.warn({
        event: "summary.generate.progress_callback_failed",
        message: "Summary progress callback failed and was ignored.",
        context: {
          nodeId: event.currentNodeId,
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error("SummaryService is disposed.");
    }
  }
}
