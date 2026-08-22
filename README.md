# Blind Loot

Blind loot distributor for guild raids: everyone rolls without seeing anyone else's choice, and
results show who won but never how — so there's nothing to game and nothing to argue about.
Minimal WoW raid loot distribution app. React + Mantine front end, Cloudflare Worker back end
(Hono), D1 (SQLite) for persistence, a Durable Object per session for live state, WebSockets
and countdown timers.

## Loot rules

Tiers, lowest to highest: **Transmog** → **Equip** → **Need** → **Dibs**.

- Transmog and Equip are unlimited.
- Need: one per raider per session; consumed only when you *win* with it.
- Dibs: one per raider per **season**; consumed only when you win with it.
  Two Dibs → higher item level wins; tie → 1-100 roll.
- Winning with Need locks your Dibs for the rest of that session; winning with Dibs uses up your
  Need for that session. One "big" win per session.
- Same tier → 1-100 roll, highest wins.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars      # set ADMIN_PASSWORD, SUPER_ADMIN_PASSWORD, SITE_PASSWORD
npm run db:migrate:local
npm run dev                         # http://localhost:8787
```

`npm test` runs the loot-resolution unit tests. To start the local database over from scratch:
`rm -rf .wrangler/state && npm run db:migrate:local`.

### Data model (`migrations/0001_init.sql`)

- **seasons → sessions → bosses → items.** A season names its bundled boss/loot pool (`raid_id`).
  A session's status is `open`, `staging`, `rolling` or `closed`; an item records its winner, the
  tier it was won with and when it was resolved.
- **raiders** is the site-wide roster (username is the identity, case-insensitive).
- **season_raiders** holds the one thing that spans a season: whether the raider still has Dibs.
- **session_raiders** holds per-session state: item level, Need still available, and the Dibs
  lock (set by a Need win).
- **rolls** stores every participant's roll on every item (losers too) so runner-ups can be ranked
  and items re-awarded. **plans** stores raiders' pre-planned choices for unrolled items.

### Static raid data

Bosses, loot pools and icons live in `src/shared/raids/venomous-abyss.json` and
`src/client/public/icons/`. They were generated once by `npm run data:fetch`
(`scripts/fetch-loot-data.mjs`, which reads Wowhead item tooltips and warcraft.wiki boss icons).
The running app never contacts those sites — only re-run the script to refresh the data.
Each pool is one WoW season; to add another, generate its JSON/icons with the script and list it
in `src/shared/raids/index.ts` (`RAIDS`) — it then appears in the "New season" dropdown.

## Deploy to Cloudflare

```sh
npx wrangler login
npx wrangler d1 create loot          # paste database_id into wrangler.toml
npm run db:migrate
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SUPER_ADMIN_PASSWORD   # optional; enables deleting seasons/sessions
npx wrangler secret put SITE_PASSWORD          # what raiders enter before picking their name
npm run deploy
```

`SITE_PASSWORD` gates the whole raider-facing site (and its API): visitors enter it once per
browser, before the name picker. Admins bypass it with their own login. Leave it unset to run
without a gate.

Both passwords are entered on the same `/admin` login form. There is no link to it from the
raider-facing pages — admins go to `/admin` directly. A normal admin can create and edit
everything; only the super admin can delete seasons and sessions (with all their history).

Then in the Cloudflare dashboard: Workers & Pages → `loot` → Settings → Domains & Routes →
add your custom domain.

## Flow

1. Admin (`/admin`) creates a Season — a name plus the **boss/loot pool** it uses (currently only
   *Midnight Season 2 — The Venomous Abyss*) — then a Session inside it. Both can be renamed; the
   pool is fixed.
2. Raiders **log in by picking their name** from the roster the admin prepared. A name that is
   already logged in elsewhere is greyed out. Logins are tracked live (a `PresenceDO` Durable
   Object): closing the tab frees the name after ~30 s, "(log out)" in the header frees it at once,
   and an admin can **End login** from the roster, which bounces that raider back to the picker.
   Opening a session asks only for their current item level. Everyone starts a season with their
   Dibs; Dibs/Need state is stored per season and per session on the server.
3. After each boss, admin picks the boss from the dropdown and the dropped items from its loot
   pool (Midnight Season 2 — The Venomous Abyss, incl. Nymrissa Wavecaller; custom names still
   allowed). Boss and item icons are bundled with the app.
4. Raiders are **site-wide**: the admin home has a roster (add / rename / super-admin delete).
   Inside a session the admin picks raiders from that roster (dropdown) and sets their item level
   for *this* session; ilvl is per session, Dibs per season. When a raider later opens the site
   and types the same name (case doesn't matter) they get that record, history and Dibs included.
5. Admin clicks **Stage rolling** → raiders get a ready check; once everyone is ready (or admin
   forces **Start now**) the first item is shown **paused**.
6. Admin presses **Start countdown**: 15 s to pick a tier, then 5 s of results, then the next item
   (both durations are adjustable in the Controls card; they apply to the next countdown).
   - **Pause / Resume** freezes and continues either countdown (roll or result) at any point.
   - **Skip** ends the current countdown immediately.
   - **Auto-continue** is off by default: after each result the next item waits for
     **Start next item**. Tick it to run through all items automatically.
7. When every pending item is rolled the session goes back to *open*: add more bosses/items
   (e.g. the next raid night) and stage another roll-off — only unrolled items are included.
8. **Close session** when the raid is fully done (no more joins/edits); **Reopen** if needed.

Also:
- `/help` ("How it works", linked from the header and the name picker) explains the roll types,
  the Need/Dibs rule, the raid-night flow and a short FAQ for raiders.
- Raiders can **pre-plan** a roll on any upcoming item from the loot list; it pre-fills their
  choice when the item comes up (they can still change it during the countdown). A planned Need
  or Dibs is demoted one tier automatically if they've already won with it.
- Raiders see each other's item level and **who** won an item, never the tier it was won with or
  anyone else's Need / Dibs state; the admin sees everything.
- Every participant rolls, so the admin can open **details** on a resolved item to see the top 3
  per tier, change **how** the winner got it (Transmog / Equip / Need / Dibs), **Give** the item
  to a runner-up or anyone else (choosing the tier), or remove the winner. After any such edit the
  affected raiders' Need / Dibs state is recomputed from the items they have actually won, so a
  Need/Dibs assignment locks them exactly like a rolled win and a removal gives it back. A
  runner-up who has *since* won with Need/Dibs is shown demoted (e.g. Need → Equip) and is given
  the item at that demoted tier; the admin can deliberately override with a confirmation.
9. Season history (`/admin/seasons/:id/history`) shows every item, winner and roll.
