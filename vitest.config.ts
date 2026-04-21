import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@src': path.join(root, 'src'),
      obsidian: path.join(root, 'tests/shims/obsidian.ts'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'tests/**/*.test.ts',
      'tests/contract/document-store.contract.ts',
      'tests/contract/IChatPort.contract.ts',
    ],
  },
});
