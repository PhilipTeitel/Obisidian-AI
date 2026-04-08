#!/usr/bin/env node
/**
 * Writes a minimal package.json into the deployed sidecar folder and runs npm install
 * so better-sqlite3 and sqlite-vec resolve next to server.cjs (vault installs have no repo root).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
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
  const betterPkgPath = path.join(repoRoot, 'node_modules', 'better-sqlite3', 'package.json');
  const betterPkg = JSON.parse(fs.readFileSync(betterPkgPath, 'utf8'));
  const bindings = betterPkg.dependencies?.bindings;
  if (typeof better !== 'string' || typeof vec !== 'string' || typeof bindings !== 'string') {
    console.error(
      'install-sidecar-deps: missing better-sqlite3 / sqlite-vec / bindings dependency metadata',
    );
    process.exit(1);
  }
  const sidecarPkg = {
    name: 'obsidian-ai-sidecar-runtime',
    private: true,
    type: 'commonjs',
    dependencies: {
      'better-sqlite3': better,
      bindings,
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

  // Fail during deploy instead of at sidecar startup if native runtime deps are incomplete.
  const sidecarRequire = createRequire(path.join(sidecarDest, 'package.json'));
  for (const mod of ['better-sqlite3', 'bindings', 'sqlite-vec']) {
    try {
      sidecarRequire.resolve(mod);
    } catch (error) {
      console.error(`install-sidecar-deps: failed to resolve ${mod} in ${sidecarDest}`);
      console.error(error);
      process.exit(1);
    }
  }
}
