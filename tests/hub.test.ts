import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startHub } from '../src/hub/server.js';

const PORT = 37843; // test port, different from prod

async function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ hostname: 'localhost', port: PORT, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let buf = '';
      res.on('data', (c: Buffer) => buf += c);
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(buf) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function del(path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: PORT, path, method: 'DELETE' }, (res) => {
      let buf = '';
      res.on('data', (c: Buffer) => buf += c);
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(buf) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function get(path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: PORT, path, method: 'GET' }, (res) => {
      let buf = '';
      res.on('data', (c: Buffer) => buf += c);
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(buf) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function subscribeSSE(sessionId: string): Promise<{ events: unknown[]; stop: () => void }> {
  return new Promise((resolve) => {
    const events: unknown[] = [];
    const req = http.request(
      { hostname: 'localhost', port: PORT, path: `/events/${sessionId}`, method: 'GET',
        headers: { Accept: 'text/event-stream' } },
      (res) => {
        let buf = '';
        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try { events.push(JSON.parse(line.slice(6))); } catch {}
            }
          }
        });
        resolve({ events, stop: () => req.destroy() });
      }
    );
    req.on('error', () => {});
    req.end();
  });
}

let stopHub: () => void;

before(async () => {
  stopHub = await startHub(PORT);
});

after(() => {
  stopHub();
});

