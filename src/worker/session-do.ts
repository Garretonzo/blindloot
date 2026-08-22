import { DurableObject } from 'cloudflare:workers';
import { Env } from './env';
import { canDibs, ClientMessage, ItemResult, LiveState, ServerMessage, Tier } from '../shared/types';
import { resolveItem, Participant } from '../shared/resolve';
import { getItemWithBoss, getPendingItemIds, getPlansForItem, getSessionRaiders, persistResult, setSessionStatus } from './db';

const DEFAULT_ITEM_SECONDS = 10;
const DEFAULT_RESULT_SECONDS = 3;
const clampSeconds = (v: unknown, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(600, Math.max(1, n)) : fallback;
};

interface Attachment {
  raiderId: number | null;
  admin: boolean;
}

const initialState = (): LiveState => ({
  phase: 'open',
  readyRaiderIds: [],
  itemIds: [],
  currentIndex: 0,
  deadline: null,
  paused: false,
  pausedRemainingMs: null,
  autoContinue: false,
  itemSeconds: DEFAULT_ITEM_SECONDS,
  resultSeconds: DEFAULT_RESULT_SECONDS,
  choices: {},
  choiceCount: 0,
  lastResult: null,
  shuffle: true,
  batchResults: null,
  revision: 0,
});

export class SessionDO extends DurableObject<Env> {
  private state!: LiveState;
  private sessionId!: number;
  private ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      // Merge over defaults so state persisted by older code gets new fields.
      this.state = { ...initialState(), ...((await ctx.storage.get<Partial<LiveState>>('state')) ?? {}) };
      this.sessionId = (await ctx.storage.get<number>('sessionId')) ?? 0;
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    const sessionId = Number(url.searchParams.get('sessionId'));
    if (sessionId && this.sessionId !== sessionId) {
      this.sessionId = sessionId;
      await this.ctx.storage.put('sessionId', sessionId);
    }

