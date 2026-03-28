import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { normalizeRuntimeError } from "../../errors/normalizeRuntimeError";
import { createRuntimeLogger } from "../../logging/runtimeLogger";
import type { VectorStoreMigrationDb } from "./runVectorStoreMigrations";
import { runVectorStoreMigrations } from "./runVectorStoreMigrations";

type Sqlite3Oo1Db = {
  close: () => void;
  exec: (sql: string | { sql: string; bind?: unknown }) => void;
  selectValue: (sql: string, bind?: unknown, asType?: unknown) => unknown;
  selectObjects: (sql: string, bind?: unknown) => Record<string, unknown>[];
  transaction: <T>(callback: (db: Sqlite3Oo1Db) => T) => T;
};

type Sqlite3Module = {
  oo1: {
    DB: new (filename: string, flags?: string) => Sqlite3Oo1Db;
  };
  capi: {
    sqlite3_js_db_export: (db: unknown) => Uint8Array;
  };
};

type Sqlite3InitModule = (moduleArg?: Record<string, unknown>) => Promise<Sqlite3Module>;

/**
 * Obsidian’s Electron renderer blocks dynamic `import(file://…/sqlite3.mjs)` (“Failed to fetch…”).
 * We read the files with Node `fs` and load the glue via a blob URL; wasm is fetched from a
 * second blob URL so `fetch()` never hits `file://`.
 */
const loadSqlite3Module = async (
  assetDir: string
): Promise<{ sqlite3: Sqlite3Module; revokeBlobUrls: () => void }> => {
  const mjsPath = path.join(assetDir, "sqlite3.mjs");
  const wasmPath = path.join(assetDir, "sqlite3.wasm");

  const [mjsSource, wasmBuf] = await Promise.all([
    fs.promises.readFile(mjsPath, "utf8"),
    fs.promises.readFile(wasmPath)
  ]);

  const wasmBlobUrl = URL.createObjectURL(new Blob([wasmBuf], { type: "application/wasm" }));
  const jsBlobUrl = URL.createObjectURL(new Blob([mjsSource], { type: "text/javascript" }));

  const revokeBlobUrls = (): void => {
    URL.revokeObjectURL(jsBlobUrl);
    URL.revokeObjectURL(wasmBlobUrl);
  };

  try {
    const imported = (await import(jsBlobUrl)) as { default: Sqlite3InitModule };
    const sqlite3InitModule = imported.default;
    const sqlite3 = await sqlite3InitModule({
      // sqlite3.mjs places Emscripten post-js *after* `run()`. When `Module.setStatus` is absent,
      // `doRun()` runs synchronously and seals `Module.postRun` before that post-js runs, which
      // then aborts with "Attempt to set `Module.postRun` after it has already been processed".
      // A truthy `setStatus` defers `doRun` to the next task so post-js can queue handlers first.
      setStatus: () => {},
      locateFile: (file: string) =>
        file === "sqlite3.wasm"
          ? wasmBlobUrl
          : pathToFileURL(path.join(assetDir, file)).href
    });
    return { sqlite3, revokeBlobUrls };
  } catch (error: unknown) {
    revokeBlobUrls();
    throw error;
  }
};

const moduleLogger = createRuntimeLogger("openVectorStoreDatabase");

/**
 * Live vector-store session (exec / reads / transactions) plus async close.
 * Matches sqlite3.oo1.DB surface used by migrations with {@link selectObjects} for row reads.
 */
export type SqliteDatabaseHandle = VectorStoreMigrationDb & {
  selectObjects: (sql: string, bind?: unknown) => Record<string, unknown>[];
  close(): Promise<void>;
};

export interface OpenVectorStoreDatabaseOptions {
  absoluteDbPath: string;
  sqliteWasmAssetDir: string;
}

const WASM_USER_MESSAGE =
  "The vector store could not load its embedded SQLite engine. Reinstall the plugin from a fresh build, ensure sqlite3.wasm sits next to main.js in the plugin folder, and restart Obsidian.";

const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === "string" ? error : "Unknown WASM SQLite error");
};

/**
 * Opens (or prepares) the per-vault vector database: ensures the parent directory exists,
 * loads sqlite-vec via the bundled sqlite-vec-wasm-demo SQLite WASM build, and returns a handle.
 *
 * The connection is in-memory with sqlite-vec loaded; {@link runVectorStoreMigrations} runs
 * on open. Non-empty databases are serialized to `absoluteDbPath` on close.
 */
