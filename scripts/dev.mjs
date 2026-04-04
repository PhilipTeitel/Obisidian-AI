#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

function run(cmd, args) {
  const child = spawn(cmd, args, {
    cwd: path.join(root, '..'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    if (code !== 0 && code !== null) {
      process.exit(code);
    }
  });
  return child;
}

const plugin = run('node', ['esbuild.config.mjs', '--watch']);
const sidecar = run('node', ['esbuild.sidecar.mjs', '--watch']);

function shutdown() {
  plugin.kill('SIGINT');
  sidecar.kill('SIGINT');
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});
