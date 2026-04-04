#!/usr/bin/env node
/**
 * FND-1: B2 / Y3 — core must not reference Obsidian or native DB stack; plugin must not import sqlite stack.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  console.error(`check-source-boundaries: ${msg}`);
  process.exit(1);
}

const coreDir = path.join(root, 'src/core');
const coreFiles = walkTsFiles(coreDir);
const corePatterns = [/from\s+['"]obsidian['"]/, /better-sqlite3/];
for (const file of coreFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const re of corePatterns) {
    if (re.test(text)) {
      fail(`forbidden pattern in ${path.relative(root, file)}: ${re}`);
    }
  }
}

const pluginDir = path.join(root, 'src/plugin');
const pluginFiles = walkTsFiles(pluginDir);
const pluginPatterns = [/better-sqlite3/, /sqlite-vec/];
for (const file of pluginFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const re of pluginPatterns) {
    if (re.test(text)) {
      fail(`forbidden pattern in ${path.relative(root, file)}: ${re}`);
    }
  }
}

console.log('check-source-boundaries: OK');
