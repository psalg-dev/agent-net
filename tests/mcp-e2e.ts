/**
 * End-to-end test: starts MCP server, drives it via stdio protocol,
 * verifies all 5 tools work correctly.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import path from 'node:path';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../');

async function runMCPTest(): Promise<void> {
  const proc = spawn(process.execPath, ['--import', 'tsx/esm', path.join(ROOT, 'src/index.ts')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  let pendingId = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const notifications: unknown[] = [];

  const rl = createInterface({ input: proc.stdout! });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line) as Record<string, unknown>;
      if ('id' in msg) {
        const p = pending.get(Number(msg.id));
        if (p) {
          pending.delete(Number(msg.id));
          if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        }
      } else {
        notifications.push(msg);
      }
    } catch {}
  });

  proc.stderr!.on('data', () => {}); // suppress hub spawn output

  function send(method: string, params: unknown, id?: number): Promise<unknown> {
    const msgId = id ?? ++pendingId;
    return new Promise((resolve, reject) => {
      pending.set(msgId, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: '2.0', id: msgId, method, params }) + '\n';
      proc.stdin!.write(msg);
    });
  }

  function notify(method: string, params: unknown): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    proc.stdin!.write(msg);
  }

  try {
    // Initialize
    const initResult = await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { roots: { listChanged: false } },
      clientInfo: { name: 'test-client', version: '1.0' },
    }) as Record<string, unknown>;
    assert.equal((initResult as Record<string, unknown>).protocolVersion !== undefined, true, 'init returned protocolVersion');
    notify('notifications/initialized', {});

    // List tools
    const listResult = await send('tools/list', {}) as Record<string, unknown>;
    const tools = listResult.tools as Array<{ name: string }>;
    const toolNames = tools.map(t => t.name);
    assert.ok(toolNames.includes('register'), 'register tool present');
    assert.ok(toolNames.includes('claim'), 'claim tool present');
    assert.ok(toolNames.includes('release'), 'release tool present');
    assert.ok(toolNames.includes('list_claims'), 'list_claims tool present');
    assert.ok(toolNames.includes('broadcast'), 'broadcast tool present');
    console.log(`✓ tools/list: ${toolNames.join(', ')}`);

    async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
      const result = await send('tools/call', { name, arguments: args }) as Record<string, unknown>;
      const content = result.content as Array<{ type: string; text: string }>;
      return content[0].text;
    }

    // register
    const regRaw = await callTool('register', { name: 'claude-code', repo: 'github.com/e2e/test', branch: 'main' });
    const reg = JSON.parse(regRaw) as { sessionId: string; roomId: string; claims: unknown[] };
    assert.match(reg.sessionId, /^claude-code#/);
    assert.equal(reg.roomId, 'github.com/e2e/test#main');
    assert.deepEqual(reg.claims, []);
    console.log(`✓ register: sessionId=${reg.sessionId}`);

    const sid = reg.sessionId;

    // claim (success)
    const claimRaw = await callTool('claim', { session_id: sid, key: 'file:src/auth.ts', context: { line: 42 } });
    const claim = JSON.parse(claimRaw) as { ok: boolean };
    assert.equal(claim.ok, true);
    console.log(`✓ claim: ok=true`);

    // list_claims
    const listRaw = await callTool('list_claims', { session_id: sid });
    const listed = JSON.parse(listRaw) as { claims: Array<{ key: string; sessionId: string }> };
    assert.equal(listed.claims.length, 1);
    assert.equal(listed.claims[0].key, 'file:src/auth.ts');
    console.log(`✓ list_claims: ${listed.claims.length} claim(s)`);

    // broadcast
    const bcRaw = await callTool('broadcast', { session_id: sid, message: 'test suite is broken' });
    const bc = JSON.parse(bcRaw) as { ok: boolean };
    assert.equal(bc.ok, true);
    console.log(`✓ broadcast: ok=true`);

    // release
    const relRaw = await callTool('release', { session_id: sid, key: 'file:src/auth.ts' });
    const rel = JSON.parse(relRaw) as { ok: boolean };
    assert.equal(rel.ok, true);
    console.log(`✓ release: ok=true`);

    // list_claims after release (should be empty)
    const listRaw2 = await callTool('list_claims', { session_id: sid });
    const listed2 = JSON.parse(listRaw2) as { claims: unknown[] };
    assert.equal(listed2.claims.length, 0);
    console.log(`✓ list_claims after release: 0 claims`);

    console.log('\n✓ All MCP tools verified.');
  } finally {
    proc.kill();
  }
}

runMCPTest().catch((e) => { console.error('FAIL:', e); process.exit(1); });
