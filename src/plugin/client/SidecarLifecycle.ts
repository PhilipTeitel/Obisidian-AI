import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
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

const NODE_EXE = process.platform === 'win32' ? 'node.exe' : 'node';

function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathDirsFromEnv(): string[] {
  const raw = process.env.PATH ?? '';
  return raw
    .split(path.delimiter)
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
}

/** Extra dirs GUI apps often omit from PATH (e.g. Obsidian launched from Dock on macOS). */
function extraNodeSearchDirs(): string[] {
  const out: string[] = [];
  if (process.platform === 'darwin') {
    out.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin');
  } else if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const pfx86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    out.push(path.join(pf, 'nodejs'), path.join(pfx86, 'nodejs'));
  } else {
    out.push('/usr/local/bin', '/usr/bin');
  }
  const nvmBin = process.env.NVM_BIN?.trim();
  if (nvmBin) out.push(nvmBin);
  const fnm = path.join(os.homedir(), '.local', 'share', 'fnm', 'aliases', 'default', 'bin');
  out.push(fnm);
  return out;
}

function firstExistingNode(candidates: string[]): string | undefined {
  for (const dir of candidates) {
    const full = path.join(dir, NODE_EXE);
    if (!fs.existsSync(full)) continue;
    if (process.platform === 'win32' || isExecutableFile(full)) return full;
  }
  return undefined;
}

function nodeBinaryLooksUsable(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  return process.platform === 'win32' || isExecutableFile(filePath);
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function getNvmInstallRoot(): string | undefined {
  const env = process.env.NVM_DIR?.trim();
  if (env && isDir(env)) {
    return env;
  }
  const home = path.join(os.homedir(), '.nvm');
  if (isDir(home)) {
    return home;
  }
  return undefined;
}

/** Follow nvm alias files until we get a version directory name (e.g. v22.11.0). */
function resolveNvmAliasToVersionDirName(nvmRoot: string, start: string): string | undefined {
  let target = start.trim();
  for (let depth = 0; depth < 20; depth++) {
    if (!target || target === 'system') return undefined;

    const versionsDir = path.join(nvmRoot, 'versions', 'node', target);
    if (isDir(versionsDir)) {
      const bin = path.join(versionsDir, 'bin', NODE_EXE);
      if (nodeBinaryLooksUsable(bin)) return target;
      return undefined;
    }

    if (/^v[0-9]+\.[0-9]+\.[0-9]/.test(target)) {
      return undefined;
    }

    const aliasFile =
      target.startsWith('lts/') && target.length > 'lts/'.length
        ? path.join(nvmRoot, 'alias', 'lts', target.slice('lts/'.length))
        : path.join(nvmRoot, 'alias', target);

    if (!isFile(aliasFile)) {
      return undefined;
    }

    target = fs.readFileSync(aliasFile, 'utf8').trim();
  }
  return undefined;
}

function highestNvmInstalledVersionName(nvmRoot: string): string | undefined {
  const base = path.join(nvmRoot, 'versions', 'node');
  if (!isDir(base)) return undefined;
  const names = fs.readdirSync(base).filter((n) => {
    const bin = path.join(base, n, 'bin', NODE_EXE);
    return /^v[0-9]+\.[0-9]+\.[0-9]/.test(n) && nodeBinaryLooksUsable(bin);
  });
  if (names.length === 0) return undefined;
  names.sort((a, b) => {
    const pa = a.replace(/^v/, '').split('.').map((x) => parseInt(x, 10));
    const pb = b.replace(/^v/, '').split('.').map((x) => parseInt(x, 10));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const da = pa[i] ?? 0;
      const db = pb[i] ?? 0;
      if (da !== db) return da - db;
    }
    return 0;
  });
  return names[names.length - 1];
}

/**
 * Resolve Node from an nvm install (Dock-started apps never load shell nvm hooks).
 * @param nvmRoot - When set (e.g. in tests), use this install root; otherwise NVM_DIR or ~/.nvm.
 */
export function tryResolveNvmNode(nvmRoot?: string): string | undefined {
  const root = nvmRoot ?? getNvmInstallRoot();
  if (!root) return undefined;

  const defaultFile = path.join(root, 'alias', 'default');
  let versionDir: string | undefined;
  if (isFile(defaultFile)) {
    const start = fs.readFileSync(defaultFile, 'utf8').trim();
    versionDir = resolveNvmAliasToVersionDirName(root, start);
  }
  versionDir ??= highestNvmInstalledVersionName(root);
  if (!versionDir) return undefined;

  const candidate = path.join(root, 'versions', 'node', versionDir, 'bin', NODE_EXE);
  return nodeBinaryLooksUsable(candidate) ? path.resolve(candidate) : undefined;
}

let loginShellNodeCache: string | null | undefined;

function defaultLoginShell(): string {
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
}

