/** RET-4 plugin setting: Phase-1 summary ANN candidate cap (ADR-012). */
export const CHAT_COARSE_K_MIN = 1;
export const CHAT_COARSE_K_MAX = 256;
export const DEFAULT_CHAT_COARSE_K = 32;

export function clampChatCoarseK(n: number): number {
  return Math.min(CHAT_COARSE_K_MAX, Math.max(CHAT_COARSE_K_MIN, Math.floor(n)));
}

export function normalizeChatCoarseKFromUserInput(raw: string): {
  value: number;
  warning: string | null;
} {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { value: DEFAULT_CHAT_COARSE_K, warning: null };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return {
      value: DEFAULT_CHAT_COARSE_K,
      warning: 'Invalid value; using default 32.',
    };
  }
  const intPart = Math.trunc(n);
  const clamped = clampChatCoarseK(intPart);
  const hadFraction = !Number.isInteger(n);
  if (hadFraction || clamped !== intPart) {
    return { value: clamped, warning: `Value clamped to ${clamped}.` };
  }
  return { value: clamped, warning: null };
}
