#!/usr/bin/env node
/**
 * Writes a minimal package.json into the deployed sidecar folder and runs npm install
 * so better-sqlite3 and sqlite-vec resolve next to server.cjs (vault installs have no repo root).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} repoRoot
 * @param {string} sidecarDest absolute path to .../plugins/<id>/sidecar
 */
export function installSidecarRuntimeDeps(repoRoot, sidecarDest) {
  if (process.env.OBSIDIAN_AI_SKIP_SIDECAR_NPM === '1') {
    console.warn('install-sidecar-deps: skipped (OBSIDIAN_AI_SKIP_SIDECAR_NPM=1)');
    return;
  }
  const pkgPath = path.join(repoRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = pkg.dependencies ?? {};
  const better = deps['better-sqlite3'];
  const vec = deps['sqlite-vec'];
  if (typeof better !== 'string' || typeof vec !== 'string') {
    console.error('install-sidecar-deps: root package.json missing better-sqlite3 / sqlite-vec in dependencies');
    process.exit(1);
  }
  const sidecarPkg = {
    name: 'obsidian-ai-sidecar-runtime',
    private: true,
    type: 'commonjs',
    dependencies: {
      'better-sqlite3': better,
      'sqlite-vec': vec,
    },
  };
  fs.writeFileSync(path.join(sidecarDest, 'package.json'), JSON.stringify(sidecarPkg, null, 2) + '\n');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: sidecarDest,
    stdio: 'inherit',
    env: process.env,
  });
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  if (r.status !== 0 && r.status !== null) {
    process.exit(r.status);
  }
}
