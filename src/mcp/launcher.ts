import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import type { HubLock } from '../types.js';

const LOCK_PATH = join(homedir(), '.agent-net', 'hub.lock');
const HUB_PORT = 37842;

async function isHubAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/sessions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': 2 },
    }, (res) => {
      res.resume();
      resolve(res.statusCode === 400);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
    req.write('{}');
    req.end();
  });
}

async function readLock(): Promise<HubLock | null> {
  try {
    const data = await readFile(LOCK_PATH, 'utf8');
    return JSON.parse(data) as HubLock;
  } catch { return null; }
}

async function writeLock(lock: HubLock): Promise<void> {
  await mkdir(join(homedir(), '.agent-net'), { recursive: true });
  await writeFile(LOCK_PATH, JSON.stringify(lock), 'utf8');
}

function isProcessRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function getHubSpawnArgs(): [string, string[]] {
  const selfUrl = import.meta.url;
  const isTsx = selfUrl.endsWith('.ts');
  const ext = isTsx ? '.ts' : '.js';
  const indexPath = fileURLToPath(new URL(`../index${ext}`, selfUrl));
  const nodeArgs = isTsx ? ['--import', 'tsx/esm', indexPath, '--hub'] : [indexPath, '--hub'];
  return [process.execPath, nodeArgs];
}

function spawnHub(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, args] = getHubSpawnArgs();
    const child = spawn(cmd, args, {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, AGENT_NET_HUB_PORT: String(port) },
    });

    const timeout = setTimeout(() => {
      try { child.disconnect(); } catch {}
      reject(new Error('Hub start timeout'));
    }, 10_000);

    child.on('message', (msg: unknown) => {
      const m = msg as Record<string, unknown>;
      if (m.ready) {
        clearTimeout(timeout);
        try { child.disconnect(); } catch {}
        child.unref();
        resolve();
      }
    });

    child.on('error', (e) => { clearTimeout(timeout); reject(e); });
    child.unref();
  });
}

export async function ensureHub(): Promise<number> {
  const lock = await readLock();
  if (lock) {
    const running = lock.pid > 0 ? isProcessRunning(lock.pid) : true;
    if (running && await isHubAlive(lock.port)) {
      return lock.port;
    }
  }

  await spawnHub(HUB_PORT);
  await writeLock({ port: HUB_PORT, pid: -1 });

  // Wait for hub to be ready (up to 5s)
  for (let i = 0; i < 50; i++) {
    if (await isHubAlive(HUB_PORT)) return HUB_PORT;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Hub did not become ready in time');
}
