import { Raider, SessionDetail } from '../shared/types';

/**
 * The raider-facing view of a session. ALWAYS applied on the public endpoint — even for admins
 * (the admin page has its own). Raiders see who won (not how) and everyone's item level, but
 * only their own Need / Dibs state — and on items they won themselves, the winning tier plus
 * their own pre-pick. Others' charge state is omitted entirely, not zeroed — it never leaves
 * the server.
 */
export function sanitizeDetail(detail: SessionDetail, meId: number | null): SessionDetail {
  return {
    ...detail,
    bosses: detail.bosses.map((b) => ({
      ...b,
      items: b.items.map(({ winner_picked_tier, ...i }) => {
        const mine = meId != null && i.winner_raider_id === meId;
        return { ...i, win_tier: mine ? i.win_tier : null, my_picked_tier: mine ? winner_picked_tier ?? null : null };
      }),
    })),
    raiders: detail.raiders.map((r) => {
      if (r.id === meId) return r;
      const { dibs_remaining: _d, need_remaining: _n, ...rest } = r;
      return rest as Raider;
    }),
  };
}
