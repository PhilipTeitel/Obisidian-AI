import type { ProgressEvent } from '../../core/domain/types.js';
import type { IProgressPort } from '../../core/ports/IProgressPort.js';
import type { Logger } from 'pino';

export interface ProgressAdapterOptions {
  log?: Logger;
  /** NDJSON line for stdio (`channel` + `progress` wrapper). */
  onStdioLine?: (line: string) => void;
  /** Raw JSON string for WebSocket clients (`{ type, event }`). */
  onWsJson?: (json: string) => void;
}

/**
 * SRV-5: forwards {@link IProgressPort.emit} to stdio and/or WebSocket sinks.
 */
export class ProgressAdapter implements IProgressPort {
  constructor(private readonly options: ProgressAdapterOptions = {}) {}

  emit(event: ProgressEvent): void {
    const { log, onStdioLine, onWsJson } = this.options;
    if (onStdioLine) {
      try {
        onStdioLine(JSON.stringify({ channel: 'push', type: 'progress', event }));
      } catch (e) {
        log?.warn({ err: e }, 'ProgressAdapter stdio sink failed');
      }
    }
    if (onWsJson) {
      try {
        onWsJson(JSON.stringify({ type: 'progress', event }));
      } catch (e) {
        log?.warn({ err: e }, 'ProgressAdapter ws sink failed');
      }
    }
  }
}
