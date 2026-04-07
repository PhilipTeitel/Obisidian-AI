#!/usr/bin/env node
/**
 * FND-1 binding check: plugin output must not contain sidecar-native stack markers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'manifest.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const mainFile = manifest.main;
if (typeof mainFile !== 'string' || !mainFile.trim()) {
  console.error('verify-plugin-bundle: manifest.json missing string "main"');
  process.exit(1);
}

const bundlePath = path.join(root, 'dist', 'plugin', mainFile);
if (!fs.existsSync(bundlePath)) {
  console.error(`verify-plugin-bundle: missing plugin bundle at ${bundlePath}`);
  process.exit(1);
}

const text = fs.readFileSync(bundlePath, 'utf8');
const forbiddenSubstrings = ['better-sqlite3', 'sqlite-vec', 'sqlite_vec'];
for (const s of forbiddenSubstrings) {
  if (text.includes(s)) {
    console.error(`verify-plugin-bundle: forbidden substring "${s}" found in ${mainFile}`);
    process.exit(1);
  }
}

const nativeRequirePattern = /require\s*\(\s*["'][^"']*\.node["']\s*\)/g;
if (nativeRequirePattern.test(text)) {
  console.error(`verify-plugin-bundle: native .node require pattern found in ${mainFile}`);
  process.exit(1);
}

console.log(`verify-plugin-bundle: OK (${mainFile})`);
