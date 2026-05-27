import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HubEvent } from '../types.js';

export class EventBus {
  private subscribers = new Map<string, Set<ServerResponse>>();

  subscribe(roomId: string, res: ServerResponse<IncomingMessage>): () => void {
    let subs = this.subscribers.get(roomId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(roomId, subs);
    }
    subs.add(res);
    return () => {
      subs!.delete(res);
      if (subs!.size === 0) this.subscribers.delete(roomId);
    };
  }

  emit(roomId: string, event: HubEvent, excludeSessionId?: string): void {
    const subs = this.subscribers.get(roomId);
    if (!subs) return;
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of subs) {
      try { res.write(data); } catch {}
    }
  }
}
