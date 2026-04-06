import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'src/plugin/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: 'inline',
  outfile: path.join(root, 'main.js'),
  external: ['obsidian'],
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
