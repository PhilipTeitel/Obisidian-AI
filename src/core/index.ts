/**
 * Portable domain surface (FND-1 / FND-3). No Obsidian or Node-native DB imports.
 */
export * from './domain/types.js';
export * from './domain/chunker.js';
export * from './domain/tokenEstimator.js';
export * from './domain/contextAssembly.js';
export * from './ports/index.js';
export * from './workflows/SearchWorkflow.js';
export * from './workflows/ChatWorkflow.js';

export function getCoreLabel(): string {
  return 'obsidian-ai-core';
}
