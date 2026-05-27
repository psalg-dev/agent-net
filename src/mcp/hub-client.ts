import http from 'node:http';
import type { RegisterResult, ClaimResult, Claim, HubEvent } from '../types.js';

export class HubClient {
  constructor(private port: number) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : undefined;
      const opts: http.RequestOptions = {
        hostname: '127.0.0.1', port: this.port, path, method,
        headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
      };
      const req = http.request(opts, (res) => {
        let buf = '';
        res.on('data', (c: Buffer) => buf += c.toString());
        res.on('end', () => {
          try { resolve(JSON.parse(buf) as T); }
          catch { reject(new Error(`Invalid JSON from Hub: ${buf}`)); }
        });
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  register(name: string, repo: string, branch: string): Promise<RegisterResult> {
    return this.request('POST', '/sessions', { name, repo, branch });
  }

  removeSession(sessionId: string): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/sessions/${encodeURIComponent(sessionId)}`);
  }

  claim(sessionId: string, key: string, context: Record<string, unknown>): Promise<ClaimResult> {
    return this.request('POST', '/claims', { sessionId, key, context });
  }

  release(sessionId: string, key: string): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/claims/${encodeURIComponent(sessionId)}/${encodeURIComponent(key)}`);
  }

  listClaims(sessionId: string): Promise<{ claims: Claim[] }> {
    return this.request('GET', `/claims/${encodeURIComponent(sessionId)}`);
  }

  broadcast(sessionId: string, message: string): Promise<{ ok: boolean }> {
    return this.request('POST', '/broadcasts', { sessionId, message });
  }

  subscribeEvents(sessionId: string, onEvent: (event: HubEvent) => void): () => void {
    const req = http.request(
      { hostname: '127.0.0.1', port: this.port, path: `/events/${encodeURIComponent(sessionId)}`, method: 'GET',
        headers: { Accept: 'text/event-stream' } },
      (res) => {
        let buf = '';
        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try { onEvent(JSON.parse(line.slice(6)) as HubEvent); } catch {}
            }
          }
        });
      }
    );
    req.on('error', () => {});
    req.end();
    return () => req.destroy();
  }
}
