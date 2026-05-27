export interface Session {
  id: string;
  name: string;
  roomId: string;
}

export interface Claim {
  key: string;
  sessionId: string;
  context: Record<string, unknown>;
  acquiredAt: number;
}

export interface Room {
  id: string;
  repo: string;
  branch: string;
  sessions: Map<string, Session>;
  claims: Map<string, Claim>;
}

export type HubEvent =
  | { type: 'claim_acquired'; key: string; sessionId: string; context: Record<string, unknown> }
  | { type: 'claim_released'; key: string; sessionId: string }
  | { type: 'broadcast'; sessionId: string; message: string; timestamp: number };

export interface RegisterResult {
  sessionId: string;
  roomId: string;
  claims: Claim[];
}

export type ClaimResult =
  | { ok: true }
  | { ok: false; holder: { sessionId: string; context: Record<string, unknown> } };

export interface HubLock {
  port: number;
  pid: number;
}
