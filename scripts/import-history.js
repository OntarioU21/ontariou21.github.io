'use strict';
// One-off: import past-season games saved in data/history/*.json (league + tournament pages
// read in the browser). Dry run by default; add --commit to write. Stop the server first
// when committing, because it keeps its own copy of the data in memory.
//   node scripts/import-history.js            -> report only
//   node scripts/import-history.js --commit   -> backup + import
const fs = require('fs');
const path = require('path');
const store = require('../lib/store');
const { seasonOf } = require('../lib/season');

const DIR = path.join(path.dirname(store.FILE), 'history');
const COMMIT = process.argv.includes('--commit');

// Same team, different spelling across sites (normalised names, see store.normName).
const ALIASES = {
  'ennismore eagles': 'Ennismore RYC U21',
  'ennismore robert young const': 'Ennismore RYC U21',
  'ennismore robert young construction': 'Ennismore RYC U21',
  'haldimand riverkings': 'Haldimand River Kings',
  'kawartha lakes coyotes': 'Kawartha Coyotes U21',
  'southwest bullets': 'Southwest Bullets 1',
  'southwest bullets b2': 'Southwest Bullets 2',
  'belle river jr canadiens': 'Belle River Canadiens',
  'belle river canadians': 'Belle River Canadiens',
  'quinte west golden hawks': 'Quinte West Hawks',
  'south west oxford storm': 'South Oxford Storm',
  'delhi rockets': 'Delhi-Norwich 59ers',
  'delhi 59ers': 'Delhi-Norwich 59ers',
  'delhi norwich 59ers': 'Delhi-Norwich 59ers',
};
// League label for teams created from a league's own pages.
const LEAGUE_OF_SOURCE = {
  'beechey.ca': 'Beechey Juvenile',
  'woaa.on.ca': 'Western Ontario Athletic Association • MH-REP • U21',
  'shamrockhockeyleague.ca': 'Shamrock Hockey League • U21',
  'eomhl.ca': 'Eastern Ontario Minor Hockey League • U21',
};
const TOURNAMENT_SOURCES = new Set(['silverstick.org', 'omhachampionships.ca']);
const base = s => store.normName(s).replace(/\s+u21$/, '');

const db = store.load();
const current = db.settings.season;
const idx = new Map();
const addIdx = t => { for (const n of [t.name, ...(t.aliases || [])]) { idx.set(store.normName(n), t); idx.set(base(n), t); } };
db.teams.forEach(addIdx);

// Read everything, league pages first so a team's league comes from its own league.
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'))
  .sort((a, b) => TOURNAMENT_SOURCES.has(a.replace(/\.json$/, '')) - TOURNAMENT_SOURCES.has(b.replace(/\.json$/, '')));
const rows = [];
for (const f of files) {
  const source = f.replace(/\.json$/, '');
  for (const g of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))) rows.push({ ...g, source });
}

const created = [], seen = new Map();
function resolve(name, source) {
  const key = base(name);
  const target = ALIASES[key] || ALIASES[store.normName(name)];
  let t = idx.get(target ? store.normName(target) : key) || (target && idx.get(base(target)));
  if (!t) {
    const clean = target || name.replace(/\s+U21$/i, '').trim();
    t = { id: store.id('t'), name: clean, association: '', tier: '', league: LEAGUE_OF_SOURCE[source] || 'Tournament only', aliases: [] };
    db.teams.push(t); addIdx(t); created.push(t);
  }
  if (store.normName(name) !== store.normName(t.name) && !(t.aliases || []).includes(name)) {
    t.aliases = [...new Set([...(t.aliases || []), name])];
    idx.set(store.normName(name), t);
  }
  if (!seen.has(t.id)) seen.set(t.id, new Set());
  seen.get(t.id).add(`${source} ${seasonOf(rows.current.date)}`);
  return t;
}

const key = (d, a, b, sa, sb) => (a < b ? `${d}|${a}|${b}|${sa}|${sb}` : `${d}|${b}|${a}|${sb}|${sa}`);
const existing = new Set(db.games.map(g => key(g.date, g.homeId, g.awayId, g.homeScore, g.awayScore)));
const perSeason = {}; let added = 0, dup = 0, skipped = 0;
for (const r of rows) {
  rows.current = r;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || seasonOf(r.date) === current) { skipped++; continue; } // this season comes from the normal imports
  const h = resolve(r.home, r.source), a = resolve(r.away, r.source);
  if (h.id === a.id) { skipped++; continue; }
  const k = key(r.date, h.id, a.id, r.homeScore, r.awayScore);
  if (existing.has(k)) { dup++; continue; }
  existing.add(k);
  db.games.push({
    id: store.id('g'), date: r.date, homeId: h.id, awayId: a.id, homeScore: +r.homeScore, awayScore: +r.awayScore,
    shootout: !!r.shootout, type: TOURNAMENT_SOURCES.has(r.source) ? 'tournament' : r.type || 'league',
    note: TOURNAMENT_SOURCES.has(r.source) ? String(r.group || '').replace(/^Silver Stick • Finals • \d{4}-\d{4} • /, 'Silver Stick ').slice(0, 200) : '',
    source: 'history:' + r.source, createdAt: new Date().toISOString(),
  });
  const s = seasonOf(r.date); perSeason[s] = (perSeason[s] || 0) + 1; added++;
}

console.log(`Rows read: ${rows.length}. New games: ${added}. Already entered: ${dup}. Skipped: ${skipped}.`);
console.log('Games by season:', perSeason);
console.log(`\nNew teams (${created.length}):`);
for (const t of created.sort((a, b) => a.league.localeCompare(b.league) || a.name.localeCompare(b.name))) {
  console.log(`  [${t.league}] ${t.name}${t.aliases.length ? '  (also: ' + t.aliases.join(', ') + ')' : ''}  <- ${[...seen.get(t.id)].join('; ')}`);
}
const renamed = db.teams.filter(t => !created.includes(t) && (t.aliases || []).length);
console.log(`\nMatched to existing teams under another spelling:`);
for (const t of renamed) console.log(`  ${t.name} <- ${t.aliases.join(', ')}`);

if (COMMIT) {
  const backup = path.join(path.dirname(store.FILE), `backup-before-history-${new Date().toISOString().slice(0, 10)}.json`);
  fs.copyFileSync(store.FILE, backup);
  store.save();
  console.log(`\nSaved. Backup of the previous data: ${path.basename(backup)}`);
} else {
  console.log('\nDry run only. Re-run with --commit (server stopped) to save.');
}
