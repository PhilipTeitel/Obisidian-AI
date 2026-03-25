import esbuild from "esbuild";

const args = new Set(process.argv.slice(2));
const isWatch = args.has("--watch");
const isProduction = args.has("--production");

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2020",
  external: ["obsidian", "crypto", "os", "path"],
  outfile: "main.js",
  sourcemap: isProduction ? false : "inline",
  logLevel: "info"
});

if (isWatch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