export const openVectorStoreDatabaseLazy = async (
  options: OpenVectorStoreDatabaseOptions
): Promise<SqliteDatabaseHandle> => {
  const { absoluteDbPath, sqliteWasmAssetDir } = options;

  moduleLogger.info({
    event: "storage.sqlite.open.started",
    message: "Opening vector store SQLite (WASM).",
    context: { absoluteDbPath }
  });

  try {
    await fs.promises.mkdir(path.dirname(absoluteDbPath), { recursive: true });
  } catch (error: unknown) {
    const normalized = normalizeRuntimeError(error, {
      operation: "openVectorStoreDatabaseLazy",
      phase: "mkdir",
      domainHint: "storage",
      absoluteDbPath
    });
    moduleLogger.log({
      level: "error",
      event: "storage.sqlite.open.failed",
      message: "Failed to create vector store parent directory.",
      domain: normalized.domain,
      context: { absoluteDbPath },
      error: normalized
    });
    throw normalized;
  }

  let sqlite3: Sqlite3Module;
  let revokeBlobUrls: (() => void) | undefined;
  try {
    const assetDir = path.resolve(sqliteWasmAssetDir);
    const loaded = await loadSqlite3Module(assetDir);
    sqlite3 = loaded.sqlite3;
    revokeBlobUrls = loaded.revokeBlobUrls;
  } catch (error: unknown) {
    const wrapped = toError(error);
    const normalized = normalizeRuntimeError(wrapped, {
      operation: "openVectorStoreDatabaseLazy",
      phase: "sqlite_vec_wasm_load",
      domainHint: "storage"
    });
    const withMessage =
      normalized.domain === "storage"
        ? { ...normalized, userMessage: WASM_USER_MESSAGE }
        : { ...normalized, userMessage: `${WASM_USER_MESSAGE} (${normalized.userMessage})` };
    moduleLogger.log({
      level: "error",
      event: "storage.sqlite.open.failed",
      message: "Failed to load SQLite WASM (sqlite-vec bundle).",
      domain: withMessage.domain,
      context: { absoluteDbPath, sqliteWasmAssetDir },
      error: withMessage
    });
    throw withMessage;
  }

  const db = new sqlite3.oo1.DB(":memory:", "cw");
  db.exec("PRAGMA foreign_keys = ON");

  try {
    const vecVersion = db.selectValue("select vec_version();");
    if (vecVersion === undefined || vecVersion === null) {
      throw new Error("sqlite-vec is not available (vec_version() returned no value).");
    }
  } catch (error: unknown) {
    db.close();
    revokeBlobUrls?.();
    const normalized = normalizeRuntimeError(toError(error), {
      operation: "openVectorStoreDatabaseLazy",
      phase: "sqlite_vec_version_check",
      domainHint: "storage"
    });
    const withMessage = { ...normalized, userMessage: WASM_USER_MESSAGE };
    moduleLogger.log({
      level: "error",
      event: "storage.sqlite.open.failed",
      message: "sqlite-vec failed vec_version() check.",
      domain: withMessage.domain,
      context: { absoluteDbPath },
      error: withMessage
    });
    throw withMessage;
  }

  try {
    await runVectorStoreMigrations(db);
  } catch (error: unknown) {
    db.close();
    revokeBlobUrls?.();
    const normalized = normalizeRuntimeError(toError(error), {
      operation: "openVectorStoreDatabaseLazy",
      phase: "vector_store_migrations",
      domainHint: "storage"
    });
    const withMessage = { ...normalized, userMessage: WASM_USER_MESSAGE };
    moduleLogger.log({
      level: "error",
      event: "storage.sqlite.open.failed",
      message: "Vector store migrations failed.",
      domain: withMessage.domain,
      context: { absoluteDbPath },
      error: withMessage
    });
    throw withMessage;
  }

  moduleLogger.info({
    event: "storage.sqlite.open.completed",
    message: "Vector store SQLite (WASM) ready.",
    context: { absoluteDbPath }
  });

  const session: VectorStoreMigrationDb & {
    selectObjects: (sql: string, bind?: unknown) => Record<string, unknown>[];
  } = {
    exec: db.exec.bind(db) as VectorStoreMigrationDb["exec"],
    selectValue: db.selectValue.bind(db) as VectorStoreMigrationDb["selectValue"],
    transaction: db.transaction.bind(db) as VectorStoreMigrationDb["transaction"],
    selectObjects: (sql: string, bind?: unknown) => db.selectObjects(sql, bind)
  };

  return {
    ...session,
    close: async () => {
      moduleLogger.info({
        event: "storage.sqlite.dispose",
        message: "Closing vector store SQLite (WASM).",
        context: { absoluteDbPath }
      });
      try {
        const bytes = sqlite3.capi.sqlite3_js_db_export(db);
        if (bytes.byteLength > 0) {
          await fs.promises.writeFile(absoluteDbPath, Buffer.from(bytes));
        }
      } catch (error: unknown) {
        const normalized = normalizeRuntimeError(error, {
          operation: "openVectorStoreDatabaseLazy",
          phase: "persist_on_close",
          domainHint: "storage",
          absoluteDbPath
        });
        moduleLogger.log({
          level: "error",
          event: "storage.sqlite.dispose.persist_failed",
          message: "Failed to persist vector store database on close.",
          domain: normalized.domain,
          context: { absoluteDbPath },
          error: normalized
        });
        throw normalized;
      } finally {
        db.close();
        revokeBlobUrls?.();
      }
    }
  };
};

const noopAccess = (): never => {
  throw normalizeRuntimeError(
    new Error("Vector store database is not configured (missing vault path or WASM assets)."),
    {
      operation: "noopOpenVectorStoreDatabase",
      phase: "access_before_open",
      domainHint: "storage"
    }
  );
};

/** Test / minimal environments without vault paths — skips WASM and filesystem. */
export const noopOpenVectorStoreDatabase = async (): Promise<SqliteDatabaseHandle> => ({
  exec: noopAccess,
  selectValue: noopAccess,
  selectObjects: noopAccess,
  transaction: noopAccess,
  close: async () => undefined
});
