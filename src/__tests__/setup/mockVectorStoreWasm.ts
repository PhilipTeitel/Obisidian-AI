import { vi } from "vitest";
import type { SqliteDatabaseHandle } from "../../storage/sqlite/openVectorStoreDatabase";

type StubDb = {
  exec: ReturnType<typeof vi.fn>;
  selectValue: ReturnType<typeof vi.fn>;
  selectObjects: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const createStubHandle = (): SqliteDatabaseHandle => {
  const h: StubDb = {
    exec: vi.fn(),
    selectValue: vi.fn(),
    selectObjects: vi.fn(() => []),
    transaction: vi.fn(),
    close: vi.fn(async () => undefined)
  };
  h.transaction.mockImplementation(<T>(cb: (db: StubDb) => T) => cb(h));
  return h as unknown as SqliteDatabaseHandle;
};

/**
 * Node/Vitest cannot load the sqlite-vec WASM bundle; hierarchical unit tests use
 * {@link MemoryHierarchicalStore} via `hierarchicalTestBackend`. This stub satisfies
 * `SqliteDatabaseHandle` when code paths open the WASM DB (e.g. lazy-open lifecycle checks).
 */
vi.mock("../../storage/sqlite/openVectorStoreDatabase", () => ({
  openVectorStoreDatabaseLazy: vi.fn(async () => createStubHandle()),
  noopOpenVectorStoreDatabase: async () => ({
    exec: () => {
      throw new Error("noopOpenVectorStoreDatabase: exec not available");
    },
    selectValue: () => {
      throw new Error("noopOpenVectorStoreDatabase: selectValue not available");
    },
    selectObjects: () => {
      throw new Error("noopOpenVectorStoreDatabase: selectObjects not available");
    },
    transaction: () => {
      throw new Error("noopOpenVectorStoreDatabase: transaction not available");
    },
    close: async () => undefined
  })
}));
