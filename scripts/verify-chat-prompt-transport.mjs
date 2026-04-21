#!/usr/bin/env node
/**
 * CHAT-4 Y2 — sidecar must not reference the plugin-only setting key `chatSystemPrompt` (wire: `systemPrompt`).
 * `vaultOrganizationPrompt` is shared between settings and payload names, so it is not grep-forbidden here.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sidecar = path.join(root, 'src', 'sidecar');

try {
  execSync(`grep -rF "chatSystemPrompt" "${sidecar}" --include='*.ts' --include='*.mts' --include='*.cts'`, {
    stdio: 'pipe',
    encoding: 'utf8',
  });
  console.error(
    'verify-chat-prompt-transport: FAIL — forbidden plugin setting key chatSystemPrompt under src/sidecar',
  );
  process.exit(1);
} catch (e) {
  if (e && typeof e === 'object' && 'status' in e && e.status === 1) {
    console.log('verify-chat-prompt-transport: OK');
    process.exit(0);
  }
  throw e;
}
