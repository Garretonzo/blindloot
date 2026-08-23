import { RaidData, RaidItem } from '../types';
import venomousAbyss from './venomous-abyss.json';

/**
 * All bundled boss/loot pools, one per WoW season. Each season created in the app picks one.
 * To add a pool: generate its JSON + icons with scripts/fetch-loot-data.mjs and list it here.
 */
export const RAIDS: RaidData[] = [venomousAbyss as RaidData];

export function raidById(id: string): RaidData | null {
  return RAIDS.find((r) => r.id === id) ?? null;
}

/** Dropdown label, e.g. "Midnight Season 2 — The Venomous Abyss". */
export const raidLabel = (r: RaidData) => `${r.season} — ${r.name}`;

export function findBoss(raidId: string, name: string) {
  return raidById(raidId)?.bosses.find((x) => x.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
}

/** Loot pool for a boss name within a raid; empty for custom/unknown bosses. */
export function lootFor(raidId: string, bossName: string): RaidItem[] {
  return findBoss(raidId, bossName)?.items ?? [];
}

/** Static item data (tooltip, quality, link) by name within a raid; null for custom items. */
export function findItem(raidId: string | undefined, name: string): RaidItem | null {
  if (!raidId) return null;
  const n = name.trim().toLowerCase();
  for (const b of raidById(raidId)?.bosses ?? []) {
    const it = b.items.find((i) => i.name.toLowerCase() === n);
    if (it) return it;
  }
  return null;
}
