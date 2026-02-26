import type {
  ChunkRecord,
  EmbeddingVector,
  LocalVectorStorePaths,
  RuntimeBootstrapContext,
  VectorStoreMatch,
  VectorStoreQuery,
  VectorStoreRepositoryContract,
  VectorStoreRow,
  VectorStoreSchemaMetadata
} from "../types";
import { createRuntimeLogger } from "../logging/runtimeLogger";
import { resolveLocalVectorStorePaths } from "./vectorStorePaths";
import { VECTOR_STORE_MIGRATIONS } from "./vectorStoreSchema";

const VECTOR_STORE_STORAGE_KEY = "vectorStore";
const logger = createRuntimeLogger("LocalVectorStoreRepository");

interface PersistedVectorStoreState {
  schemaVersion: number;
  appliedMigrationIds: string[];
  paths: LocalVectorStorePaths;
  rows: VectorStoreRow[];
}

interface LocalVectorStoreRepositoryDeps {
  plugin: RuntimeBootstrapContext["plugin"];
  pluginId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

const normalizeTags = (tags: string[]): string[] => {
  return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))].sort((left, right) =>
    left.localeCompare(right)
  );
};

const isEmbeddingVector = (value: unknown): value is EmbeddingVector => {
  if (!isRecord(value)) {
    return false;
  }
  if (!Array.isArray(value.values) || !value.values.every(isFiniteNumber)) {
    return false;
  }
  if (!isFiniteNumber(value.dimensions)) {
    return false;
  }
  return value.values.length === value.dimensions;
};

const isVectorStoreRow = (value: unknown): value is VectorStoreRow => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.chunkId === "string" &&
    value.chunkId.length > 0 &&
    typeof value.notePath === "string" &&
    value.notePath.length > 0 &&
    typeof value.noteTitle === "string" &&
    value.noteTitle.length > 0 &&
    typeof value.snippet === "string" &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    isEmbeddingVector(value.embedding) &&
    isFiniteNumber(value.updatedAt)
  );
};

const toNormalizedVector = (vector: EmbeddingVector): EmbeddingVector => {
  return {
    values: [...vector.values],
    dimensions: vector.dimensions
  };
};

const toNormalizedRow = (row: VectorStoreRow): VectorStoreRow => {
  return {
    chunkId: row.chunkId,
    notePath: row.notePath,
    noteTitle: row.noteTitle,
    heading: row.heading,
    snippet: row.snippet,
    tags: normalizeTags(row.tags),
    embedding: toNormalizedVector(row.embedding),
    updatedAt: row.updatedAt
  };
};

const createDefaultSchemaMetadata = (paths: LocalVectorStorePaths): VectorStoreSchemaMetadata => {
  return {
    schemaVersion: VECTOR_STORE_MIGRATIONS.length,
    appliedMigrationIds: VECTOR_STORE_MIGRATIONS.map((migration) => migration.id),
    paths
  };
};

const createBaselineState = (paths: LocalVectorStorePaths): PersistedVectorStoreState => {
  const metadata = createDefaultSchemaMetadata(paths);
  return {
    schemaVersion: metadata.schemaVersion,
    appliedMigrationIds: metadata.appliedMigrationIds,
    paths: metadata.paths,
    rows: []
  };
};

const normalizeRows = (rows: VectorStoreRow[]): VectorStoreRow[] => {
  return rows
    .map((row) => toNormalizedRow(row))
    .sort((left, right) => left.chunkId.localeCompare(right.chunkId));
};

const parsePersistedState = (
  rawRoot: unknown,
  fallbackPaths: LocalVectorStorePaths
): PersistedVectorStoreState | null => {
  if (!isRecord(rawRoot)) {
    return null;
  }

  const rawState = rawRoot[VECTOR_STORE_STORAGE_KEY];
  if (!isRecord(rawState)) {
    return null;
  }

  if (!isFiniteNumber(rawState.schemaVersion)) {
    return null;
  }

  if (!Array.isArray(rawState.appliedMigrationIds) || !rawState.appliedMigrationIds.every((entry) => typeof entry === "string")) {
    return null;
  }

  if (!Array.isArray(rawState.rows) || !rawState.rows.every((entry) => isVectorStoreRow(entry))) {
    return null;
  }

  const rawPaths = rawState.paths;
  const paths =
    isRecord(rawPaths) &&
    typeof rawPaths.rootDir === "string" &&
    typeof rawPaths.sqliteDbPath === "string" &&
    typeof rawPaths.migrationsDir === "string"
      ? {
          rootDir: rawPaths.rootDir,
          sqliteDbPath: rawPaths.sqliteDbPath,
          migrationsDir: rawPaths.migrationsDir
        }
      : fallbackPaths;

  return {
    schemaVersion: rawState.schemaVersion,
    appliedMigrationIds: [...rawState.appliedMigrationIds],
    paths,
    rows: normalizeRows(rawState.rows)
  };
};

