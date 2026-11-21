'use strict';
// Fills data/db.json with FICTIONAL demo teams and simulated games so you can see
// the site working. Run: npm run demo   (add --force to overwrite existing data)
const fs = require('fs');
const store = require('../lib/store');

if (fs.existsSync(store.FILE) && !process.argv.includes('--force')) {
  const cur = JSON.parse(fs.readFileSync(store.FILE, 'utf8'));
  if ((cur.games || []).length) {
    console.log('data/db.json already has games. Re-run with --force to replace it with demo data.');
    process.exit(1);
  }
}

let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const poisson = l => { let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= rand(); } while (p > L); return k - 1; };

const towns = ['Pinecrest', 'Maple Hollow', 'Stonebridge', 'Cedar Falls', 'Ridgeway Bay', 'Elm Harbour', 'Fox Lake', 'Granite Point', 'Willow Creek', 'Birchmount', 'Iron Hill', 'Silver Lake', 'Oak Ridge', 'Kestrel Bay', 'Northgate', 'Clearwater', 'Ashford', 'Highland Park', 'Riverbend', 'Larch Valley', 'Hemlock', 'Bay Crossing', 'Copper Ridge', 'Dunmore'];
const mascots = ['Wolves', 'Hawks', 'Bears', 'Storm', 'Kings', 'Flames', 'Rangers', 'Lynx', 'Thunder', 'Huskies', 'Blades', 'Knights'];
const tiers = [{ tier: 'AE', base: 3.4, league: 'Demo East League' }, { tier: 'B', base: 2.6, league: 'Demo Central League' }, { tier: 'C', base: 2.0, league: 'Demo West League' }];

const db = { teams: [], games: [], settings: { season: '2026-27', minGames: 10, goalCap: 7, blowoutGap: 7 } };
const strength = new Map();
towns.forEach((town, i) => {
  const t = tiers[i % 3];
  const team = { id: store.id('t'), name: `${town} ${mascots[i % mascots.length]}`, association: `${town} Minor Hockey (demo)`, tier: t.tier, league: t.league, aliases: [] };
  db.teams.push(team);
  strength.set(team.id, t.base + (rand() - 0.5) * 1.6);
});

const start = new Date('2026-09-20');
for (let day = 0; day < 60; day += 2) {
  const date = new Date(start.getTime() + day * 864e5).toISOString().slice(0, 10);
  const pool = [...db.teams].sort(() => rand() - 0.5);
  for (let i = 0; i + 1 < pool.length; i += 2) {
    const [h, a] = [pool[i], pool[i + 1]];
    const sameTier = h.tier === a.tier;
    if (!sameTier && rand() > 0.15) continue; // mostly league play, some cross-tier tournament games
    const sh = strength.get(h.id), sa = strength.get(a.id);
    let hs = poisson(Math.max(0.3, 3 + (sh - sa))), as = poisson(Math.max(0.3, 3 + (sa - sh)));
    let shootout = false;
    if (hs === as && rand() < 0.4) { shootout = true; if (rand() < 0.5) hs++; else as++; }
    db.games.push({ id: store.id('g'), date, homeId: h.id, awayId: a.id, homeScore: hs, awayScore: as, shootout, type: sameTier ? 'league' : 'tournament', note: '', source: 'demo', createdAt: new Date().toISOString() });
  }
}
db.updatedAt = new Date().toISOString();
fs.mkdirSync(require('path').dirname(store.FILE), { recursive: true });
fs.writeFileSync(store.FILE, JSON.stringify(db, null, 1));
console.log(`Wrote ${db.teams.length} demo teams and ${db.games.length} games to ${store.FILE}`);
