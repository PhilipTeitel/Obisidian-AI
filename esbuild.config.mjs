import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const outDir = path.join(root, 'dist', 'plugin');

fs.mkdirSync(outDir, { recursive: true });

function copyPluginAssets() {
  fs.copyFileSync(path.join(root, 'manifest.json'), path.join(outDir, 'manifest.json'));
  fs.copyFileSync(path.join(root, 'styles.css'), path.join(outDir, 'styles.css'));
}

const ctx = await esbuild.context({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'src/plugin/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: 'inline',
  outfile: path.join(outDir, 'main.js'),
  external: ['obsidian'],
  logLevel: 'info',
  plugins: [
    {
      name: 'copy-plugin-assets',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length === 0) {
            copyPluginAssets();
          }
        });
      },
    },
  ],
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
