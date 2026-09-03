import { RollEntry, SessionDetail, SummaryItem } from '../shared/types';

/** The session's loot story — every resolved item in resolution order — derived from detail + roll history. */
export function summarize(detail: SessionDetail, rolls: Record<number, RollEntry[]>): SummaryItem[] {
  const username = new Map(detail.raiders.map((r) => [r.id, r.username]));
  return detail.bosses
    .flatMap((boss) => boss.items.filter((i) => i.resolved_at != null).map((item) => ({ item, boss })))
    .sort((a, b) => a.item.resolved_at! - b.item.resolved_at! || a.item.id - b.item.id)
    .map(({ item, boss }, idx) => {
      const entries = rolls[item.id] ?? [];
      const winnerId = item.winner_raider_id;
      return {
        itemId: item.id,
        name: item.name,
        icon: item.icon,
        bossName: boss.name,
        bossIcon: boss.icon,
        order: idx + 1,
        mode: item.resolved_mode,
        winnerId,
        // A winner who has since left the session is still named by their roll, if they rolled.
        winnerName: winnerId == null ? null : (username.get(winnerId) ?? entries.find((e) => e.raiderId === winnerId)?.username ?? '?'),
        winTier: item.win_tier,
        entries,
      };
    });
}
