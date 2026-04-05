#!/usr/bin/env node
/**
 * FND-3 Y2 — core layer must not import Obsidian, Electron, native SQLite/WASM stacks,
 * or adapter layers (plugin / sidecar).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreDir = path.join(root, 'src/core');

function walkTsFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkTsFiles(full, acc);
    else if (name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

function fail(msg) {
  console.error(`verify:core-imports: ${msg}`);
  process.exit(1);
}

const forbiddenModule = [
  /from\s+['"]obsidian['"]/,
  /from\s+['"]electron(\/|['"])/,
  /from\s+['"]better-sqlite3['"]/,
  /better-sqlite3/,
  /from\s+['"]@sqlite\.org\/sqlite-wasm['"]/,
  /@sqlite\.org\/sqlite-wasm/,
];

/** Relative imports that escape core into adapter trees (FND-3 Y1). */
const forbiddenAdapterPath = new RegExp(
  String.raw`from\s+["'](?:\.\./)+(plugin|sidecar)(?:/|["'])`,
);

const files = walkTsFiles(coreDir);
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  for (const re of forbiddenModule) {
    if (re.test(text)) {
      fail(`forbidden import/module in ${rel} (pattern ${re})`);
    }
  }
  if (forbiddenAdapterPath.test(text)) {
    fail(`forbidden adapter import in ${rel}: core must not import plugin/sidecar paths`);
  }
}

console.log('verify:core-imports: OK');
