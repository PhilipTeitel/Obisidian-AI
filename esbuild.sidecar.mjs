import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const outdir = path.join(root, 'dist/sidecar');

fs.mkdirSync(outdir, { recursive: true });

function copySidecarAssets() {
  const migSrc = path.join(root, 'src/sidecar/db/migrations');
  const migDest = path.join(outdir, 'migrations');
  fs.rmSync(migDest, { recursive: true, force: true });
  fs.cpSync(migSrc, migDest, { recursive: true });
}

const ctx = await esbuild.context({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'src/sidecar/server.ts')],
  bundle: true,
  platform: 'node',
  /** CJS avoids esbuild's ESM `__require` shim, which breaks pino (dynamic `require("node:os")`). */
  format: 'cjs',
  target: 'node18',
  sourcemap: 'inline',
  outfile: path.join(outdir, 'server.cjs'),
  packages: 'bundle',
  external: ['better-sqlite3', 'sqlite-vec'],
  logLevel: 'info',
  plugins: [
    {
      name: 'copy-migrations',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length === 0) {
            copySidecarAssets();
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
