#!/usr/bin/env node
/**
 * Fail if shipped plugin artifacts reference native Node addons or ship native binaries.
 * See docs/decisions/ADR-001-sqlite-vec-stack.md (product constraint).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const NATIVE_EXT = new Set([".node", ".so", ".dylib", ".dll"]);

/** @param {string} dir */
function walkFiles(dir) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.isDirectory() && ent.name === "node_modules") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

/** @param {string} dir */
function findNativeBinariesUnder(dir) {
  const rel = path.relative(root, dir);
  return walkFiles(dir).filter((f) => NATIVE_EXT.has(path.extname(f).toLowerCase())).map((f) => path.relative(root, f));
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function findSuspiciousBundlePatterns(text) {
  /** @type {string[]} */
  const hits = [];
  const patterns = [
    { re: /\bbetter-sqlite3\b/, label: "better-sqlite3" },
    { re: /["']sqlite-vec["']/, label: "sqlite-vec package id" },
    // Native addon path or specifier (avoid matching `foo.nodeId` / `top.node)`)
    { re: /["'][^"']*\.node["']/, label: ".node in string literal" },
    { re: /require\s*\(\s*["'][^"']*\.node["']\s*\)/, label: "require(.node)" },
    { re: /import\s*\(\s*["'][^"']*\.node["']\s*\)/, label: "import(.node)" }
  ];
  for (const { re, label } of patterns) {
    if (re.test(text)) hits.push(label);
  }
  return hits;
}

let failed = false;

const mainJs = path.join(root, "main.js");
if (fs.existsSync(mainJs)) {
  const body = fs.readFileSync(mainJs, "utf8");
  const suspicious = findSuspiciousBundlePatterns(body);
  if (suspicious.length) {
    failed = true;
    console.error(`check-shipped-native: ${path.relative(root, mainJs)} matches: ${[...new Set(suspicious)].join(", ")}`);
  }
} else {
  console.warn("check-shipped-native: main.js not found (run npm run build first)");
}

const shipDirs = [path.join(root, "obsidian-plugin")];
for (const dir of shipDirs) {
  const bad = findNativeBinariesUnder(dir);
  if (bad.length) {
    failed = true;
    console.error("check-shipped-native: native binaries under release folder:");
    for (const f of bad) console.error(`  ${f}`);
  }
}

if (failed) {
  console.error(
    "\nShipped plugin must not use native addons (*.node / sqlite-vec npm native / better-sqlite3). See ADR-001."
  );
  process.exit(1);
}

console.log("check-shipped-native: ok");
