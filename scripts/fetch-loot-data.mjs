/**
 * ONE-TIME data builder. Fetches item names/icons from Wowhead's public XML tooltips and
 * boss icons from warcraft.wiki, then writes a static JSON + icon files into the repo.
 * The app itself never calls these services — it only ships the generated output.
 *
 *   node scripts/fetch-loot-data.mjs
 *
 * Sources used for the seed item IDs (Midnight Season 2, patch 12.1):
 *   https://expcarry.com/wow-venomous-abyss-loot-table
 *   https://conquestcapped.com/guides/wow/tidebound-grotto-lair/
 *   https://warcraft.wiki.gg/wiki/Venomous_Abyss
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ITEM_ICON_DIR = path.join(ROOT, 'src/client/public/icons/items');
const BOSS_ICON_DIR = path.join(ROOT, 'src/client/public/icons/bosses');
const OUT_JSON = path.join(ROOT, 'src/shared/raids/venomous-abyss.json');

const RAID = {
  id: 'venomous-abyss',
  name: 'The Venomous Abyss',
  season: 'Midnight Season 2',
  bosses: [
    {
      slug: 'nekzali',
      name: "Nek'zali the Soulcoiler",
      wikiIcon: 'IconSmall_ForestTroll2_Female.gif',
      items: [268236, 268218, 268235, 268240, 268231, 268216, 268229, 268245, 268248, 268208, 268203, 270930, 270162],
    },
    {
      slug: 'entombed-sentinels',
      name: 'Entombed Sentinels',
      wikiIcon: 'IconSmall_SnakeGolemGreen.gif',
      items: [268228, 268219, 268224, 268230, 268204, 268198, 268197, 268250, 270165, 270910, 270911, 270912, 270913],
    },
    {
      slug: 'vashnik',
      name: 'Vashnik the Malignant',
      wikiIcon: 'IconSmall_Vashnik.gif',
      items: [268246, 268254, 268260, 268205, 268214, 268249, 270166, 270161, 270926, 270927, 270928, 270929],
    },
    {
      slug: 'lost-explorers',
      name: 'The Lost Explorers',
      wikiIcon: 'IconSmall_HexTortollan.gif',
      items: [268242, 268227, 268258, 268239, 268210, 268200, 268196, 270160, 270164, 270922, 270923, 270924, 270925],
    },
    {
      slug: 'sszorak',
      name: 'Sszorak',
      wikiIcon: 'IconSmall_Sszorak.gif',
      items: [268257, 268234, 268233, 268201, 268206, 268252, 270163, 270174, 270918, 270919, 270920, 270921],
    },
    {
      slug: 'twin-fangs',
      name: 'The Twin Fangs',
      wikiIcon: 'IconSmall_TwinFang.gif',
      items: [268241, 268261, 268223, 268220, 268264, 268251, 270171, 270170, 270914, 270915, 270916, 270917],
    },
    {
      slug: 'coiled-altar',
      name: 'The Coiled Altar',
      wikiIcon: ['IconSmall_CoiledAltar.gif', 'IconSmall_HexLord.gif', 'IconSmall_ForestTroll_Male.gif'],
      items: [268243, 268255, 268256, 268225, 268237, 268222, 268259, 268253, 268211, 268209, 268213, 270169, 270173],
    },
    {
      slug: 'ulatek',
      name: "Ula'tek",
      wikiIcon: "IconSmall_Ula'tek.gif",
      items: [271874, 271875, 271876, 271878, 268202, 268215, 268207, 271093, 271092, 268265, 270168, 270175, 270909, 275658],
    },
    {
      slug: 'nymrissa',
      name: 'Nymrissa Wavecaller',
      wikiIcon: 'IconSmall_Naga3.gif',
      items: [268221, 268232, 268225, 268247, 268217, 268238, 268226, 268244, 268199, 268262, 268263, 268266, 270167, 279112],
    },
  ],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'user-agent': 'loot-app-data-builder/1.0 (one-time static asset fetch)' };

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchItem(id) {
  const res = await fetch(`https://www.wowhead.com/item=${id}&xml`, { headers: UA });
  const xml = await res.text();
  const pick = (tag) => xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([^<\\]]*)`))?.[1]?.trim() ?? '';
  const name = pick('name');
  const icon = pick('icon');
  const slot = pick('inventorySlot');
  const cls = pick('class');
  const sub = pick('subclass');
  if (!name || !icon) throw new Error(`item ${id}: could not parse (${xml.slice(0, 120)})`);
  let type = sub && sub !== cls ? sub : cls;
  // Tier-set tokens are classed as "Junk" by the game; label them usefully.
  if (type === 'Junk' && /^Venom(woven|cured|cast|forged) /.test(name)) type = 'Tier token';
  if (type === 'Junk' && name === 'Slumbering Coil Curio') type = 'Tier token (any slot)';
  const quality = Number(xml.match(/<quality id="(\d+)"/)?.[1] ?? 0);
  const html = xml.match(/<htmlTooltip>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/htmlTooltip>/)?.[1] ?? '';
  return { id, name, icon, slot, type, quality, tooltip: tooltipLines(html, name) };
}

/** Turn Wowhead's tooltip HTML into plain text lines (what the in-game tooltip shows). */
function tooltipLines(html, name) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(div|tr|li|p|h\d|td|th|table)\b[^>]*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  return text
    // Wowhead glues some inline spans together ("Binds when picked upTwo-Hand"); split them.
    .replace(/(picked up|when equipped|Unique-Equipped|Unique)(?=[A-Z])/g, '$1\n')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && l !== name && !/^Sell Price/i.test(l) && !/^Dropped by/i.test(l));
}

