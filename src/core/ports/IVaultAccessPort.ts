import type { VaultFile } from '../domain/types.js';

/**
 * Vault filesystem access — implemented in the plugin via Obsidian API (ADR-006).
 * The sidecar receives file contents in payloads; it does not use this port.
 */
export interface IVaultAccessPort {
  listFiles(folders: string[]): Promise<VaultFile[]>;
  readFile(path: string): Promise<string>;
}
