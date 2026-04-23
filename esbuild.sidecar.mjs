import * as esbuild from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

const SIDECAR_OUTFILE = path.join(outdir, 'server.cjs');
const SIDECAR_MAPFILE = `${SIDECAR_OUTFILE}.map`;

/**
 * esbuild emits `sources` relative to this bundle. At debug time Node loads `server.cjs` from the
 * vault plugin dir (`.../plugins/obsidian-ai/sidecar/`), so relative paths resolve to a non-existent
 * `.../plugins/obsidian-ai/src/...` tree and TS breakpoints stay unbound. Rewriting to absolute
 * paths keeps mapping stable no matter where the file is copied.
 *
 * Use **external** `server.cjs.map` (not inline): multi‑MB inline maps often leave breakpoints grey
 * in Cursor / js-debug; the sibling `.map` loads reliably. Deploy **both** `server.cjs` and
 * `server.cjs.map` into the vault `sidecar/` folder.
 *
 * js-debug often binds editor breakpoints more reliably when `sources` entries are `file://` URLs
 * (not plain absolute filesystem paths).
 */
function rewriteSidecarSourceMapSourcesToAbsolute() {
  if (!fs.existsSync(SIDECAR_MAPFILE)) return;
  const raw = fs.readFileSync(SIDECAR_MAPFILE, 'utf8');
  const map = JSON.parse(raw);
  const outDir = path.dirname(SIDECAR_OUTFILE);
  if (Array.isArray(map.sources)) {
    map.sources = map.sources.map((s) => {
      if (!s) return s;
      if (s.startsWith('file:')) return s;
      const abs = path.isAbsolute(s) ? path.normalize(s) : path.resolve(outDir, s);
      return pathToFileURL(abs).href;
    });
  }
  delete map.sourceRoot;
  fs.writeFileSync(SIDECAR_MAPFILE, JSON.stringify(map));
}

const ctx = await esbuild.context({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'src/sidecar/server.ts')],
  bundle: true,
  platform: 'node',
  /** CJS avoids esbuild's ESM `__require` shim, which breaks pino (dynamic `require("node:os")`). */
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
  outfile: SIDECAR_OUTFILE,
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
    {
      name: 'rewrite-sidecar-sourcemap-sources',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length === 0) {
            rewriteSidecarSourceMapSourcesToAbsolute();
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
