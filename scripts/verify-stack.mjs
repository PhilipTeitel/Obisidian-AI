#!/usr/bin/env node
/**
 * STO-4 static checks: FTS tokenizer literal, no loose `any` on changed surface,
 * no relative imports to shared/types from that surface.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const surfaces = [
  'src/sidecar/db/migrate.ts',
  'src/sidecar/db/migrations/002_fts.sql',
  'src/sidecar/adapters/SqliteDocumentStore.ts',
  'tests/sidecar/db/migrations.002.test.ts',
  'tests/sidecar/db/migrations.002.rebuild.test.ts',
  'tests/contract/document-store.contract.ts',
  'tests/integration/sqlite-document-store.migration-002.test.ts',
  'scripts/verify-stack.mjs',
];

const tokenizerNeedle = `tokenize='unicode61 remove_diacritics 1'`;

function fail(msg) {
  console.error(msg);
  process.exitCode = 1;
}

const ftsPath = path.join(root, 'src/sidecar/db/migrations/002_fts.sql');
if (!fs.readFileSync(ftsPath, 'utf8').includes(tokenizerNeedle)) {
  fail(`verify-stack: missing tokenizer literal in ${ftsPath}`);
}

const anyRe = /(?::\s*any\b|\bas any\b)/;
for (const rel of surfaces) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    fail(`verify-stack: missing file ${rel}`);
    continue;
  }
  if (rel.endsWith('.sql') || rel.endsWith('.mjs')) continue;
  const text = fs.readFileSync(abs, 'utf8');
  if (anyRe.test(text)) {
    fail(`verify-stack: disallowed any-type pattern in ${rel}`);
  }
  if (rel.endsWith('.ts')) {
    const badRelImport =
      /\bfrom\s+['"]\.\.\/\.\.\/shared\/types['"]/.test(text) ||
      /\bfrom\s+['"]\.\.\/shared\/types['"]/.test(text);
    if (badRelImport) {
      fail(`verify-stack: use @shared/types instead of relative shared import in ${rel}`);
    }
  }
}

if (process.exitCode === 1) {
  process.exit(1);
}
console.log('verify-stack: OK');
