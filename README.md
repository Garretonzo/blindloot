# Just Fucking Roll

**Blind loot. Zero drama. Just fucking roll.** — justfuckingroll.com

Loot distributor for guild raids: everyone rolls without seeing anyone else's choice, and results
show who won but never how — so there's nothing to game and nothing to argue about. Minimal WoW
raid loot distribution app. React + Mantine front end, Cloudflare Worker back end
(Hono), D1 (SQLite) for persistence, a Durable Object per session for live state, WebSockets
and countdown timers.

## Loot rules

Tiers, lowest to highest: **Transmog** → **Off-spec** → **Equip** → **Need** → **Dibs**.
**Pass** is an explicit "not rolling" — recorded so the officer can see it, never wins.

- Transmog, Off-spec and Equip are unlimited.
- Need: a configurable number of wins per raider per session (default 1, set on the season);
  a charge is consumed only when you *win* with it.
- Dibs: a configurable number of charges per raider per **season** (default 1). A Dibs roll also
  requires an available Need charge; winning with Dibs spends one Dibs charge *and* one Need
  charge. Two Dibs → higher item level wins; tie → 1-100 roll.
- Out of Need charges → Need (and therefore Dibs) is locked until next session. With the default
  limits that means one "big" win per session, exactly like the old fixed rule.
- Same tier → 1-100 roll, highest wins. From every tier, when several rollers are tied at the top
  tier, only those tied for the **fewest wins at that tier** (Dibs counted season-wide, the rest
  per session) are eligible — loot spreads out instead of clumping on one lucky roller.