async function download(url, dest) {
  if (await exists(dest)) return true;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) return false;
  await writeFile(dest, buf);
  return true;
}

await mkdir(ITEM_ICON_DIR, { recursive: true });
await mkdir(BOSS_ICON_DIR, { recursive: true });
await mkdir(path.dirname(OUT_JSON), { recursive: true });

const itemCache = new Map();
const out = { id: RAID.id, name: RAID.name, season: RAID.season, bosses: [] };

for (const boss of RAID.bosses) {
  const candidates = Array.isArray(boss.wikiIcon) ? boss.wikiIcon : [boss.wikiIcon];
  let bossIcon = null;
  for (const file of candidates) {
    const dest = path.join(BOSS_ICON_DIR, `${boss.slug}.gif`);
    const ok = await download(`https://warcraft.wiki.gg/wiki/Special:FilePath/${encodeURIComponent(file)}`, dest);
    if (ok) {
      bossIcon = `/icons/bosses/${boss.slug}.gif`;
      break;
    }
  }
  if (!bossIcon) console.warn(`! no boss icon for ${boss.name}`);

  const items = [];
  for (const id of boss.items) {
    let item = itemCache.get(id);
    if (!item) {
      item = await fetchItem(id);
      itemCache.set(id, item);
      await sleep(250); // be polite
    }
    const dest = path.join(ITEM_ICON_DIR, `${item.icon}.jpg`);
    const ok = await download(`https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg`, dest);
    if (!ok) console.warn(`! no icon for ${item.name} (${item.icon})`);
    items.push({
      id,
      name: item.name,
      icon: ok ? `/icons/items/${item.icon}.jpg` : null,
      slot: item.slot || null,
      type: item.type || null,
      quality: item.quality,
      tooltip: item.tooltip,
      url: `https://www.wowhead.com/item=${id}`,
    });
    process.stdout.write(`${boss.name} :: ${item.name} (${item.tooltip.length} tooltip lines)\n`);
  }
  out.bosses.push({
    slug: boss.slug,
    name: boss.name,
    icon: bossIcon,
    url: `https://www.wowhead.com/search?q=${encodeURIComponent(boss.name)}#npcs`,
    items,
  });
}

await writeFile(OUT_JSON, JSON.stringify(out, null, 2) + '\n');
console.log(`\nWrote ${OUT_JSON}: ${out.bosses.length} bosses, ${out.bosses.reduce((n, b) => n + b.items.length, 0)} items`);
