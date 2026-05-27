import { randomBytes } from 'node:crypto';
import type { Session, Room, Claim, RegisterResult, ClaimResult } from '../types.js';

export class HubState {
  private rooms = new Map<string, Room>();
  private sessionIndex = new Map<string, Room>();

  register(name: string, repo: string, branch: string): RegisterResult {
    const roomId = `${repo}#${branch}`;
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { id: roomId, repo, branch, sessions: new Map(), claims: new Map() };
      this.rooms.set(roomId, room);
    }
    const sessionId = `${name}#${randomBytes(4).toString('hex')}`;
    const session: Session = { id: sessionId, name, roomId };
    room.sessions.set(sessionId, session);
    this.sessionIndex.set(sessionId, room);
    return { sessionId, roomId, claims: Array.from(room.claims.values()) };
  }

  removeSession(sessionId: string): { roomId: string; releasedKeys: string[] } | null {
    const room = this.sessionIndex.get(sessionId);
    if (!room) return null;
    room.sessions.delete(sessionId);
    this.sessionIndex.delete(sessionId);
    const releasedKeys: string[] = [];
    for (const [key, claim] of room.claims) {
      if (claim.sessionId === sessionId) {
        room.claims.delete(key);
        releasedKeys.push(key);
      }
    }
    return { roomId: room.id, releasedKeys };
  }

  claim(sessionId: string, key: string, context: Record<string, unknown>): ClaimResult {
    const room = this.sessionIndex.get(sessionId);
    if (!room) throw new Error(`Unknown session: ${sessionId}`);
    const existing = room.claims.get(key);
    if (existing) {
      return { ok: false, holder: { sessionId: existing.sessionId, context: existing.context } };
    }
    room.claims.set(key, { key, sessionId, context, acquiredAt: Date.now() });
    return { ok: true };
  }

  release(sessionId: string, key: string): boolean {
    const room = this.sessionIndex.get(sessionId);
    if (!room) return false;
    const claim = room.claims.get(key);
    if (!claim || claim.sessionId !== sessionId) return false;
    room.claims.delete(key);
    return true;
  }

  listClaims(sessionId: string): Claim[] {
    const room = this.sessionIndex.get(sessionId);
    if (!room) return [];
    return Array.from(room.claims.values());
  }

  getRoomId(sessionId: string): string | null {
    return this.sessionIndex.get(sessionId)?.id ?? null;
  }
}
