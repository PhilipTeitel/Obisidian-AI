/**
 * Portable domain surface (FND-1 / FND-3). No Obsidian or Node-native DB imports.
 */
export * from './domain/types.js';
export * from './ports/index.js';

export function getCoreLabel(): string {
  return 'obsidian-ai-core';
}