function pickLoginShell(): string {
  const s = process.env.SHELL?.trim();
  if (s && isFile(s) && isExecutableFile(s)) {
    return s;
  }
  return defaultLoginShell();
}

/**
 * Login shell loads ~/.zprofile / ~/.bash_profile where nvm is often initialized.
 * Cached for the lifetime of the plugin process.
 */
function tryResolveNodeViaLoginShell(): string | undefined {
  if (process.platform === 'win32') return undefined;
  if (loginShellNodeCache !== undefined) {
    return loginShellNodeCache || undefined;
  }
  try {
    const shell = pickLoginShell();
    const out = execFileSync(shell, ['-lc', 'command -v node'], {
      encoding: 'utf8',
      timeout: 3000,
      maxBuffer: 4096,
    });
    const lines = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    let lastGood: string | undefined;
    for (const line of lines) {
      if (
        (line.startsWith('/') || /^[A-Za-z]:\\/.test(line)) &&
        (line.endsWith(NODE_EXE) || line.endsWith(path.sep + NODE_EXE))
      ) {
        const resolved = path.resolve(line);
        if (nodeBinaryLooksUsable(resolved)) {
          lastGood = resolved;
        }
      }
    }
    if (lastGood) {
      loginShellNodeCache = lastGood;
      return lastGood;
    }
  } catch {
    /* ignore */
  }
  loginShellNodeCache = null;
  return undefined;
}

export type SidecarNodeResolutionSettings = Pick<ObsidianAISettings, 'nodeExecutablePath'>;

/**
 * Resolves an absolute path to a Node binary for the sidecar child.
 *
 * Order: **plugin setting `nodeExecutablePath`** (recommended for Dock-started Obsidian), then
 * `OBSIDIAN_AI_NODE`, then auto-detect (Homebrew-style dirs, nvm `~/.nvm`, `PATH`, login shell).
 */
export function resolveSidecarNodeExecutable(settings?: SidecarNodeResolutionSettings): string {
  const configured = settings?.nodeExecutablePath?.trim();
  if (configured) {
    const abs = path.resolve(configured);
    if (!fs.existsSync(abs)) {
      throw new Error(
        `Node executable path not found: ${abs}. Set Obsidian AI → Node executable path (output of \`which node\`).`,
      );
    }
    if (process.platform !== 'win32' && !isExecutableFile(abs)) {
      throw new Error(`Node executable path is not executable: ${abs}.`);
    }
    return abs;
  }

  const fromEnv = process.env.OBSIDIAN_AI_NODE?.trim();
  if (fromEnv) {
    if (fs.existsSync(fromEnv)) return path.resolve(fromEnv);
    throw new Error(
      `OBSIDIAN_AI_NODE is set but not found: ${fromEnv}. Fix the path or unset the variable.`,
    );
  }

  const fromExtra = firstExistingNode(extraNodeSearchDirs());
  if (fromExtra) return fromExtra;

  const fromNvm = tryResolveNvmNode();
  if (fromNvm) return fromNvm;

  const fromPath = firstExistingNode(pathDirsFromEnv());
  if (fromPath) return fromPath;

  if (process.versions.electron) {
    const fromShell = tryResolveNodeViaLoginShell();
    if (fromShell) return fromShell;
  }

  if (!process.versions.electron) {
    return process.execPath;
  }

  throw new Error(
    'Could not find Node.js for the sidecar. Set **Node executable path** in Obsidian AI settings ' +
      '(full path from `which node`), or set OBSIDIAN_AI_NODE, or launch Obsidian from a terminal.',
  );
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
    const vaultBasePath = (
      this.host.app.vault.adapter as { getBasePath?: () => string }
    ).getBasePath?.();
    return path.resolve(vaultBasePath ?? '.', dir, 'sidecar', 'server.cjs');
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
    const node = resolveSidecarNodeExecutable(this.host.settings);
    const args = this.host.settings.sidecarInspector ? ['--inspect=0', script] : [script];
    console.log('Obsidian AI: spawning sidecar', {
      node,
      args,
      script,
      scriptExists: fs.existsSync(script),
      inspect: this.host.settings.sidecarInspector,
    });

    const child = spawn(node, args, {
      env: this.buildEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    console.log('Obsidian AI: sidecar process created', { pid: child.pid, node, args });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) {
        console.error('Obsidian AI: sidecar stderr', { pid: child.pid, text });
      }
    });
    child.on('exit', (code, signal) => {
      console.error('Obsidian AI: sidecar exited', { pid: child.pid, code, signal });
    });
    child.on('close', (code, signal) => {
      console.error('Obsidian AI: sidecar closed', { pid: child.pid, code, signal });
    });

    try {
      await Promise.race([once(child, 'spawn'), once(child, 'error')]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Obsidian AI: sidecar spawn failed', { pid: child.pid, node, args, script, error: e });
      throw new Error(`Sidecar spawn failed (${msg}). Set Node executable path in Obsidian AI settings.`);
    }

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