const computeVectorMagnitude = (vector: EmbeddingVector): number => {
  const magnitude = Math.sqrt(vector.values.reduce((sum, value) => sum + value * value, 0));
  return Number.isFinite(magnitude) ? magnitude : 0;
};

const cosineSimilarity = (left: EmbeddingVector, right: EmbeddingVector): number | null => {
  if (left.dimensions !== right.dimensions) {
    return null;
  }
  const leftMagnitude = computeVectorMagnitude(left);
  const rightMagnitude = computeVectorMagnitude(right);
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return null;
  }
  const dotProduct = left.values.reduce((sum, value, index) => sum + value * right.values[index], 0);
  return dotProduct / (leftMagnitude * rightMagnitude);
};

export class LocalVectorStoreRepository implements VectorStoreRepositoryContract {
  private readonly plugin: RuntimeBootstrapContext["plugin"];
  private readonly paths: LocalVectorStorePaths;
  private cache: PersistedVectorStoreState | null = null;

  public constructor(deps: LocalVectorStoreRepositoryDeps) {
    this.plugin = deps.plugin;
    this.paths = resolveLocalVectorStorePaths(deps.pluginId);
  }

  public async getSchemaMetadata(): Promise<VectorStoreSchemaMetadata> {
    const operationLogger = logger.withOperation();
    const startedAt = Date.now();
    const state = await this.ensureLoaded();
    operationLogger.info({
      event: "storage.vector_store.get_schema_metadata.completed",
      message: "Retrieved vector store schema metadata.",
      context: {
        schemaVersion: state.schemaVersion,
        appliedMigrationCount: state.appliedMigrationIds.length,
        elapsedMs: Date.now() - startedAt
      }
    });
    return {
      schemaVersion: state.schemaVersion,
      appliedMigrationIds: [...state.appliedMigrationIds],
      paths: state.paths
    };
  }

  public async replaceAllFromChunks(chunks: ChunkRecord[], vectors: EmbeddingVector[]): Promise<void> {
    const operationLogger = logger.withOperation();
    const startedAt = Date.now();
    const state = await this.ensureLoaded();
    const rows = this.createRowsFromChunks(chunks, vectors);
    this.cache = {
      ...state,
      rows
    };
    await this.persist();
    operationLogger.info({
      event: "storage.vector_store.replace_all.completed",
      message: "Replaced vector store rows from chunks.",
      context: {
        chunkCount: chunks.length,
        rowCount: rows.length,
        elapsedMs: Date.now() - startedAt
      }
    });
  }

  public async upsertFromChunks(chunks: ChunkRecord[], vectors: EmbeddingVector[]): Promise<void> {
    const operationLogger = logger.withOperation();
    const startedAt = Date.now();
    const state = await this.ensureLoaded();
    const upsertRows = this.createRowsFromChunks(chunks, vectors);
    const rowsByChunkId = new Map<string, VectorStoreRow>(state.rows.map((row) => [row.chunkId, row]));
    for (const row of upsertRows) {
      rowsByChunkId.set(row.chunkId, row);
    }

    this.cache = {
      ...state,
      rows: normalizeRows([...rowsByChunkId.values()])
    };
    await this.persist();
    operationLogger.info({
      event: "storage.vector_store.upsert.completed",
      message: "Upserted vector store rows from chunks.",
      context: {
        upsertCount: upsertRows.length,
        totalRowCount: this.cache.rows.length,
        elapsedMs: Date.now() - startedAt
      }
    });
  }

