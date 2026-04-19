import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { SidecarRequest } from '../../core/domain/types.js';
import type { SidecarRuntime } from '../runtime/SidecarRuntime.js';
import type { Logger } from 'pino';
import WebSocket, { WebSocketServer } from 'ws';

export interface HttpSidecarOptions {
  port: number;
  /** Bearer token for all REST + WS handshakes. */
  token: string;
  /** Register a WebSocket client sender; return unsubscribe. */
  onWsClient: (send: (json: string) => void) => () => void;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readBearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim();
}

function unauthorized(res: ServerResponse): void {
  sendJson(res, 401, { error: { message: 'missing or invalid Authorization bearer token' } });
}

/**
 * SRV-2: REST + WebSocket on 127.0.0.1 only.
 * @returns Node HTTP server (use `listen` event + `address()` in tests; port `0` = ephemeral).
 */
export function startHttpServer(
  runtime: SidecarRuntime,
  log: Logger,
  options: HttpSidecarOptions,
): Server {
  const { port, token, onWsClient } = options;

  const server = createServer((req, res) => {
    void handleHttp(runtime, log, req, res, token);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ? new URL(req.url, 'http://127.0.0.1') : null;
    if (!url || url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const qToken = url.searchParams.get('token')?.trim();
    const bearer = readBearer(req);
    const ok = (qToken && qToken === token) || (bearer && bearer === token);
    if (!ok) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const send = (json: string) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(json);
      };
      const unsub = onWsClient(send);
      ws.on('close', unsub);
      ws.on('error', unsub);
    });
  });

  server.listen(port, '127.0.0.1', () => {
    log.info({ port: server.address(), host: '127.0.0.1' }, 'sidecar.http.listening');
  });

  return server;
}

async function handleHttp(
  runtime: SidecarRuntime,
  log: Logger,
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
): Promise<void> {
  const bearer = readBearer(req);
  if (!bearer || bearer !== token) {
    unauthorized(res);
    return;
  }

  const url = req.url ? new URL(req.url, 'http://127.0.0.1') : null;
  const path = url?.pathname ?? '';
  const method = req.method ?? 'GET';

  try {
    if (method === 'GET' && path === '/health') {
      const body = runtime.getHealth();
      sendJson(res, 200, body);
      return;
    }

    if (method === 'GET' && path === '/index/status') {
      const r = await runtime.handleSend({ type: 'index/status' });
      sendJson(res, 200, r.body);
      return;
    }

    if (method === 'POST' && path === '/search') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw) as Extract<SidecarRequest, { type: 'search' }>['payload'];
      const r = await runtime.handleSend({ type: 'search', payload });
      sendJson(res, 200, r.body);
      return;
    }

    if (method === 'POST' && path === '/index/full') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw) as Extract<SidecarRequest, { type: 'index/full' }>['payload'];
      const r = await runtime.handleSend({ type: 'index/full', payload });
      sendJson(res, 200, r.body);
      return;
    }

    if (method === 'POST' && path === '/index/incremental') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw) as Extract<
        SidecarRequest,
        { type: 'index/incremental' }
      >['payload'];
      const r = await runtime.handleSend({ type: 'index/incremental', payload });
      sendJson(res, 200, r.body);
      return;
    }

    if (method === 'POST' && path === '/chat/clear') {
      const r = await runtime.handleSend({ type: 'chat/clear' });
      sendJson(res, 200, r.body);
      return;
    }

    if (method === 'POST' && path === '/chat') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw) as Extract<SidecarRequest, { type: 'chat' }>['payload'];
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      });
      const gen = runtime.handleChatStream(payload, {});
      let step = await gen.next();
      while (!step.done) {
        res.write(`${JSON.stringify({ type: 'chat', chunk: step.value })}\n`);
        step = await gen.next();
      }
      res.write(`${JSON.stringify({ type: 'chat', done: true, sources: step.value.sources })}\n`);
      res.end();
      return;
    }

    sendJson(res, 404, { error: { message: 'not found' } });
  } catch (e) {
    log.warn({ err: e, path, method }, 'sidecar.http.handler_error');
    const message = e instanceof Error ? e.message : String(e);
    sendJson(res, 500, { error: { message } });
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function generateSessionToken(): string {
  return randomUUID();
}
