import { describe, expect, it } from "vitest";
import { createPluginTestHarness } from "../harness/createPluginTestHarness";

interface ScaleScenario {
  id: string;
  noteCount: number;
  updatedCount: number;
  reindexMaxMs: number;
  searchMaxMs: number;
  incrementalMaxMs: number;
}

interface OperationMetric<T> {
  elapsedMs: number;
  result: T;
}

const SCENARIOS: ScaleScenario[] = [
  {
    id: "hundreds",
    noteCount: 300,
    updatedCount: 40,
    reindexMaxMs: 18_000,
    searchMaxMs: 2_500,
    incrementalMaxMs: 12_000
  },
  {
    id: "thousands",
    noteCount: 1_000,
    updatedCount: 120,
    reindexMaxMs: 45_000,
    searchMaxMs: 5_000,
    incrementalMaxMs: 25_000
  }
];

const createUpdatedIndexSet = (noteCount: number, updatedCount: number): Set<number> => {
  const limitedCount = Math.min(noteCount, updatedCount);
  const updatedIndexes = new Set<number>();
  for (let index = 0; index < limitedCount; index += 1) {
    updatedIndexes.add(index * Math.max(1, Math.floor(noteCount / limitedCount)));
  }
  return updatedIndexes;
};

const createScaleFixture = (noteCount: number, updatedIndexes: Set<number>) => {
  const fixture: Array<{ path: string; markdown: string; mtime: number }> = [];
  for (let index = 0; index < noteCount; index += 1) {
    const isUpdated = updatedIndexes.has(index);
    const revision = isUpdated ? 2 : 1;
    const semanticTopic = index % 25;
    fixture.push({
      path: `notes/scale-${index}.md`,
      markdown: `# Scale Note ${index}

Semantic benchmark content for topic ${semanticTopic}.
This note exists for REL-2 scale validation and indexing throughput checks.
Revision ${revision}.

- topic: ${semanticTopic}
- note-index: ${index}
`,
      mtime: revision * 100_000 + index
    });
  }
  return fixture;
};

const measure = async <T>(operation: () => Promise<T>): Promise<OperationMetric<T>> => {
  const startedAt = Date.now();
  const result = await operation();
  return {
    elapsedMs: Date.now() - startedAt,
    result
  };
};

describe("scale validation integration", () => {
  for (const scenario of SCENARIOS) {
    it(
      `validates indexing/search latency budgets for ${scenario.id} scenario`,
      async () => {
        const harness = createPluginTestHarness();

        harness.appHarness.setVaultMarkdownFiles(createScaleFixture(scenario.noteCount, new Set<number>()));
        await harness.runOnload();

        const runtime = await harness.ensureRuntimeServices();
        const reindexMetric = await measure(() => runtime.indexingService.reindexVault());
        const searchMetric = await measure(() =>
          runtime.searchService.search({
            query: "Semantic benchmark content for topic 7",
            topK: 10
          })
        );

        const updatedIndexes = createUpdatedIndexSet(scenario.noteCount, scenario.updatedCount);
        harness.appHarness.setVaultMarkdownFiles(createScaleFixture(scenario.noteCount, updatedIndexes));
        const incrementalMetric = await measure(() => runtime.indexingService.indexChanges());

        expect(reindexMetric.result.status).toBe("succeeded");
        expect(searchMetric.result.length).toBeGreaterThan(0);
        expect(incrementalMetric.result.status).toBe("succeeded");

        expect(reindexMetric.elapsedMs).toBeLessThanOrEqual(scenario.reindexMaxMs);
        expect(searchMetric.elapsedMs).toBeLessThanOrEqual(scenario.searchMaxMs);
        expect(incrementalMetric.elapsedMs).toBeLessThanOrEqual(scenario.incrementalMaxMs);

        console.info(
          `[REL-2][${scenario.id}] notes=${scenario.noteCount} reindexMs=${reindexMetric.elapsedMs} searchMs=${searchMetric.elapsedMs} incrementalMs=${incrementalMetric.elapsedMs}`
        );

        await harness.runOnunload();
      },
      120_000
    );
  }
});
