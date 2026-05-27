import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HubState } from '../src/hub/state.js';

describe('HubState.register', () => {
  it('returns a session id with name prefix', () => {
    const state = new HubState();
    const result = state.register('claude-code', 'github.com/org/repo', 'main');
    assert.match(result.sessionId, /^claude-code#/);
  });

  it('creates room scoped by repo+branch', () => {
    const state = new HubState();
    const a = state.register('agent-a', 'github.com/org/repo', 'main');
    const b = state.register('agent-b', 'github.com/org/repo', 'main');
    assert.equal(a.roomId, b.roomId);
  });

  it('isolates agents on different branches', () => {
    const state = new HubState();
    const a = state.register('agent-a', 'github.com/org/repo', 'main');
    const b = state.register('agent-b', 'github.com/org/repo', 'feature/auth');
    assert.notEqual(a.roomId, b.roomId);
  });

  it('returns empty claims on fresh room', () => {
    const state = new HubState();
    const result = state.register('claude-code', 'github.com/org/repo', 'main');
    assert.deepEqual(result.claims, []);
  });

  it('returns existing claims when joining an existing room', () => {
    const state = new HubState();
    const a = state.register('agent-a', 'github.com/org/repo', 'main');
    state.claim(a.sessionId, 'file:src/auth.ts', { note: 'fixing bug' });
    const b = state.register('agent-b', 'github.com/org/repo', 'main');
    assert.equal(b.claims.length, 1);
    assert.equal(b.claims[0].key, 'file:src/auth.ts');
  });
});

describe('HubState.removeSession', () => {
  it('removes session from room', () => {
    const state = new HubState();
    const { sessionId } = state.register('claude-code', 'github.com/org/repo', 'main');
    const removed = state.removeSession(sessionId);
    assert.ok(removed);
    assert.equal(removed.releasedKeys.length, 0);
  });

  it('releases all claims held by the session', () => {
    const state = new HubState();
    const { sessionId } = state.register('claude-code', 'github.com/org/repo', 'main');
    state.claim(sessionId, 'file:a.ts', {});
    state.claim(sessionId, 'file:b.ts', {});
    const removed = state.removeSession(sessionId);
    assert.ok(removed);
    assert.equal(removed.releasedKeys.length, 2);
    assert.ok(removed.releasedKeys.includes('file:a.ts'));
    assert.ok(removed.releasedKeys.includes('file:b.ts'));
  });

  it('returns null for unknown session', () => {
    const state = new HubState();
    const result = state.removeSession('nonexistent#abc');
    assert.equal(result, null);
  });
});

describe('HubState.claim', () => {
  it('grants claim to first requester', () => {
    const state = new HubState();
    const { sessionId } = state.register('agent-a', 'github.com/org/repo', 'main');
    const result = state.claim(sessionId, 'file:src/auth.ts', { line: 42 });
    assert.deepEqual(result, { ok: true });
  });

  it('rejects second requester with holder info', () => {
    const state = new HubState();
    const a = state.register('agent-a', 'github.com/org/repo', 'main').sessionId;
    const b = state.register('agent-b', 'github.com/org/repo', 'main').sessionId;
    state.claim(a, 'file:src/auth.ts', { note: 'mine' });
    const result = state.claim(b, 'file:src/auth.ts', {});
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.holder.sessionId, a);
      assert.deepEqual(result.holder.context, { note: 'mine' });
    }
  });

  it('allows claim after release', () => {
    const state = new HubState();
    const a = state.register('agent-a', 'github.com/org/repo', 'main').sessionId;
    const b = state.register('agent-b', 'github.com/org/repo', 'main').sessionId;
    state.claim(a, 'file:src/auth.ts', {});
    state.release(a, 'file:src/auth.ts');
    const result = state.claim(b, 'file:src/auth.ts', {});
    assert.deepEqual(result, { ok: true });
  });

  it('does not cross room boundaries', () => {
    const state = new HubState();
    const a = state.register('agent-a', 'github.com/org/repo', 'main').sessionId;
    const b = state.register('agent-b', 'github.com/org/repo', 'feature').sessionId;
    state.claim(a, 'file:src/auth.ts', {});
    const result = state.claim(b, 'file:src/auth.ts', {});
    assert.deepEqual(result, { ok: true });
  });

  it('throws for unknown session', () => {
    const state = new HubState();
    assert.throws(() => state.claim('ghost#xyz', 'key', {}), /Unknown session/);
  });
});

describe('HubState.release', () => {
  it('releases own claim', () => {
    const state = new HubState();
    const { sessionId } = state.register('agent-a', 'github.com/org/repo', 'main');
    state.claim(sessionId, 'file:src/auth.ts', {});
    const ok = state.release(sessionId, 'file:src/auth.ts');
    assert.equal(ok, true);
  });

  it('cannot release another agent claim', () => {
    const state = new HubState();
    const a = state.register('agent-a', 'github.com/org/repo', 'main').sessionId;
    const b = state.register('agent-b', 'github.com/org/repo', 'main').sessionId;
    state.claim(a, 'file:src/auth.ts', {});
    const ok = state.release(b, 'file:src/auth.ts');
    assert.equal(ok, false);
  });

  it('returns false for unclaimed key', () => {
    const state = new HubState();
    const { sessionId } = state.register('agent-a', 'github.com/org/repo', 'main');
    const ok = state.release(sessionId, 'nonexistent');
    assert.equal(ok, false);
  });
});

describe('HubState.listClaims', () => {
  it('returns all claims in room', () => {
    const state = new HubState();
    const a = state.register('agent-a', 'github.com/org/repo', 'main').sessionId;
    const b = state.register('agent-b', 'github.com/org/repo', 'main').sessionId;
    state.claim(a, 'file:a.ts', {});
    state.claim(b, 'file:b.ts', {});
    const claims = state.listClaims(a);
    assert.equal(claims.length, 2);
  });

  it('excludes claims from other rooms', () => {
    const state = new HubState();
    const a = state.register('agent-a', 'github.com/org/repo', 'main').sessionId;
    const b = state.register('agent-b', 'github.com/org/repo', 'feature').sessionId;
    state.claim(a, 'file:a.ts', {});
    state.claim(b, 'file:b.ts', {});
    const claims = state.listClaims(a);
    assert.equal(claims.length, 1);
    assert.equal(claims[0].key, 'file:a.ts');
  });

  it('returns empty array for unknown session', () => {
    const state = new HubState();
    const claims = state.listClaims('ghost#xyz');
    assert.deepEqual(claims, []);
  });
});