  public async deleteByNotePaths(notePaths: string[]): Promise<void> {
    const operationLogger = logger.withOperation();
    if (notePaths.length === 0) {
      operationLogger.info({
        event: "storage.vector_store.delete.skipped_empty",
        message: "Skipped vector store delete because note path list is empty."
      });
      return;
    }
    const startedAt = Date.now();
    const notePathSet = new Set(notePaths);
    const state = await this.ensureLoaded();
    this.cache = {
      ...state,
      rows: state.rows.filter((row) => !notePathSet.has(row.notePath))
    };
    await this.persist();
    operationLogger.info({
      event: "storage.vector_store.delete.completed",
      message: "Deleted vector store rows by note path.",
      context: {
        requestedNotePathCount: notePaths.length,
        remainingRowCount: this.cache.rows.length,
        elapsedMs: Date.now() - startedAt
      }
    });
  }

  public async queryNearestNeighbors(query: VectorStoreQuery): Promise<VectorStoreMatch[]> {
    const operationLogger = logger.withOperation();
    const startedAt = Date.now();
    const state = await this.ensureLoaded();
    if (query.topK <= 0) {
      operationLogger.info({
        event: "storage.vector_store.query.skipped",
        message: "Skipped vector store query because topK is non-positive.",
        context: {
          topK: query.topK
        }
      });
      return [];
    }

    const minScore = query.minScore ?? Number.NEGATIVE_INFINITY;
    const matches: VectorStoreMatch[] = [];
    for (const row of state.rows) {
      const score = cosineSimilarity(row.embedding, query.vector);
      if (score === null || score < minScore) {
        continue;
      }
      matches.push({
        ...toNormalizedRow(row),
        score
      });
    }

    matches.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.chunkId.localeCompare(right.chunkId);
    });

    const results = matches.slice(0, query.topK);
    operationLogger.info({
      event: "storage.vector_store.query.completed",
      message: "Completed vector store nearest-neighbor query.",
      context: {
        topK: query.topK,
        minScore: query.minScore,
        candidateCount: state.rows.length,
        resultCount: results.length,
        elapsedMs: Date.now() - startedAt
      }
    });
    return results;
  }

  private createRowsFromChunks(chunks: ChunkRecord[], vectors: EmbeddingVector[]): VectorStoreRow[] {
    if (chunks.length !== vectors.length) {
      throw new Error(
        `Chunk/vector length mismatch while writing vector store. chunks=${chunks.length}, vectors=${vectors.length}`
      );
    }

    return normalizeRows(
      chunks.map((chunk, index) => ({
        chunkId: chunk.id,
        notePath: chunk.source.notePath,
        noteTitle: chunk.source.noteTitle,
        heading: chunk.source.headingTrail[chunk.source.headingTrail.length - 1],
        snippet: chunk.content.slice(0, 280),
        tags: normalizeTags(chunk.source.tags),
        embedding: toNormalizedVector(vectors[index]),
        updatedAt: chunk.updatedAt
      }))
    );
  }

  private async ensureLoaded(): Promise<PersistedVectorStoreState> {
    if (this.cache) {
      logger.debug({
        event: "storage.vector_store.load.cache_hit",
        message: "Vector store loaded from in-memory cache."
      });
      return this.cache;
    }

    const startedAt = Date.now();
    const rawRoot = await this.plugin.loadData();
    const parsed = parsePersistedState(rawRoot, this.paths);
    this.cache = parsed ?? createBaselineState(this.paths);

    if (!parsed) {
      await this.persist();
    }

    logger.info({
      event: "storage.vector_store.load.completed",
      message: "Vector store loaded from plugin data.",
      context: {
        usedBaseline: !parsed,
        rowCount: this.cache.rows.length,
        elapsedMs: Date.now() - startedAt
      }
    });

    return this.cache;
  }

  private async persist(): Promise<void> {
    if (!this.cache) {
      return;
    }
    const startedAt = Date.now();

    const rawRoot = await this.plugin.loadData();
    const persistedRoot = isRecord(rawRoot) ? { ...rawRoot } : {};
    persistedRoot[VECTOR_STORE_STORAGE_KEY] = {
      schemaVersion: this.cache.schemaVersion,
      appliedMigrationIds: [...this.cache.appliedMigrationIds],
      paths: this.cache.paths,
      rows: normalizeRows(this.cache.rows)
    };
    await this.plugin.saveData(persistedRoot);
    logger.info({
      event: "storage.vector_store.persist.completed",
      message: "Persisted vector store state to plugin data.",
      context: {
        rowCount: this.cache.rows.length,
        elapsedMs: Date.now() - startedAt
      }
    });
  }
}
