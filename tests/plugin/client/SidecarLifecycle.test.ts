import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Vault } from 'obsidian';
import {
  resolveSidecarNodeExecutable,
  tryResolveNvmNode,
  vaultDefaultDbPath,
} from '@src/plugin/client/SidecarLifecycle.js';

const NODE_BIN = process.platform === 'win32' ? 'node.exe' : 'node';

function writeFakeNodeBin(binDir: string): string {
  fs.mkdirSync(binDir, { recursive: true });
  const bin = path.join(binDir, NODE_BIN);
  if (process.platform === 'win32') {
    fs.writeFileSync(bin, '');
  } else {
    fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(bin, 0o755);
  }
  return bin;
}

describe('SidecarLifecycle', () => {
  afterEach(() => {
    delete process.env.OBSIDIAN_AI_NODE;
  });

  it('vaultDefaultDbPath_normalizes', () => {
    const vault = { getName: () => 'My Vault!' } as Vault;
    const p = vaultDefaultDbPath(vault);
    expect(p).toContain('my_vault_');
    expect(p).toContain('.obsidian-ai');
  });

  it('resolveSidecarNodeExecutable_uses_env_when_set', () => {
    process.env.OBSIDIAN_AI_NODE = process.execPath;
    expect(resolveSidecarNodeExecutable({ nodeExecutablePath: '' })).toBe(path.resolve(process.execPath));
  });

  it('resolveSidecarNodeExecutable_finds_node_without_electron', () => {
    const resolved = resolveSidecarNodeExecutable({ nodeExecutablePath: '' });
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.toLowerCase()).toMatch(/node/);
  });

  it('resolveSidecarNodeExecutable_prefers_setting_over_env', () => {
    process.env.OBSIDIAN_AI_NODE = '/nonexistent/from/env';
    expect(resolveSidecarNodeExecutable({ nodeExecutablePath: process.execPath })).toBe(
      path.resolve(process.execPath),
    );
  });

  it('resolveSidecarNodeExecutable_throws_when_setting_path_missing', () => {
    expect(() =>
      resolveSidecarNodeExecutable({ nodeExecutablePath: '/no/such/node/binary-xyz' }),
    ).toThrow(/Node executable path not found/);
  });
});

describe('tryResolveNvmNode', () => {
  it('resolves_default_alias_to_installed_version', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-ai-nvm-'));
    fs.mkdirSync(path.join(tmp, 'alias'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'alias', 'default'), 'v99.88.77\n');
    const bin = writeFakeNodeBin(path.join(tmp, 'versions', 'node', 'v99.88.77', 'bin'));
    expect(tryResolveNvmNode(tmp)).toBe(path.resolve(bin));
  });

  it('resolves_lts_alias_chain', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-ai-nvm-'));
    fs.mkdirSync(path.join(tmp, 'alias', 'lts'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'alias', 'default'), 'lts/testcodename\n');
    fs.writeFileSync(path.join(tmp, 'alias', 'lts', 'testcodename'), 'v12.34.56\n');
    const bin = writeFakeNodeBin(path.join(tmp, 'versions', 'node', 'v12.34.56', 'bin'));
    expect(tryResolveNvmNode(tmp)).toBe(path.resolve(bin));
  });

  it('falls_back_to_highest_installed_when_default_missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-ai-nvm-'));
    writeFakeNodeBin(path.join(tmp, 'versions', 'node', 'v1.0.0', 'bin'));
    const binHigh = writeFakeNodeBin(path.join(tmp, 'versions', 'node', 'v2.0.0', 'bin'));
    expect(tryResolveNvmNode(tmp)).toBe(path.resolve(binHigh));
  });

  it('returns_undefined_when_no_install', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-ai-nvm-empty-'));
    fs.mkdirSync(path.join(tmp, 'alias'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'alias', 'default'), 'system\n');
    expect(tryResolveNvmNode(tmp)).toBeUndefined();
  });
});
