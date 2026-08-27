import { DurableObject } from 'cloudflare:workers';
import { Env } from './env';

interface Attachment {
  raiderId: number | null; // null for admin observers
  /** The login token this socket authenticated with (lets /logout close just this device's sockets). */
  token: string | null;
}

/**
 * Single global object tracking which raiders are online — purely for the roster badges.
 * Login lifetime lives in D1 (the `logins` table); the worker route validates tokens and
 * this object simply trusts the raider id it is handed. "Online" = has an open socket here.
 */
export class PresenceDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Logins used to live in this object's storage; they are in D1 now.
    ctx.blockConcurrencyWhile(async () => ctx.storage.delete('logins'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const raiderId = Number(url.searchParams.get('raiderId')) || null;
    const token = url.searchParams.get('token');

    switch (url.pathname) {
      case '/logout': {
        // One device logged out: close only the sockets holding that token.
        this.closeSockets((att) => att.raiderId === raiderId && !!token && att.token === token, 4000, 'logged out');
        return Response.json({ ok: true });
      }
      case '/end': {
        // Admin ended a raider's login (D1 rows already deleted): bounce all their sockets.
        if (raiderId) this.closeSockets((att) => att.raiderId === raiderId, 4001, 'ended by admin');
        return Response.json({ ok: true });
      }
      case '/end-all': {
        // After a data import, raider ids may mean different people: bounce everyone.
        this.closeSockets((att) => att.raiderId != null, 4001, 'ended by admin');
        return Response.json({ ok: true });
      }
      case '/online':
        return Response.json(this.snapshot());
      case '/ws': {
        // The route only sets raiderId after validating the token against D1.
        const admin = request.headers.get('X-Admin') === '1';
        if (raiderId == null && !admin) return new Response('not logged in', { status: 401 });
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1]);
        pair[1].serializeAttachment({ raiderId, token } satisfies Attachment);
        this.broadcast();
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
    }
    return new Response('not found', { status: 404 });
  }

  async webSocketMessage() {
    /* clients only listen */
  }

  async webSocketClose(ws: WebSocket) {
    this.detached(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.detached(ws);
  }

  private detached(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    this.broadcast(ws);
  }

  // ---- helpers ----

  private closeSockets(match: (att: Attachment) => boolean, code: number, reason: string) {
    for (const ws of this.ctx.getWebSockets()) {
      if (match(ws.deserializeAttachment() as Attachment)) {
        try {
          ws.close(code, reason);
        } catch {
          /* closed */
        }
      }
    }
    this.broadcast();
  }

  private snapshot(except?: WebSocket) {
    const online = new Set<number>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const att = ws.deserializeAttachment() as Attachment;
      if (att.raiderId != null) online.add(att.raiderId);
    }
    return { online: [...online] };
  }

  private broadcast(except?: WebSocket) {
    const data = JSON.stringify({ type: 'presence', ...this.snapshot(except) });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch {
        /* closed */
      }
    }
  }
}
