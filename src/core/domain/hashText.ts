import { sha256 as sha256bytes } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** SHA-256 hex of UTF-8 text (summary embedding idempotency, WKF-2). */
export function hashText(s: string): string {
  return bytesToHex(sha256bytes(new TextEncoder().encode(s)));
}
