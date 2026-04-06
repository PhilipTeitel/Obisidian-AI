import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import type { App, Vault } from 'obsidian';
import type { ISidecarTransport } from '../../core/ports/ISidecarTransport.js';
import type { ObsidianAISettings } from '../settings/types.js';
import { HttpTransportAdapter } from './HttpTransportAdapter.js';
import { StdioTransportAdapter } from './StdioTransportAdapter.js';

export interface SidecarHost {
  app: App;
  manifest: { dir?: string };
  settings: ObsidianAISettings;
}

export function vaultDefaultDbPath(vault: Vault): string {
  const raw = vault.getName().replace(/[^a-z0-9_-]+/gi, '_').toLowerCase() || 'vault';
  return path.join(os.homedir(), '.obsidian-ai', `${raw}.db`);
}

/**
 * PLG-1: spawn sidecar, wait for health (stdio or HTTP handshake).
 */
export class SidecarLifecycle {
  private child: ChildProcessWithoutNullStreams | null = null;
  private transport: ISidecarTransport | null = null;
  private stdioAdapter: StdioTransportAdapter | null = null;

  constructor(private readonly host: SidecarHost) {}

  private sidecarScriptPath(): string {
    const dir = this.host.manifest.dir;
    if (!dir) {
      throw new Error('SidecarLifecycle: plugin manifest.dir missing');
    }
    return path.join(dir, 'dist', 'sidecar', 'server.js');
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const s = this.host.settings;
    const db = s.dbPath.trim() !== '' ? s.dbPath.trim() : vaultDefaultDbPath(this.host.app.vault);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OBSIDIAN_AI_DB_PATH: db,
      OBSIDIAN_AI_EMBEDDING_PROVIDER: s.embeddingProvider,
      OBSIDIAN_AI_EMBEDDING_BASE_URL: s.embeddingBaseUrl,
      OBSIDIAN_AI_EMBEDDING_MODEL: s.embeddingModel,
      OBSIDIAN_AI_CHAT_PROVIDER: s.chatProvider,
      OBSIDIAN_AI_CHAT_BASE_URL: s.chatBaseUrl,
      OBSIDIAN_AI_CHAT_MODEL: s.chatModel,
      OBSIDIAN_AI_EMBEDDING_DIMENSION: String(s.embeddingDimension),
      OBSIDIAN_AI_QUEUE_CONCURRENCY: String(s.queueConcurrency),
      OBSIDIAN_AI_MAX_RETRIES: String(s.maxRetries),
      OBSIDIAN_AI_LOG_LEVEL: s.logLevel,
    };
    if (s.transport === 'http') {
      env.OBSIDIAN_AI_HTTP_PORT = '0';
    } else {
      delete env.OBSIDIAN_AI_HTTP_PORT;
    }
    return env;
  }

  async start(): Promise<ISidecarTransport> {
    const script = this.sidecarScriptPath();
    const child = spawn(process.execPath, [script], {
      env: this.buildEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    child.on('error', (err) => {
      console.error('Obsidian AI: sidecar spawn error', err);
    });

    if (this.host.settings.transport === 'http') {
      const { baseUrl, token } = await this.readHttpHandshake(child);
      await this.assertHttpHealth(baseUrl, token);
      this.transport = new HttpTransportAdapter(baseUrl, token);
      return this.transport;
    }

    const adapter = new StdioTransportAdapter(child.stdin, child.stdout);
    this.stdioAdapter = adapter;
    await adapter.send({ type: 'health' });
    this.transport = adapter;
    return adapter;
  }

  private readHttpHandshake(child: ChildProcessWithoutNullStreams): Promise<{ baseUrl: string; token: string }> {
    return new Promise((resolve, reject) => {
      let token = '';
      let baseUrl = '';
      const to = setTimeout(() => {
        rl.close();
        reject(new Error('sidecar HTTP handshake timeout'));
      }, 15_000);
      const rl = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });
      const tryDone = () => {
        if (token && baseUrl) {
          clearTimeout(to);
          rl.close();
          resolve({ baseUrl: baseUrl.trim(), token: token.trim() });
        }
      };
      rl.on('line', (line) => {
        if (line.startsWith('OBSIDIAN_AI_SESSION_TOKEN=')) {
          token = line.slice('OBSIDIAN_AI_SESSION_TOKEN='.length);
          tryDone();
        } else if (line.startsWith('OBSIDIAN_AI_HTTP_URL=')) {
          baseUrl = line.slice('OBSIDIAN_AI_HTTP_URL='.length);
          tryDone();
        }
      });
      child.once('exit', (code) => {
        if (!token || !baseUrl) {
          clearTimeout(to);
          rl.close();
          reject(new Error(`sidecar exited during HTTP handshake (code ${code})`));
        }
      });
    });
  }

  private async assertHttpHealth(baseUrl: string, token: string): Promise<void> {
    const base = baseUrl.replace(/\/$/, '');
    const r = await fetch(`${base}/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      throw new Error(`sidecar HTTP health failed: ${r.status}`);
    }
  }

  async stop(): Promise<void> {
    this.stdioAdapter?.close();
    this.stdioAdapter = null;
    this.transport = null;
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
  }

  getTransport(): ISidecarTransport | null {
    return this.transport;
  }
}
