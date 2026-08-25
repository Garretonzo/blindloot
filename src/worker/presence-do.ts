import { DurableObject } from 'cloudflare:workers';
import { Env } from './env';

/** How long a login survives without an open socket (tab closed, network blip). */
const GRACE_MS = 30_000;

interface Login {
  token: string;
  username: string;
  since: number;
  /** Set while no socket is connected; the login expires when this passes. */
  graceUntil: number | null;
}

interface Attachment {
  raiderId: number | null; // null for admin observers
}

/**
 * Single global object tracking which raiders are logged in.
 * A logged-in browser keeps a WebSocket here; admins connect as observers to see presence live.
 */
export class PresenceDO extends DurableObject<Env> {
  private logins!: Record<number, Login>;
  private ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.logins = (await ctx.storage.get<Record<number, Login>>('logins')) ?? {};
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    const raiderId = Number(url.searchParams.get('raiderId')) || null;
    const token = url.searchParams.get('token') ?? '';

    switch (url.pathname) {
      case '/login': {
        const { raiderId: id, username, token: presented } = (await request.json()) as { raiderId: number; username: string; token?: string };
        const existing = this.logins[id];
        if (existing && this.isActive(existing)) {
          // Same browser re-checking its own login: hand the existing one back (idempotent).
          if (presented && presented === existing.token) return Response.json({ raiderId: id, username, token: existing.token });
          return Response.json({ error: `${existing.username} is already logged in` }, { status: 409 });
        }
        const login: Login = { token: crypto.randomUUID(), username, since: Date.now(), graceUntil: Date.now() + GRACE_MS };
        this.logins[id] = login;
        await this.persist();
        await this.scheduleSweep();
        return Response.json({ raiderId: id, username, token: login.token });
      }
      case '/logout': {
        if (raiderId && this.logins[raiderId]?.token === token) await this.end(raiderId, 4000, 'logged out');
        return Response.json({ ok: true });
      }
      case '/end': {
        // Admin: end a raider's login regardless of token.
        if (raiderId) await this.end(raiderId, 4001, 'ended by admin');
        return Response.json({ ok: true });
      }
      case '/end-all': {
        // After a data import, raider ids may mean different people: end every login.
        for (const id of Object.keys(this.logins)) await this.end(Number(id), 4001, 'ended by admin');
        return Response.json({ ok: true });
      }
      case '/check': {
        const l = raiderId ? this.logins[raiderId] : undefined;
        return Response.json({ ok: !!l && l.token === token && this.isActive(l) });
      }
      case '/online':
        return Response.json(this.snapshot());
      case '/ws': {
        // Credentials decide, not the admin cookie: a loot officer who is also a raider has both,
        // and their raider tab must count as "connected" or the login would expire under them.
        const admin = request.headers.get('X-Admin') === '1';
        const l = raiderId ? this.logins[raiderId] : undefined;
        const validRaider = !!l && l.token === token && this.isActive(l);
        let att: Attachment = { raiderId: null };
        if (validRaider) {
          att = { raiderId };
          l.graceUntil = null; // connected
          await this.persist();
        } else if (!admin) {
          return new Response('not logged in', { status: 401 });
        }
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1]);
        pair[1].serializeAttachment(att);
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
    await this.ready;
    await this.detached(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.ready;
    await this.detached(ws);
  }

  /** A socket went away: if it was the raider's last one, start their grace period. */
  private async detached(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment;
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    if (att.raiderId == null) return;
    const stillConnected = this.ctx.getWebSockets().some((s) => s !== ws && (s.deserializeAttachment() as Attachment).raiderId === att.raiderId);
    const l = this.logins[att.raiderId];
    if (l && !stillConnected) {
      l.graceUntil = Date.now() + GRACE_MS;
      await this.persist();
      await this.scheduleSweep();
    }
  }

  /** Expire logins whose grace has passed. */
  async alarm() {
    await this.ready;
    const now = Date.now();
    let changed = false;
    for (const [id, l] of Object.entries(this.logins)) {
      if (l.graceUntil != null && l.graceUntil <= now) {
        delete this.logins[Number(id)];
        changed = true;
      }
    }
    if (changed) {
      await this.persist();
      this.broadcast();
    }
    await this.scheduleSweep();
  }

  // ---- helpers ----

  private isActive(l: Login) {
    return l.graceUntil == null || l.graceUntil > Date.now();
  }

  private async end(raiderId: number, code: number, reason: string) {
    delete this.logins[raiderId];
    await this.persist();
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment).raiderId === raiderId) {
        try {
          ws.close(code, reason);
        } catch {
          /* closed */
        }
      }
    }
    this.broadcast();
  }

  private snapshot() {
    const online: number[] = [];
    for (const [id, l] of Object.entries(this.logins)) if (this.isActive(l)) online.push(Number(id));
    return { online };
  }

  private broadcast() {
    const data = JSON.stringify({ type: 'presence', ...this.snapshot() });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        /* closed */
      }
    }
  }

  private async persist() {
    await this.ctx.storage.put('logins', this.logins);
  }

  private async scheduleSweep() {
    const next = Object.values(this.logins)
      .map((l) => l.graceUntil)
      .filter((g): g is number => g != null)
      .sort((a, b) => a - b)[0];
    if (next != null) await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
  }
}
