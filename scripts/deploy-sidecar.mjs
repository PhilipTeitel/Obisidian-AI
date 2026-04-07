#!/usr/bin/env node
/**
 * Build sidecar (unless --no-build) and copy dist/sidecar into the vault plugin's sidecar/ folder.
 *
 * Usage:
 *   node scripts/deploy-sidecar.mjs <vault-path>
 *   node scripts/deploy-sidecar.mjs --no-build <vault-path>
 *   OBSIDIAN_VAULT=<path> node scripts/deploy-sidecar.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installSidecarRuntimeDeps } from './install-sidecar-deps.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'manifest.json');

function parseArgs(argv) {
  let noBuild = false;
  const positional = [];
  for (const a of argv) {
    if (a === '--no-build') noBuild = true;
    else if (a.startsWith('-')) {
      console.error(`deploy-sidecar: unknown option ${a}`);
      process.exit(1);
    } else positional.push(a);
  }
  const vaultRaw =
    positional[0] ?? process.env.OBSIDIAN_VAULT ?? process.env.VAULT_PATH ?? null;
  if (!vaultRaw) {
    console.error(`deploy-sidecar: missing vault path.

  node scripts/deploy-sidecar.mjs [--no-build] <vault-path>
  OBSIDIAN_VAULT=<path> node scripts/deploy-sidecar.mjs [--no-build]`);
    process.exit(1);
  }
  return { noBuild, vaultPath: path.resolve(vaultRaw) };
}

function runBuildSidecar() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['run', 'build:sidecar'], { cwd: root, stdio: 'inherit' });
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  if (r.status !== 0 && r.status !== null) {
    process.exit(r.status);
  }
}

const { noBuild, vaultPath } = parseArgs(process.argv.slice(2));

try {
  if (!fs.statSync(vaultPath).isDirectory()) {
    console.error(`deploy-sidecar: not a directory: ${vaultPath}`);
    process.exit(1);
  }
} catch {
  console.error(`deploy-sidecar: vault path does not exist: ${vaultPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const pluginId = manifest.id;
if (typeof pluginId !== 'string' || !pluginId.trim()) {
  console.error('deploy-sidecar: manifest.json missing string "id"');
  process.exit(1);
}

if (!noBuild) {
  runBuildSidecar();
}

const sidecarSrc = path.join(root, 'dist', 'sidecar');
if (!fs.statSync(sidecarSrc).isDirectory()) {
  console.error(`deploy-sidecar: missing sidecar directory: ${sidecarSrc}`);
  process.exit(1);
}

const destDir = path.join(vaultPath, '.obsidian', 'plugins', pluginId);
const sidecarDest = path.join(destDir, 'sidecar');
fs.mkdirSync(destDir, { recursive: true });
fs.rmSync(sidecarDest, { recursive: true, force: true });
fs.cpSync(sidecarSrc, sidecarDest, { recursive: true });

installSidecarRuntimeDeps(root, sidecarDest);

console.log(`deploy-sidecar: installed sidecar to ${sidecarDest}`);