    if (url.pathname === '/ws') {
      const pair = new WebSocketPair();
      const attachment: Attachment = {
        raiderId: url.searchParams.get('raiderId') ? Number(url.searchParams.get('raiderId')) : null,
        admin: request.headers.get('X-Admin') === '1',
      };
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment(attachment);
      this.sendTo(pair[1], { type: 'state', state: this.viewFor(attachment) });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (url.pathname === '/notify') {
      // Data changed via REST; tell clients to refetch.
      await this.save({ revision: this.state.revision + 1 });
      return new Response('ok');
    }

    if (url.pathname === '/clear') {
      // Session deleted: drop live state, timers and connections.
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.state = initialState();
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(1000, 'session deleted');
        } catch {
          /* already closed */
        }
      }
      return new Response('ok');
    }

    if (url.pathname === '/state') {
      return Response.json(this.state);
    }

    if (url.pathname === '/current-item') {
      // Admin award guard: which item (if any) is mid-roll right now.
      const current = this.isRolling() ? this.state.itemIds[this.state.currentIndex] : null;
      return Response.json({ itemId: current });
    }

    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    await this.ready;
    const att = ws.deserializeAttachment() as Attachment;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }

    try {
      switch (msg.type) {
        case 'ready':
          if (att.raiderId != null && this.state.phase === 'ready') {
            const set = new Set(this.state.readyRaiderIds);
            set.add(att.raiderId);
            await this.save({ readyRaiderIds: [...set] });
            await this.maybeAutoStart();
          }
          break;
        case 'choose':
          if (att.raiderId != null && this.state.phase === 'item') {
            await this.choose(att.raiderId, msg.tier);
          }
          break;
        case 'stage':
          if (att.admin) await this.stage();
          break;
        case 'start':
          if (att.admin) await this.start();
          break;
        case 'next':
          if (att.admin && this.isRolling()) await this.step();
          break;
        case 'pause':
          if (att.admin) await this.pause();
          break;
        case 'resume':
          if (att.admin) await this.resume();
          break;
        case 'setAutoContinue':
          if (att.admin) await this.save({ autoContinue: !!msg.value });
          break;
        case 'setTimers':
          if (att.admin) {
            await this.save({
              itemSeconds: msg.itemSeconds != null ? clampSeconds(msg.itemSeconds, this.state.itemSeconds) : this.state.itemSeconds,
              resultSeconds: msg.resultSeconds != null ? clampSeconds(msg.resultSeconds, this.state.resultSeconds) : this.state.resultSeconds,
            });
          }
          break;
        case 'setShuffle':
          if (att.admin) await this.save({ shuffle: !!msg.value });
          break;
        case 'runBatch':
          if (att.admin) await this.runBatch();
          break;
        case 'close':
          if (att.admin) await this.close();
          break;
        case 'reopen':
          if (att.admin) await this.reopen();
          break;
        case 'reset':
          if (att.admin) await this.reset();
          break;
      }
    } catch (e) {
      this.sendTo(ws, { type: 'error', message: (e as Error).message });
    }
  }

  async webSocketClose(ws: WebSocket) {
    ws.close();
  }

  async webSocketError(ws: WebSocket) {
    ws.close();
  }

  async alarm() {
    await this.ready;
    if (this.state.paused) return; // stale alarm after pause
    await this.step();
  }

  // ---- transitions ----

  private isRolling() {
    return this.state.phase === 'item' || this.state.phase === 'results';
  }

  /** Move the roll-off forward one step: resolve the current item, or advance past results. */
  private async step() {
    if (this.state.phase === 'item') await this.resolveCurrent();
    else if (this.state.phase === 'results') await this.advance();
  }

  private async stage() {
    if (this.state.phase !== 'open') return;
    const pending = await getPendingItemIds(this.env.DB, this.sessionId);
    if (pending.length === 0) throw new Error('No unrolled items');
    await setSessionStatus(this.env.DB, this.sessionId, 'staging');
    await this.save({ phase: 'ready', readyRaiderIds: [], revision: this.state.revision + 1 });
  }

  private async maybeAutoStart() {
    const raiders = await getSessionRaiders(this.env.DB, this.sessionId);
    const ready = new Set(this.state.readyRaiderIds);
    if (raiders.length > 0 && raiders.every((r) => ready.has(r.id))) await this.start();
  }

  /** Unrolled items in roll order — list order, or a random permutation when shuffle is on. */
  private async orderedPending(): Promise<number[]> {
    const ids = await getPendingItemIds(this.env.DB, this.sessionId);
    if (!this.state.shuffle) return ids;
    const rnd = new Uint32Array(ids.length);
    crypto.getRandomValues(rnd);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = rnd[i] % (i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids;
  }

  private async start() {
    if (this.state.phase !== 'open' && this.state.phase !== 'ready') return;
    const itemIds = await this.orderedPending();
    if (itemIds.length === 0) throw new Error('No items to roll on');
    await setSessionStatus(this.env.DB, this.sessionId, 'rolling');
    const choices = await this.prefilledChoices(itemIds[0]);
    await this.save({
      phase: 'item',
      itemIds,
      currentIndex: 0,
      choices,
      choiceCount: Object.keys(choices).length,
      lastResult: null,
      batchResults: null,
      revision: this.state.revision + 1,
      // First item waits for the admin to press "Start countdown".
      ...(await this.pausedTimer(this.itemMs())),
    });
  }

  /**
   * Instant batch: resolve every unrolled item right now from raiders' pre-picks, in order,
   * with Need/Dibs demotion applied between items exactly as in a live roll-off.
   */
  private async runBatch() {
    if (this.state.phase !== 'open') throw new Error('Finish or reset the live roll-off first');
    const itemIds = await this.orderedPending();
    if (itemIds.length === 0) throw new Error('No unrolled items');
    const results: ItemResult[] = [];
    for (const itemId of itemIds) {
      const choices = await this.prefilledChoices(itemId); // re-read each time: earlier wins change eligibility
      results.push(await this.resolveOne(itemId, choices));
    }
    await this.save({ batchResults: results, lastResult: null, revision: this.state.revision + 1 });
  }

  private itemMs() {
    return this.state.itemSeconds * 1000;
  }
  private resultMs() {
    return this.state.resultSeconds * 1000;
  }

  /**
   * Raiders' pre-planned choices for an item, demoted to what they can still afford:
   * Dibs -> Need if their Dibs is spent, Need -> Equip if their need is spent.
   */
  private async prefilledChoices(itemId: number): Promise<Record<number, Tier>> {
    const [plans, raiders] = await Promise.all([getPlansForItem(this.env.DB, itemId), getSessionRaiders(this.env.DB, this.sessionId)]);
    const out: Record<number, Tier> = {};
    for (const [idStr, tier] of Object.entries(plans)) {
      const r = raiders.find((x) => x.id === Number(idStr));
      if (!r) continue;
      let t = tier;
      if (t === 'dibs' && !canDibs(r)) t = 'need';
      if (t === 'need' && !r.need_available) t = 'equip';
      out[r.id] = t;
    }
    return out;
  }

  private async choose(raiderId: number, tier: Tier | null) {
    if (tier) {
      const raiders = await getSessionRaiders(this.env.DB, this.sessionId);
      const me = raiders.find((r) => r.id === raiderId);
      if (!me) throw new Error('You are not in this session');
      if (tier === 'need' && !me.need_available) throw new Error('Need roll already used');
      if (tier === 'dibs' && !canDibs(me)) throw new Error(me.dibs_locked ? 'Dibs is locked this session (you won with Need)' : 'Your Dibs is already used this season');
    }
    const choices = { ...this.state.choices };
    if (tier) choices[raiderId] = tier;
    else delete choices[raiderId];
    await this.save({ choices, choiceCount: Object.keys(choices).length });
  }

  private async resolveCurrent() {
    const lastResult = await this.resolveOne(this.state.itemIds[this.state.currentIndex], this.state.choices);
    await this.save({
      phase: 'results',
      lastResult,
      choices: {},
      choiceCount: 0,
      revision: this.state.revision + 1,
      ...(await this.armTimer(this.resultMs())),
    });
  }

  /** Roll one item for the given choices, persist the outcome, and describe it. */
  private async resolveOne(itemId: number, choices: Record<number, Tier>): Promise<ItemResult> {
    const item = await getItemWithBoss(this.env.DB, itemId);
    const raiders = await getSessionRaiders(this.env.DB, this.sessionId);

    const participants: Participant[] = [];
    for (const [idStr, tier] of Object.entries(choices)) {
      const r = raiders.find((x) => x.id === Number(idStr));
      if (!r) continue;
      // Re-validate eligibility at resolution time.
      let t = tier;
      if (t === 'dibs' && !canDibs(r)) t = 'need';
      if (t === 'need' && !r.need_available) t = 'equip';
      participants.push({ id: r.id, username: r.username, itemLevel: r.item_level, tier: t });
    }

    const res = resolveItem(participants);
    await persistResult(this.env.DB, this.sessionId, {
      itemId,
      winnerId: res.winnerId,
      winTier: res.winTier,
      entries: res.entries.map((e) => ({ raiderId: e.raiderId, tier: e.tier!, roll: e.roll, won: e.won })),
    });

    return {
      itemId,
      itemName: item?.name ?? '?',
      bossName: item?.boss_name ?? '?',
      winnerId: res.winnerId,
      winnerName: res.winnerId != null ? raiders.find((r) => r.id === res.winnerId)?.username ?? null : null,
      winTier: res.winTier,
      entries: res.entries,
    };
  }

  private async advance() {
    const next = this.state.currentIndex + 1;
    if (next >= this.state.itemIds.length) {
      // Roll-off finished. Back to open so more loot can be added on another day.
      await this.ctx.storage.deleteAlarm();
      await setSessionStatus(this.env.DB, this.sessionId, 'open');
      await this.save({
        phase: 'open',
        itemIds: [],
        currentIndex: 0,
        deadline: null,
        paused: false,
        pausedRemainingMs: null,
        readyRaiderIds: [],
        revision: this.state.revision + 1,
      });
      return;
    }
    const timer = this.state.autoContinue
      ? await this.armTimer(this.itemMs())
      : await this.pausedTimer(this.itemMs()); // wait for admin to resume
    const choices = await this.prefilledChoices(this.state.itemIds[next]);
    await this.save({ phase: 'item', currentIndex: next, choices, choiceCount: Object.keys(choices).length, ...timer });
  }

  private async pause() {
    if (!this.isRolling() || this.state.paused || this.state.deadline == null) return;
    await this.save(await this.pausedTimer(Math.max(0, this.state.deadline - Date.now())));
  }

  private async resume() {
    if (!this.isRolling() || !this.state.paused) return;
    await this.save(await this.armTimer(this.state.pausedRemainingMs ?? this.itemMs()));
  }

  private async close() {
    if (this.state.phase !== 'open') throw new Error('Finish or reset the roll-off first');
    await setSessionStatus(this.env.DB, this.sessionId, 'closed');
    await this.save({ phase: 'closed', revision: this.state.revision + 1 });
  }

  private async reopen() {
    if (this.state.phase !== 'closed') return;
    await setSessionStatus(this.env.DB, this.sessionId, 'open');
    await this.save({ phase: 'open', revision: this.state.revision + 1 });
  }

  private async reset() {
    await this.ctx.storage.deleteAlarm();
    await setSessionStatus(this.env.DB, this.sessionId, 'open');
    await this.save({
      ...initialState(),
      autoContinue: this.state.autoContinue,
      itemSeconds: this.state.itemSeconds,
      resultSeconds: this.state.resultSeconds,
      shuffle: this.state.shuffle,
      batchResults: this.state.batchResults,
      revision: this.state.revision + 1,
    });
  }

  // ---- helpers ----

  /** Running countdown: schedule the alarm and return the timer fields. */
  private async armTimer(ms: number): Promise<Partial<LiveState>> {
    await this.ctx.storage.setAlarm(Date.now() + ms);
    return { deadline: Date.now() + ms, paused: false, pausedRemainingMs: null };
  }

  /** Frozen countdown: cancel the alarm and return the timer fields. */
  private async pausedTimer(remainingMs: number): Promise<Partial<LiveState>> {
    await this.ctx.storage.deleteAlarm();
    return { deadline: null, paused: true, pausedRemainingMs: remainingMs };
  }

  private async save(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch };
    await this.ctx.storage.put('state', this.state);
    this.broadcastState();
  }

  /**
   * What a given connection is allowed to see. Admins get everything; raiders only
   * their own live choice and results without tiers ("who won", not "how").
   */
  private viewFor(att: Attachment): LiveState {
    if (att.admin) return this.state;
    const s = this.state;
    const own: Record<number, Tier> = {};
    if (att.raiderId != null && s.choices[att.raiderId]) own[att.raiderId] = s.choices[att.raiderId];
    const blind = (r: ItemResult): ItemResult => ({
      ...r,
      winTier: null,
      entries: r.entries.map(({ tier: _tier, itemLevel: _ilvl, ...rest }) => ({ ...rest, itemLevel: 0 })),
    });
    return {
      ...s,
      choices: own,
      lastResult: s.lastResult ? blind(s.lastResult) : null,
      batchResults: s.batchResults ? s.batchResults.map(blind) : null,
    };
  }

  private broadcastState() {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment;
      this.sendTo(ws, { type: 'state', state: this.viewFor(att) });
    }
  }

  private sendTo(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closed */
    }
  }
}
