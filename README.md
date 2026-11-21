# Ontario U21 Rankings

Computer rankings for OMHA U21 rep teams. Rating = AGD (average goal differential, capped at 7 per game) + SCHED (average opponent rating), solved simultaneously across every game, with a blowout rule and a minimum-games threshold. Leagues are cross-ranked through tournament games; a league with no games against the others is ranked on its own until it gets one. Moneyline odds come from the rating gap.

## Run locally

```
npm install
npm start                             -> http://localhost:4700  (admin password "admin" locally)
```

- `npm test` runs the rating and parser tests.
- Data lives in `data/db.json` (not in git). Admin > Settings has backup download and restore.
- `npm run demo` writes fictional demo data. It refuses to overwrite real data unless you add `--force`.

## Public site (free, GitHub Pages)

Live at https://mitchelltomaino1-gif.github.io/omha-u21-rankings/

The public site is a static, read-only copy: rankings, team pages, predictor and How It Works, with the data baked in as JSON. Admin, the data file and the bookmarklet stay on your computer.

To update it: import results locally as usual, then press **Publish to public site** in Admin (or run `npm run publish`). That builds the pages into `.publish/` (a git worktree on the `gh-pages` branch) and pushes it. GitHub Pages updates within a minute or two.

## Alternative: full live server (Render, paid)

If you ever want the admin online too:

1. Push this repo to GitHub.
2. In Render: **New > Blueprint**, pick the repo. `render.yaml` sets up a Node web service with a 1 GB persistent disk at `/data`.
3. When asked, enter `ADMIN_PASSWORD` (8+ characters). The server refuses to start in production without one.
4. Once it's live, open `/admin` on the live site, log in, go to **Settings > Restore from file**, and upload a backup downloaded from your local site (Admin > Settings > Download backup).
5. Re-drag the **Send to Rankings** bookmark from the live site's Admin > Import page. The old one points at localhost.

Environment variables:

| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Admin login (required in production) |
| `DATA_FILE` | Where data is stored, e.g. `/data/db.json` on the persistent disk |
| `NODE_ENV` | `production` turns on the password check |
| `SESSION_SECRET` | Optional. Change it to log every admin out |
| `PORT` | Set by the host automatically |

Any Node host with a persistent disk works (Railway volume, Fly.io volume, a VPS). Hosts without persistent storage will lose the data on every restart.

## Entering results

**One-click import (recommended):** Admin > Import has a "Send to Rankings" button. Drag it to the bookmarks bar, open a league's Schedule & Results page (e.g. https://beechey.ca/Schedule/), and click it. It runs in your own browser, reads every month of the current season, keeps only U21 rep divisions (local league and house league are skipped), and sends the games to the admin import preview. Nothing is saved until you press Import. Code: `public/bookmarklet.src.js`. Scores on these sites are shown visitor-home (verified against Beechey standings).

OMHA league sites block server requests with Cloudflare, so there is no server-side scraper. The bookmarklet works because it runs in a normal browser session.

Other ways in: paste a results table, upload CSV (`date,home,home_score,away,away_score,shootout,type,division`), or add games by hand. Tournament games (type `tournament`) are what link leagues together.

When importing, unknown team names are created as new teams unless you pick an existing one. Suggestions are shown but never preselected, because similar names across leagues are often different teams.

## Files

- `lib/ratings.js`: rating algorithm, groups, odds inputs
- `lib/parse.js`: paste/CSV parser
- `lib/store.js`: JSON file storage, backup on restore
- `server.js`: Express API + admin
- `public/`: rankings, team, predictor, method and admin pages; `bookmarklet.src.js`
- `render.yaml`: Render deployment blueprint
