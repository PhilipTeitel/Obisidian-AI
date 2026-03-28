import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = new Set(process.argv.slice(2));
const isWatch = args.has("--watch");
const isProduction = args.has("--production");

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2020",
  external: ["obsidian", "crypto", "fs", "os", "path", "url"],
  outfile: "main.js",
  sourcemap: isProduction ? false : "inline",
  logLevel: "info"
});

if (isWatch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
  const out = path.join(__dirname, "main.js");
  const { size } = fs.statSync(out);
  console.log(`esbuild: wrote ${out} (${size} bytes)`);
}
