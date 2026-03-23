#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const HELP_TEXT = `
Obsidian AI data query tool

Usage:
  node scripts/query-store.mjs counts --data "<path-to-data.json>"
  node scripts/query-store.mjs node --id "<nodeId>" --data "<path-to-data.json>"
  node scripts/query-store.mjs node --note "<vault-relative-note-path>" [--limit 10] --data "<path-to-data.json>"
  node scripts/query-store.mjs sample [--limit 5] --data "<path-to-data.json>"

Options:
  --data    Path to Obsidian plugin data.json
            (or set OBSIDIAN_AI_DATA_PATH)
  --id      Node ID to inspect
  --note    Note path to filter nodes (e.g. "Notes/Project.md")
  --limit   Max rows for list views (default: 10)
  --help    Show this help

Examples:
  node scripts/query-store.mjs counts --data "/path/to/vault/.obsidian/plugins/obsidian-ai-mvp/data.json"
  node scripts/query-store.mjs node --id "node_123" --data "/path/to/data.json"
  node scripts/query-store.mjs node --note "Inbox/todo.md" --limit 20 --data "/path/to/data.json"
`;

const args = process.argv.slice(2);
const command = args[0];
const flags = parseFlags(args.slice(1));

if (!command || flags.help || command === "--help" || command === "-h" || command === "help") {
  console.log(HELP_TEXT.trim());
  process.exit(0);
}

const dataPath = flags.data ?? process.env.OBSIDIAN_AI_DATA_PATH;
if (!dataPath) {
  fail("Missing --data (or OBSIDIAN_AI_DATA_PATH).");
}

const payload = await loadPayload(dataPath);
const store = payload?.hierarchicalStore;
if (!store || typeof store !== "object") {
  fail(`No "hierarchicalStore" key found in ${dataPath}`);
}

switch (command) {
  case "counts":
    printCounts(store);
    break;
  case "node":
    await printNodeView(store, flags);
    break;
  case "sample":
    printSample(store, flags);
    break;
  default:
    fail(`Unknown command "${command}". Use --help for usage.`);
}

function parseFlags(argv) {
  const out = { help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      out.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = value;
    i += 1;
  }
  return out;
}

async function loadPayload(rawPath) {
  const absolutePath = path.resolve(rawPath);
  try {
    const raw = await fs.readFile(absolutePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    fail(
      `Failed to read/parse JSON: ${absolutePath}\n${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function printCounts(store) {
  const nodes = toEntries(store.nodes);
  const children = toEntries(store.children);
  const summaries = toEntries(store.summaries);
  const tags = toEntries(store.tags);
  const crossRefs = toEntries(store.crossRefs);
  const embeddings = Array.isArray(store.embeddings) ? store.embeddings : [];

  const summaryEmbeddingCount = embeddings.filter((e) => e?.embeddingType === "summary").length;
  const contentEmbeddingCount = embeddings.filter((e) => e?.embeddingType === "content").length;

  const uniqueNotes = new Set();
  const nodeTypes = new Map();
  for (const [, node] of nodes) {
    if (node && typeof node.notePath === "string") uniqueNotes.add(node.notePath);
    if (node && typeof node.nodeType === "string") {
      nodeTypes.set(node.nodeType, (nodeTypes.get(node.nodeType) ?? 0) + 1);
    }
  }

  console.log("\nCounts");
  console.log(`- nodes: ${nodes.length}`);
  console.log(`- unique note paths: ${uniqueNotes.size}`);
  console.log(`- children maps: ${children.length}`);
  console.log(`- summaries: ${summaries.length}`);
  console.log(`- embeddings: ${embeddings.length}`);
  console.log(`  - summary embeddings: ${summaryEmbeddingCount}`);
  console.log(`  - content embeddings: ${contentEmbeddingCount}`);
  console.log(`- tag maps: ${tags.length}`);
  console.log(`- cross-ref maps: ${crossRefs.length}`);

  if (nodeTypes.size > 0) {
    console.log("\nNode types");
    for (const [type, count] of [...nodeTypes.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`- ${type}: ${count}`);
    }
  }
}

async function printNodeView(store, flags) {
  const nodes = toEntries(store.nodes);
  const summaries = new Map(toEntries(store.summaries));
  const children = new Map(toEntries(store.children));
  const tags = new Map(toEntries(store.tags));
  const crossRefs = new Map(toEntries(store.crossRefs));
  const embeddings = Array.isArray(store.embeddings) ? store.embeddings : [];
  const limit = normalizeLimit(flags.limit, 10);

  if (typeof flags.id === "string" && flags.id.trim()) {
    const nodeEntry = nodes.find(([nodeId]) => nodeId === flags.id);
    if (!nodeEntry) {
      fail(`No node found for id: ${flags.id}`);
    }
    const [nodeId, node] = nodeEntry;
    const nodeEmbeddings = embeddings.filter((e) => e?.nodeId === nodeId);
    const output = {
      nodeId,
      node,
      summary: summaries.get(nodeId) ?? null,
      children: children.get(nodeId) ?? [],
      tags: tags.get(nodeId) ?? [],
      crossReferences: crossRefs.get(nodeId) ?? [],
      embeddingStats: nodeEmbeddings.map((e) => ({
        embeddingType: e.embeddingType ?? "unknown",
        dimensions: e?.vector?.dimensions ?? null,
        valuesLength: Array.isArray(e?.vector?.values) ? e.vector.values.length : null
      }))
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (typeof flags.note === "string" && flags.note.trim()) {
    const byNote = nodes.filter(([, node]) => node?.notePath === flags.note);
    if (byNote.length === 0) {
      fail(`No nodes found for notePath: ${flags.note}`);
    }
    console.log(`Found ${byNote.length} node(s) for notePath "${flags.note}"`);
    const preview = byNote.slice(0, limit).map(([nodeId, node]) => ({
      nodeId,
      nodeType: node.nodeType,
      parentId: node.parentId,
      childCount: Array.isArray(node.childIds) ? node.childIds.length : 0,
      textPreview: typeof node.content === "string" ? node.content.slice(0, 160) : null,
      hasSummary: summaries.has(nodeId),
      tagCount: Array.isArray(tags.get(nodeId)) ? tags.get(nodeId).length : 0,
      crossRefCount: Array.isArray(crossRefs.get(nodeId)) ? crossRefs.get(nodeId).length : 0
    }));
    console.log(JSON.stringify(preview, null, 2));
    if (byNote.length > preview.length) {
      console.log(`... ${byNote.length - preview.length} more rows not shown (increase --limit).`);
    }
    return;
  }

  fail('Use either --id "<nodeId>" or --note "<notePath>" with the "node" command.');
}

function printSample(store, flags) {
  const nodes = toEntries(store.nodes);
  const summaries = new Map(toEntries(store.summaries));
  const tags = new Map(toEntries(store.tags));
  const limit = normalizeLimit(flags.limit, 5);

  const preview = nodes.slice(0, limit).map(([nodeId, node]) => ({
    nodeId,
    notePath: node.notePath,
    nodeType: node.nodeType,
    parentId: node.parentId,
    childCount: Array.isArray(node.childIds) ? node.childIds.length : 0,
    hasSummary: summaries.has(nodeId),
    tags: tags.get(nodeId) ?? []
  }));

  console.log(JSON.stringify(preview, null, 2));
}

function toEntries(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeLimit(raw, fallback) {
  const parsed = Number.parseInt(String(raw ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}
