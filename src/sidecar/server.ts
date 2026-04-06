import { createSidecarLogger } from './logging/logger.js';
import { ProgressAdapter } from './adapters/ProgressAdapter.js';
import { SidecarRuntime } from './runtime/SidecarRuntime.js';
import { generateSessionToken, startHttpServer } from './http/httpServer.js';
import { startStdioServer } from './stdio/stdioServer.js';

function main(): void {
  const log = createSidecarLogger();
  const httpPortRaw = process.env.OBSIDIAN_AI_HTTP_PORT?.trim();
  const wsClients = new Set<(json: string) => void>();

  const progress = new ProgressAdapter({
    log,
    onStdioLine: httpPortRaw ? undefined : (line) => process.stdout.write(`${line}\n`),
    onWsJson: httpPortRaw
      ? (json) => {
          for (const c of wsClients) {
            try {
              c(json);
            } catch {
              /* ignore client errors */
            }
          }
        }
      : undefined,
  });

  const runtime = new SidecarRuntime({ log, progress });

  if (httpPortRaw !== undefined && httpPortRaw !== '') {
    const port = parseInt(httpPortRaw, 10);
    if (!Number.isFinite(port) || port < 0 || port > 65535) {
      log.error({ httpPortRaw }, 'invalid OBSIDIAN_AI_HTTP_PORT');
      process.exit(1);
    }
    const token = generateSessionToken();
    startHttpServer(runtime, log, {
      port,
      token,
      onWsClient: (send) => {
        wsClients.add(send);
        return () => {
          wsClients.delete(send);
        };
      },
    });
    process.stderr.write(`OBSIDIAN_AI_SESSION_TOKEN=${token}\n`);
    process.stderr.write(`OBSIDIAN_AI_HTTP_URL=http://127.0.0.1:${port}\n`);
  } else {
    startStdioServer(runtime, log);
  }
}

main();
