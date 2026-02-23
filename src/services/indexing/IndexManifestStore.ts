import type { IndexConsistencyIssue, IndexManifest, IndexedNoteFingerprint, RuntimeBootstrapContext } from "../../types";

const INDEX_MANIFEST_STORAGE_KEY = "indexManifest";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const isValidFingerprint = (value: unknown): value is IndexedNoteFingerprint => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.notePath === "string" &&
    value.notePath.trim().length > 0 &&
    typeof value.noteHash === "string" &&
    value.noteHash.trim().length > 0 &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt)
  );
};

const createEmptyManifest = (): IndexManifest => {
  return {
    version: 1,
    updatedAt: 0,
    notes: []
  };
};

const normalizeManifest = (manifest: IndexManifest): IndexManifest => {
  const normalizedNotes = [...manifest.notes].sort((left, right) => left.notePath.localeCompare(right.notePath));
  return {
    version: 1,
    updatedAt: manifest.updatedAt,
    notes: normalizedNotes
  };
};

const createShapeIssue = (): IndexConsistencyIssue => {
  return {
    code: "MANIFEST_SHAPE_INVALID",
    message: "Persisted index manifest payload is malformed and will be reset.",
    recoverable: true
  };
};

const createUnsupportedVersionIssue = (): IndexConsistencyIssue => {
  return {
    code: "MANIFEST_VERSION_UNSUPPORTED",
    message: "Persisted index manifest version is unsupported and will be reset.",
    recoverable: true
  };
};

export interface IndexManifestStoreDeps {
  plugin: RuntimeBootstrapContext["plugin"];
}

export interface ManifestLoadResult {
  manifest: IndexManifest;
  issues: IndexConsistencyIssue[];
}

export class IndexManifestStore {
  private readonly plugin: RuntimeBootstrapContext["plugin"];

  public constructor(deps: IndexManifestStoreDeps) {
    this.plugin = deps.plugin;
  }

  public async load(): Promise<IndexManifest> {
    const result = await this.loadWithIssues();
    return result.manifest;
  }

  public async loadWithIssues(): Promise<ManifestLoadResult> {
    const rawData = await this.plugin.loadData();
    if (rawData === null || rawData === undefined) {
      return {
        manifest: createEmptyManifest(),
        issues: []
      };
    }

    if (!isRecord(rawData)) {
      return {
        manifest: createEmptyManifest(),
        issues: [createShapeIssue()]
      };
    }

    const rawManifest = rawData[INDEX_MANIFEST_STORAGE_KEY];
    if (rawManifest === undefined || rawManifest === null) {
      return {
        manifest: createEmptyManifest(),
        issues: []
      };
    }

    if (!isRecord(rawManifest)) {
      return {
        manifest: createEmptyManifest(),
        issues: [createShapeIssue()]
      };
    }

    if (rawManifest.version !== 1) {
      return {
        manifest: createEmptyManifest(),
        issues: [createUnsupportedVersionIssue()]
      };
    }

    if (!Array.isArray(rawManifest.notes)) {
      return {
        manifest: createEmptyManifest(),
        issues: [createShapeIssue()]
      };
    }

    if (!rawManifest.notes.every((entry) => isValidFingerprint(entry))) {
      return {
        manifest: createEmptyManifest(),
        issues: [createShapeIssue()]
      };
    }

    const updatedAt =
      typeof rawManifest.updatedAt === "number" && Number.isFinite(rawManifest.updatedAt) ? rawManifest.updatedAt : 0;

    return {
      manifest: normalizeManifest({
        version: 1,
        updatedAt,
        notes: rawManifest.notes
      }),
      issues: []
    };
  }

  public async save(manifest: IndexManifest): Promise<void> {
    const rawData = await this.plugin.loadData();
    const persistedRoot = isRecord(rawData) ? { ...rawData } : {};
    persistedRoot[INDEX_MANIFEST_STORAGE_KEY] = normalizeManifest(manifest);
    await this.plugin.saveData(persistedRoot);
  }

  public async resetToBaseline(updatedAt = Date.now()): Promise<IndexManifest> {
    const baseline: IndexManifest = {
      version: 1,
      updatedAt,
      notes: []
    };
    await this.save(baseline);
    return baseline;
  }
}
