import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HubState } from './state.js';
import { EventBus } from './events.js';

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c: Buffer) => buf += c.toString());
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(data);
}

function err(res: ServerResponse, status: number, message: string): void {
  send(res, status, { error: message });
}

export async function startHub(port: number): Promise<() => void> {
  const state = new HubState();
  const bus = new EventBus();

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // POST /sessions
    if (method === 'POST' && url === '/sessions') {
      readBody(req).then((body) => {
        const { name, repo, branch } = body as Record<string, string>;
        if (!name || !repo || !branch) return err(res, 400, 'name, repo, branch required');
        const result = state.register(name, repo, branch);
        send(res, 200, result);
      }).catch(() => err(res, 400, 'Invalid request'));
      return;
    }

    // DELETE /sessions/:id
    const delSession = url.match(/^\/sessions\/(.+)$/);
    if (method === 'DELETE' && delSession) {
      const sessionId = decodeURIComponent(delSession[1]);
      const removed = state.removeSession(sessionId);
      if (removed) {
        for (const key of removed.releasedKeys) {
          bus.emit(removed.roomId, { type: 'claim_released', key, sessionId });
        }
      }
      send(res, 200, { ok: true });
      return;
    }

    // POST /claims
    if (method === 'POST' && url === '/claims') {
      readBody(req).then((body) => {
        const { sessionId, key, context } = body as Record<string, unknown>;
        if (!sessionId || !key) return err(res, 400, 'sessionId, key required');
        try {
          const result = state.claim(String(sessionId), String(key), (context as Record<string, unknown>) ?? {});
          if (result.ok) {
            const roomId = state.getRoomId(String(sessionId));
            if (roomId) bus.emit(roomId, { type: 'claim_acquired', key: String(key), sessionId: String(sessionId), context: (context as Record<string, unknown>) ?? {} });
          }
          send(res, 200, result);
        } catch (e) {
          err(res, 400, String(e));
        }
      }).catch(() => err(res, 400, 'Invalid request'));
      return;
    }

    // DELETE /claims/:sessionId/:key
    const delClaim = url.match(/^\/claims\/([^/]+)\/(.+)$/);
    if (method === 'DELETE' && delClaim) {
      const sessionId = decodeURIComponent(delClaim[1]);
      const key = decodeURIComponent(delClaim[2]);
      const roomId = state.getRoomId(sessionId);
      const ok = state.release(sessionId, key);
      if (ok && roomId) bus.emit(roomId, { type: 'claim_released', key, sessionId });
      send(res, 200, { ok });
      return;
    }

    // GET /claims/:sessionId
    const getClaims = url.match(/^\/claims\/(.+)$/);
    if (method === 'GET' && getClaims) {
      const sessionId = decodeURIComponent(getClaims[1]);
      const claims = state.listClaims(sessionId);
      send(res, 200, { claims });
      return;
    }

    // GET /events/:sessionId — SSE
    const getEvents = url.match(/^\/events\/(.+)$/);
    if (method === 'GET' && getEvents) {
      const sessionId = decodeURIComponent(getEvents[1]);
      const roomId = state.getRoomId(sessionId);
      if (!roomId) return err(res, 404, 'Session not found');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('\n');
      const unsub = bus.subscribe(roomId, res);
      req.on('close', () => {
        unsub();
      });
      return;
    }

    // POST /broadcasts
    if (method === 'POST' && url === '/broadcasts') {
      readBody(req).then((body) => {
        const { sessionId, message } = body as Record<string, unknown>;
        if (!sessionId || !message) return err(res, 400, 'sessionId, message required');
        const roomId = state.getRoomId(String(sessionId));
        if (!roomId) return err(res, 404, 'Session not found');
        bus.emit(roomId, { type: 'broadcast', sessionId: String(sessionId), message: String(message), timestamp: Date.now() });
        send(res, 200, { ok: true });
      }).catch(() => err(res, 400, 'Invalid request'));
      return;
    }

    err(res, 404, 'Not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  return () => server.close();
}

