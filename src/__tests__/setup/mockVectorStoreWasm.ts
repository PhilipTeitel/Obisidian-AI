import { vi } from "vitest";

/**
 * Node/Vitest cannot load the sqlite-vec WASM bundle; integration tests use real bootstrap and
 * hit the hierarchical store on first indexing — stub the lazy opener while keeping types/exports stable.
 */
vi.mock("../../storage/sqlite/openVectorStoreDatabase", () => ({
  openVectorStoreDatabaseLazy: vi.fn(async () => ({
    close: vi.fn(async () => undefined)
  })),
  noopOpenVectorStoreDatabase: async () => ({
    close: async () => undefined
  })
}));
