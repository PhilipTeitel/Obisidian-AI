import type { ChatStreamChunk, SidecarRequest, SidecarResponse } from '../domain/types.js';

/**
 * Plugin ↔ sidecar transport (ADR-006). Same message shapes for stdio NDJSON and HTTP; framing in SRV-*.
 *
 * - `send` covers RPC-style messages from the README API Contract table except `chat`, which is streamed.
 * - `streamChat` yields provider-neutral chunks (`delta` text, then terminal `done` with sources).
 */
export interface ISidecarTransport {
  send(request: Exclude<SidecarRequest, { type: 'chat' }>): Promise<SidecarResponse>;

  streamChat(
    request: Extract<SidecarRequest, { type: 'chat' }>['payload'],
  ): AsyncIterable<ChatStreamChunk>;
}