- Items are rolled in a priority order: items whose top pre-pick tier is highest go first, and
  within a group the item with the fewest top-tier planners goes first (so a solo Dibs is
  guaranteed before that raider's Dibs gets spent elsewhere); ties are random, and the order is
  recomputed after every item. Raiders never see the order — the loot list stays in the order the
  admin added it; the admin summary records the actual roll order.

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
- **season_raiders** holds the one thing that spans a season: the raider's remaining Dibs charges.
- **session_raiders** holds per-session state: item level and remaining Need charges. The
  per-raider allowances (`dibs_per_season`, `need_per_session`) live on **seasons** and are
  admin-editable; remaining charges are re-derived (limit − wins) on wins, re-awards and limit
  changes.
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
npx wrangler d1 create justfuckingroll     # paste database_id into wrangler.toml (first time only)
npm run db:migrate                   # apply migrations to the remote DB
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SUPER_ADMIN_PASSWORD   # optional; enables deleting seasons/sessions
npx wrangler secret put SITE_PASSWORD          # what raiders enter before picking their name
npm run deploy                       # builds the client and publishes worker + assets + DOs
```

The worker is `justfuckingroll`; it uses SQLite-backed Durable Objects, which work on the free plan.
After the first deploy it is reachable at `https://justfuckingroll.<your-subdomain>.workers.dev`.

`SITE_PASSWORD` gates the whole raider-facing site (and its API): visitors enter it once per
browser, before the name picker. Admins bypass it with their own login. Leave it unset to run
without a gate.

Both passwords are entered on the same `/admin` login form. There is no link to it from the
raider-facing pages — admins go to `/admin` directly. A normal admin can create and edit
everything; only the super admin can delete seasons and sessions (with all their history).

Custom domain: buy one under **Domain Registration → Register Domains** (or use a subdomain of a
domain already on the account), then **Workers & Pages → justfuckingroll → Settings → Domains & Routes →
Add → Custom domain**. Cloudflare creates the DNS record and certificate. Optionally disable the
`workers.dev` route there so the domain is the only entrance.

## Flow

1. Admin (`/admin`) creates a Season — a name plus the **boss/loot pool** it uses (currently only
   *Midnight Season 2 — The Venomous Abyss*) — then a Session inside it. Both can be renamed; the
   pool is fixed.
2. Raiders **log in by picking their name** from the roster the admin prepared. Raiders are
   created without a password: the **first login prompts them to set one** (password + confirm,
   min 4 chars; PBKDF2-hashed in D1), and every later login requires it. An admin can **Reset
   password** from the roster (back to passwordless, for lockouts) — it doesn't end an active
   login. A name that is already logged in elsewhere is greyed out. Logins are tracked live (a
   `PresenceDO` Durable Object): closing the tab frees the name after ~30 s, "(log out)" in the
   header frees it at once, and an admin can **End login** from the roster, which bounces that
   raider back to the picker.
   Opening a session asks only for their current item level. Everyone starts a season with full
   Dibs charges; Dibs/Need charges are stored per season and per session on the server.
3. After each boss, admin picks the boss from the dropdown and the dropped items from its loot
   pool (Midnight Season 2 — The Venomous Abyss, incl. Nymrissa Wavecaller; custom names still
   allowed). Boss and item icons are bundled with the app.
4. Raiders are **site-wide**: the admin home has a roster (add / rename / super-admin delete).
   Inside a session the admin picks raiders from that roster (dropdown) and sets their item level
   for *this* session; ilvl is per session, Dibs per season. When a raider later opens the site
   and types the same name (case doesn't matter) they get that record, history and Dibs included.
5. Raiders pre-pick their roll on each item as loot is added — this is the primary way of rolling.
   When loot is done the admin clicks **Run instant batch** and every item is resolved from the
   pre-picks at once, in the priority order described above. Results are shown to everyone.
6. Alternative, live mode: admin clicks **Stage rolling** → ready check → the first item is shown
   **paused**; **Start countdown** gives 15 s to pick a tier (pre-picks pre-fill), then 5 s of
   results, then the next item (durations adjustable in the Controls card).
   - **Pause / Resume** freezes and continues either countdown (roll or result) at any point.
   - **Skip** ends the current countdown immediately.
   - **Auto-continue** is off by default: after each result the next item waits for
     **Start next item**. Tick it to run through all items automatically.
7. When every pending item is rolled the session goes back to *open*: add more bosses/items
   (e.g. the next raid night) and stage another roll-off — only unrolled items are included.
8. **Close session** when the raid is fully done (no more joins/edits); **Reopen** if needed.
9. **Randomize item order** (on by default) in the Controls card applies to both batch and live
   modes: on = the priority order with random tie-breaks, off = plain list order. Batch results
   show raiders who won; the admin also sees tiers and every roll.

Also:
- `/help` ("How it works", linked from the header and the name picker) explains the roll types,
  the Need/Dibs rule, the raid-night flow and a short FAQ for raiders.
- Raiders can **pre-plan** a roll on any upcoming item from the loot list; it pre-fills their
  choice when the item comes up (they can still change it during the countdown). A planned Need
  or Dibs is demoted one tier automatically once they're out of the charges it needs.
- Raiders see each other's item level and **who** won an item, never the tier it was won with or
  anyone else's Need / Dibs state; the admin sees everything.
- The admin session page has a collapsed **Summary** card: every resolved item in the order it
  was rolled, how it was resolved (batch / live / awarded), the winner, a one-line explanation
  ("Dibs · ilvl tie (620) — rolled 87 vs Bob 43"), and every participant's pre-pick → what it
  counted as, roll and ilvl.
- Every participant rolls, so the admin can open **details** on a resolved item to see the top 3
  per tier, change **how** the winner got it (Transmog / Equip / Need / Dibs), **Give** the item
  to a runner-up or anyone else (choosing the tier), or remove the winner. After any such edit the
  affected raiders' Need / Dibs state is recomputed from the items they have actually won, so a
  Need/Dibs assignment locks them exactly like a rolled win and a removal gives it back. A
  runner-up who has *since* won with Need/Dibs is shown demoted (e.g. Need → Equip) and is given
  the item at that demoted tier; the admin can deliberately override with a confirmation.
9. Season history (`/admin/seasons/:id/history`) shows every item, winner and roll.
