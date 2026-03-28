#!/usr/bin/env node
/**
 * After esbuild: sync release artifacts for Obsidian.
 *
 * 1. Copies SQLite WASM glue from sqlite-vec-wasm-demo (filenames are **sqlite3.mjs** and
 *    **sqlite3.wasm** — the digit 3, i.e. SQLite 3 / Emscripten bundle — not "sqlite.mjs").
 * 2. Patches sqlite3.mjs: renderer Node guard, locateFile (blob load), bigIntEnabled (no Module.HEAPU64 probe).
 * 3. Copies main.js into obsidian-plugin/ so that folder is a complete drop-in release.
 *
 * @see docs/features/VEC-2-lazy-db-lifecycle-open-create-dispose.md and ADR-001.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const requireMain = process.argv.includes("--require-main");
const pluginDir = path.join(root, "obsidian-plugin");
const srcDir = path.join(root, "node_modules", "sqlite-vec-wasm-demo");
const wasmFiles = ["sqlite3.mjs", "sqlite3.wasm"];
const wasmTargets = [root, pluginDir];

const patchRendererGuard = (text) => {
  const needle =
    "var currentNodeVersion = typeof process !== 'undefined' && process.versions?.node ? humanReadableVersionToPacked(process.versions.node) : TARGET_NOT_SUPPORTED;";
  const replacement =
    "var currentNodeVersion = typeof process !== 'undefined' && process.versions?.node && globalThis.process?.type !== 'renderer' ? humanReadableVersionToPacked(process.versions.node) : TARGET_NOT_SUPPORTED;";
  if (!text.includes(needle)) {
    throw new Error(
      "prepare-obsidian-plugin-artifacts: sqlite3.mjs runtime guard string not found; update patch for this package version."
    );
  }
  return text.replace(needle, replacement);
};

/**
 * Upstream pre-js always sets Module['locateFile'] using import.meta.url. That breaks when we
 * load sqlite3.mjs from a blob URL (Obsidian-safe path): wasm would resolve relative to blob:.
 * openVectorStoreDatabase passes locateFile for wasm + siblings; keep it by not overwriting.
 */
const patchLocateFileRespectsModuleArg = (text) => {
  const needle = `Module['locateFile'] = function(path, prefix) {
  return new URL(path, import.meta.url).href;
}.bind(sqlite3InitModuleState);`;
  const replacement = `if (typeof Module['locateFile'] !== 'function') {
Module['locateFile'] = function(path, prefix) {
  return new URL(path, import.meta.url).href;
}.bind(sqlite3InitModuleState);
}`;
  if (!text.includes(needle)) {
    throw new Error(
      "prepare-obsidian-plugin-artifacts: sqlite3.mjs locateFile assignment not found; update patch for this package version."
    );
  }
  return text.replace(needle, replacement);
};

/**
 * sqlite3ApiBootstrap defaults bigIntEnabled via `!!Module.HEAPU64`. In modularized Emscripten
 * builds, HEAP* symbols are often "unexported" with getters that abort on access — the probe
 * itself crashes. Detect BigInt the same way other sqlite3-js code does: global typed arrays.
 */
const patchBigIntEnabledProbe = (text) => {
  const needle = `    bigIntEnabled: (()=>{
      if('undefined'!==typeof Module){
        /* Emscripten module will contain HEAPU64 when built with
           -sWASM_BIGINT=1, else it will not. */
        return !!Module.HEAPU64;
      }
      return !!globalThis.BigInt64Array;
    })(),`;
  const replacement = `    bigIntEnabled: (()=>{
      /* Do not read Module.HEAPU64: Emscripten may expose aborting getters for unexported HEAP*. */
      return !!globalThis.BigInt64Array && !!globalThis.BigUint64Array;
    })(),`;
  if (!text.includes(needle)) {
    throw new Error(
      "prepare-obsidian-plugin-artifacts: sqlite3.mjs bigIntEnabled block not found; update patch for this package version."
    );
  }
  return text.replace(needle, replacement);
};

const patchSqlite3MjsForObsidian = (text) =>
  patchBigIntEnabledProbe(patchLocateFileRespectsModuleArg(patchRendererGuard(text)));

for (const name of wasmFiles) {
  const from = path.join(srcDir, name);
  if (!fs.existsSync(from)) {
    throw new Error(`prepare-obsidian-plugin-artifacts: missing ${from} (run npm install).`);
  }
}

for (const destRoot of wasmTargets) {
  if (!fs.existsSync(destRoot)) {
    fs.mkdirSync(destRoot, { recursive: true });
  }
  for (const name of wasmFiles) {
    const from = path.join(srcDir, name);
    const to = path.join(destRoot, name);
    if (name === "sqlite3.mjs") {
      const body = patchSqlite3MjsForObsidian(fs.readFileSync(from, "utf8"));
      fs.writeFileSync(to, body);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

const mainSrc = path.join(root, "main.js");
const mainDest = path.join(pluginDir, "main.js");
if (fs.existsSync(mainSrc)) {
  fs.copyFileSync(mainSrc, mainDest);
} else if (requireMain) {
  throw new Error(
    "prepare-obsidian-plugin-artifacts: main.js not found at repo root. Esbuild must run before this step."
  );
} else {
  console.warn(
    "prepare-obsidian-plugin-artifacts: main.js not found yet (skipped copy to obsidian-plugin/). Build with esbuild first or use npm run build."
  );
}

console.log(
  "prepare-obsidian-plugin-artifacts: sqlite3.mjs + sqlite3.wasm → repo root + obsidian-plugin/" +
    (fs.existsSync(mainSrc) ? "; main.js → obsidian-plugin/main.js" : "")
);
console.log(
  "  (WASM files are named sqlite3.* — with a 3 — matching the upstream sqlite-vec-wasm-demo package.)"
);
