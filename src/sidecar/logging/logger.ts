import pino from 'pino';
import type { DestinationStream } from 'pino';

export interface CreateSidecarLoggerOptions {
  /** Overrides `OBSIDIAN_AI_LOG_LEVEL` and default `info`. */
  level?: string;
  /** Defaults to stderr (`fd: 2`). */
  destination?: DestinationStream;
}

/**
 * ADR-010: structured JSON logs on stderr; level from env or override.
 */
export function createSidecarLogger(options: CreateSidecarLoggerOptions = {}): pino.Logger {
  const level = options.level ?? process.env.OBSIDIAN_AI_LOG_LEVEL ?? 'info';
  const dest = options.destination ?? pino.destination(2);
  return pino({ level }, dest);
}
