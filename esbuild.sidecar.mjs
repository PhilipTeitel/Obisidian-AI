import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const outdir = path.join(root, 'dist/sidecar');

fs.mkdirSync(outdir, { recursive: true });

const ctx = await esbuild.context({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'src/sidecar/server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  sourcemap: 'inline',
  outfile: path.join(outdir, 'server.js'),
  packages: 'bundle',
  external: ['better-sqlite3', 'sqlite-vec'],
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
