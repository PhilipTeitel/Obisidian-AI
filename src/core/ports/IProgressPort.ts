import type { ProgressEvent } from '../domain/types.js';

/**
 * Structured progress for UI (e.g. ProgressSlideout). Correlates with ADR-008 / `IndexProgressEvent`.
 */
export interface IProgressPort {
  emit(event: ProgressEvent): void;
}