describe('POST /sessions', () => {
  it('registers agent and returns session id', async () => {
    const res = await post('/sessions', { name: 'claude-code', repo: 'github.com/org/repo', branch: 'main' });
    assert.equal(res.status, 200);
    const body = res.body as Record<string, unknown>;
    assert.match(String(body.sessionId), /^claude-code#/);
    assert.ok(typeof body.roomId === 'string');
    assert.ok(Array.isArray(body.claims));
  });

  it('places two agents in same room for same repo+branch', async () => {
    const a = await post('/sessions', { name: 'a', repo: 'github.com/org/r', branch: 'main' });
    const b = await post('/sessions', { name: 'b', repo: 'github.com/org/r', branch: 'main' });
    assert.equal((a.body as Record<string, unknown>).roomId, (b.body as Record<string, unknown>).roomId);
  });

  it('returns 400 for missing fields', async () => {
    const res = await post('/sessions', { name: 'x' });
    assert.equal(res.status, 400);
  });
});

describe('DELETE /sessions/:id', () => {
  it('removes session', async () => {
    const reg = await post('/sessions', { name: 'temp', repo: 'github.com/org/tmp', branch: 'x' });
    const { sessionId } = reg.body as Record<string, string>;
    const res = await del(`/sessions/${sessionId}`);
    assert.equal(res.status, 200);
  });
});

describe('POST /claims', () => {
  it('grants claim to first agent', async () => {
    const reg = await post('/sessions', { name: 'a', repo: 'github.com/org/claim-test', branch: 'main' });
    const { sessionId } = reg.body as Record<string, string>;
    const res = await post('/claims', { sessionId, key: 'file:src/auth.ts', context: { line: 42 } });
    assert.equal(res.status, 200);
    assert.deepEqual((res.body as Record<string, unknown>).ok, true);
  });

  it('rejects second agent with holder info', async () => {
    const a = (await post('/sessions', { name: 'a', repo: 'github.com/org/cr2', branch: 'main' })).body as Record<string, string>;
    const b = (await post('/sessions', { name: 'b', repo: 'github.com/org/cr2', branch: 'main' })).body as Record<string, string>;
    await post('/claims', { sessionId: a.sessionId, key: 'task:fix', context: { note: 'mine' } });
    const res = await post('/claims', { sessionId: b.sessionId, key: 'task:fix', context: {} });
    assert.equal(res.status, 200);
    const body = res.body as Record<string, unknown>;
    assert.equal(body.ok, false);
    const holder = body.holder as Record<string, unknown>;
    assert.equal(holder.sessionId, a.sessionId);
  });

  it('returns 400 for missing fields', async () => {
    const res = await post('/claims', { key: 'x' });
    assert.equal(res.status, 400);
  });
});

describe('DELETE /claims/:sessionId/:key', () => {
  it('releases claim', async () => {
    const reg = (await post('/sessions', { name: 'a', repo: 'github.com/org/rel', branch: 'main' })).body as Record<string, string>;
    await post('/claims', { sessionId: reg.sessionId, key: 'task:x', context: {} });
    const res = await del(`/claims/${reg.sessionId}/task:x`);
    assert.equal(res.status, 200);
    assert.equal((res.body as Record<string, unknown>).ok, true);
  });
});

describe('GET /claims/:sessionId', () => {
  it('lists claims in room', async () => {
    const a = (await post('/sessions', { name: 'a', repo: 'github.com/org/lc', branch: 'main' })).body as Record<string, string>;
    const b = (await post('/sessions', { name: 'b', repo: 'github.com/org/lc', branch: 'main' })).body as Record<string, string>;
    await post('/claims', { sessionId: a.sessionId, key: 'file:a.ts', context: {} });
    await post('/claims', { sessionId: b.sessionId, key: 'file:b.ts', context: {} });
    const res = await get(`/claims/${a.sessionId}`);
    assert.equal(res.status, 200);
    const claims = (res.body as Record<string, unknown>).claims as unknown[];
    assert.equal(claims.length, 2);
  });
});

describe('SSE /events/:sessionId', () => {
  it('receives claim_acquired event when another agent claims', async () => {
    const a = (await post('/sessions', { name: 'a', repo: 'github.com/org/sse1', branch: 'main' })).body as Record<string, string>;
    const b = (await post('/sessions', { name: 'b', repo: 'github.com/org/sse1', branch: 'main' })).body as Record<string, string>;
    const { events, stop } = await subscribeSSE(a.sessionId);
    await new Promise(r => setTimeout(r, 50));
    await post('/claims', { sessionId: b.sessionId, key: 'file:sse.ts', context: {} });
    await new Promise(r => setTimeout(r, 100));
    stop();
    assert.equal(events.length, 1);
    const evt = events[0] as Record<string, unknown>;
    assert.equal(evt.type, 'claim_acquired');
    assert.equal(evt.key, 'file:sse.ts');
  });

  it('receives claim_released event when session disconnects', async () => {
    const a = (await post('/sessions', { name: 'a', repo: 'github.com/org/sse2', branch: 'main' })).body as Record<string, string>;
    const b = (await post('/sessions', { name: 'b', repo: 'github.com/org/sse2', branch: 'main' })).body as Record<string, string>;
    await post('/claims', { sessionId: b.sessionId, key: 'file:rel.ts', context: {} });
    const { events, stop } = await subscribeSSE(a.sessionId);
    await new Promise(r => setTimeout(r, 50));
    await del(`/sessions/${b.sessionId}`);
    await new Promise(r => setTimeout(r, 100));
    stop();
    const relEv = events.find((e) => (e as Record<string, unknown>).type === 'claim_released');
    assert.ok(relEv, 'expected claim_released event');
  });

  it('does not deliver events to other rooms', async () => {
    const a = (await post('/sessions', { name: 'a', repo: 'github.com/org/sse3', branch: 'main' })).body as Record<string, string>;
    const b = (await post('/sessions', { name: 'b', repo: 'github.com/org/sse3', branch: 'other' })).body as Record<string, string>;
    const { events, stop } = await subscribeSSE(a.sessionId);
    await new Promise(r => setTimeout(r, 50));
    await post('/claims', { sessionId: b.sessionId, key: 'file:other.ts', context: {} });
    await new Promise(r => setTimeout(r, 100));
    stop();
    assert.equal(events.length, 0);
  });
});

describe('POST /broadcasts', () => {
  it('delivers broadcast to room via SSE', async () => {
    const a = (await post('/sessions', { name: 'a', repo: 'github.com/org/bc1', branch: 'main' })).body as Record<string, string>;
    const b = (await post('/sessions', { name: 'b', repo: 'github.com/org/bc1', branch: 'main' })).body as Record<string, string>;
    const { events, stop } = await subscribeSSE(a.sessionId);
    await new Promise(r => setTimeout(r, 50));
    const res = await post('/broadcasts', { sessionId: b.sessionId, message: 'tests are broken' });
    await new Promise(r => setTimeout(r, 100));
    stop();
    assert.equal(res.status, 200);
    const bc = events.find((e) => (e as Record<string, unknown>).type === 'broadcast') as Record<string, unknown> | undefined;
    assert.ok(bc, 'expected broadcast event');
    assert.equal(bc.message, 'tests are broken');
    assert.equal(bc.sessionId, b.sessionId);
  });

  it('does not deliver broadcast to other rooms', async () => {
    const a = (await post('/sessions', { name: 'a', repo: 'github.com/org/bc2', branch: 'main' })).body as Record<string, string>;
    const b = (await post('/sessions', { name: 'b', repo: 'github.com/org/bc2', branch: 'other' })).body as Record<string, string>;
    const { events, stop } = await subscribeSSE(a.sessionId);
    await new Promise(r => setTimeout(r, 50));
    await post('/broadcasts', { sessionId: b.sessionId, message: 'hello other room' });
    await new Promise(r => setTimeout(r, 100));
    stop();
    assert.equal(events.filter((e) => (e as Record<string, unknown>).type === 'broadcast').length, 0);
  });

  it('returns 400 for missing fields', async () => {
    const res = await post('/broadcasts', { message: 'x' });
    assert.equal(res.status, 400);
  });
});
