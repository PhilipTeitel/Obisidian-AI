import { describe, expect, it } from 'vitest';
import type { Vault } from 'obsidian';
import { vaultDefaultDbPath } from '@src/plugin/client/SidecarLifecycle.js';

describe('SidecarLifecycle', () => {
  it('vaultDefaultDbPath_normalizes', () => {
    const vault = { getName: () => 'My Vault!' } as Vault;
    const p = vaultDefaultDbPath(vault);
    expect(p).toContain('my_vault_');
    expect(p).toContain('.obsidian-ai');
  });
});
