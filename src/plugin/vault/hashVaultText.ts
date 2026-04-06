import { createHash } from 'node:crypto';

/** SHA-256 lowercase hex of UTF-8 bytes (IncrementalIndexPlanner / WKF-3). */
export function hashVaultText(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
