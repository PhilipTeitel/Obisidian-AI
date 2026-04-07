#!/usr/bin/env node
/**
 * Build (unless --no-build) and copy plugin + sidecar into a vault's .obsidian/plugins/<id>/ folder.
 *
 * Usage:
 *   node scripts/deploy-plugin.mjs <vault-path>
 *   node scripts/deploy-plugin.mjs --no-build <vault-path>
 *   OBSIDIAN_VAULT=<path> node scripts/deploy-plugin.mjs
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
      console.error(`deploy-plugin: unknown option ${a}`);
      process.exit(1);
    } else positional.push(a);
  }
  const vaultRaw =
    positional[0] ?? process.env.OBSIDIAN_VAULT ?? process.env.VAULT_PATH ?? null;
  if (!vaultRaw) {
    console.error(`deploy-plugin: missing vault path.

  node scripts/deploy-plugin.mjs [--no-build] <vault-path>
  OBSIDIAN_VAULT=<path> node scripts/deploy-plugin.mjs [--no-build]`);
    process.exit(1);
  }
  return { noBuild, vaultPath: path.resolve(vaultRaw) };
}

function runBuild() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit' });
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
    console.error(`deploy-plugin: not a directory: ${vaultPath}`);
    process.exit(1);
  }
} catch {
  console.error(`deploy-plugin: vault path does not exist: ${vaultPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const pluginId = manifest.id;
if (typeof pluginId !== 'string' || !pluginId.trim()) {
  console.error('deploy-plugin: manifest.json missing string "id"');
  process.exit(1);
}
const mainFile = manifest.main;
if (typeof mainFile !== 'string' || !mainFile.trim()) {
  console.error('deploy-plugin: manifest.json missing string "main"');
  process.exit(1);
}

if (!noBuild) {
  runBuild();
}

const pluginSrcDir = path.join(root, 'dist', 'plugin');
const mainPath = path.join(pluginSrcDir, mainFile);
const stylesPath = path.join(pluginSrcDir, 'styles.css');
const manifestBuiltPath = path.join(pluginSrcDir, 'manifest.json');
const sidecarSrc = path.join(root, 'dist', 'sidecar');
const sidecarEntry = path.join(sidecarSrc, 'server.cjs');

for (const [label, p] of [
  ['plugin bundle', mainPath],
  ['manifest', manifestBuiltPath],
  ['styles', stylesPath],
  ['sidecar entry', sidecarEntry],
]) {
  if (!fs.existsSync(p)) {
    console.error(`deploy-plugin: missing ${label}: ${p}`);
    process.exit(1);
  }
}
if (!fs.statSync(sidecarSrc).isDirectory()) {
  console.error(`deploy-plugin: missing sidecar directory: ${sidecarSrc}`);
  process.exit(1);
}

const destDir = path.join(vaultPath, '.obsidian', 'plugins', pluginId);
fs.mkdirSync(destDir, { recursive: true });

fs.copyFileSync(mainPath, path.join(destDir, mainFile));
fs.copyFileSync(manifestBuiltPath, path.join(destDir, 'manifest.json'));
fs.copyFileSync(stylesPath, path.join(destDir, 'styles.css'));

const sidecarDest = path.join(destDir, 'sidecar');
fs.rmSync(sidecarDest, { recursive: true, force: true });
fs.cpSync(sidecarSrc, sidecarDest, { recursive: true });

installSidecarRuntimeDeps(root, sidecarDest);

console.log(`deploy-plugin: installed to ${destDir}`);
