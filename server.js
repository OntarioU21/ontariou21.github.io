'use strict';
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const store = require('./lib/store');
const { seasonRatings, pickSeason } = require('./lib/season');
const { parseText } = require('./lib/parse');
const { rankingsPayload, teamPayload } = require('./lib/views');
const { publish } = require('./lib/publish');

const PORT = process.env.PORT || 4700;
const PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (PRODUCTION ? '' : 'admin');
if (PRODUCTION && ADMIN_PASSWORD.length < 8) {
  console.error('[fatal] Set ADMIN_PASSWORD (8+ characters) before running in production.');
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD) console.warn('[warn] ADMIN_PASSWORD not set; using "admin" for local use only.');
// SESSION_SECRET lets you log everyone out (change it) without changing the password.
const TOKEN = crypto.createHmac('sha256', ADMIN_PASSWORD).update('u21-rankings-admin:' + (process.env.SESSION_SECRET || '')).digest('hex');

const app = express();
app.set('trust proxy', 1); // behind Render/Railway's HTTPS proxy
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.post('/api/admin/restore', express.json({ limit: '50mb' })); // larger body for backups only
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---------- helpers ----------
// Ratings per season, recomputed whenever the data changes.
let cache = { v: -1, bySeason: new Map() };
function ratings(season) {
  const db = store.load();
  if (cache.v !== store.getVersion()) cache = { v: store.getVersion(), bySeason: new Map() };
  const key = season || db.settings.season;
  if (!cache.bySeason.has(key)) cache.bySeason.set(key, seasonRatings(db, key));
  return cache.bySeason.get(key);
}

function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function isAdmin(req) { return cookies(req).u21admin === TOKEN; }
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Not logged in' });
  next();
}
const bad = (res, msg) => res.status(400).json({ error: msg });

function teamIndex(db) {
  const map = new Map();
  for (const t of db.teams) {
    map.set(store.normName(t.name), t);
    for (const a of t.aliases || []) map.set(store.normName(a), t);
  }
  return map;
}
function suggest(db, name) {
  const toks = new Set(store.normName(name).split(' ').filter(w => w.length > 1 && w !== 'u21'));
  let best = null, bestScore = 0;
  for (const t of db.teams) {
    const tt = new Set(store.normName(t.name).split(' ').filter(w => w.length > 1 && w !== 'u21'));
    let inter = 0;
    for (const w of toks) {
      if (tt.has(w)) { inter++; continue; }
      for (const x of tt) if (Math.min(w.length, x.length) >= 4 && (w.startsWith(x) || x.startsWith(w))) { inter++; break; }
    }
    const score = inter / (toks.size + tt.size - inter || 1);
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return bestScore >= 0.34 ? { id: best.id, name: best.name, score: bestScore } : null;
}
function gameKey(date, a, b, sa, sb) {
  return a < b ? `${date}|${a}|${b}|${sa}|${sb}` : `${date}|${b}|${a}|${sb}|${sa}`;
}
function cleanTeamInput(body) {
  const out = {};
  for (const k of ['name', 'association', 'tier', 'league']) if (body[k] !== undefined) out[k] = String(body[k]).trim().slice(0, 120);
  return out;
}
function parseGameInput(body, db) {
  const homeScore = Number(body.homeScore), awayScore = Number(body.awayScore);
  if (!db.teams.some(t => t.id === body.homeId) || !db.teams.some(t => t.id === body.awayId)) return 'Pick two teams';
  if (body.homeId === body.awayId) return 'A team cannot play itself';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) return 'Date must be YYYY-MM-DD';
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) return 'Scores must be whole numbers';
  return {
    date: body.date, homeId: body.homeId, awayId: body.awayId, homeScore, awayScore,
    shootout: !!body.shootout,
    type: ['league', 'playoff', 'tournament', 'exhibition'].includes(body.type) ? body.type : 'league',
    note: String(body.note || '').slice(0, 200),
  };
}

// ---------- public API ----------
app.get('/api/rankings', (req, res) => {
  const db = store.load();
  const season = pickSeason(db, req.query.season);
  res.json(rankingsPayload(db, ratings(season), season));
});

app.get('/api/teams', (req, res) => {
  const db = store.load();
  const r = ratings();
  res.json(db.teams.map(t => ({ ...t, ...pick(r.byId.get(t.id), ['rating', 'rank', 'gp']) })).sort((a, b) => a.name.localeCompare(b.name)));
});
function pick(o, keys) { const out = {}; if (o) for (const k of keys) out[k] = o[k]; return out; }

app.get('/api/teams/:id', (req, res) => {
  const db = store.load();
  const season = pickSeason(db, req.query.season);
  const payload = teamPayload(db, ratings(season), req.params.id, season);
  if (!payload) return res.status(404).json({ error: 'Team not found' });
  res.json(payload);
});

app.get('/api/meta', (req, res) => {
  const db = store.load();
  const uniq = k => [...new Set(db.teams.map(t => t[k]).filter(Boolean))].sort();
  res.json({ season: db.settings.season, tiers: uniq('tier'), leagues: uniq('league'), associations: uniq('association') });
});

// ---------- auth ----------
// Max 10 failed logins per IP per 15 minutes.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000, MAX_FAILS = 10;
function tooManyFailures(ip) {
  const now = Date.now();
  const list = (failures.get(ip) || []).filter(t => now - t < WINDOW_MS);
  failures.set(ip, list);
  return list.length >= MAX_FAILS;
}
const cookieFlags = req => `HttpOnly; SameSite=Strict; Path=/${req.secure ? '; Secure' : ''}`;

app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (tooManyFailures(ip)) return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  const pw = String(req.body.password || '');
  const a = crypto.createHash('sha256').update(pw).digest(), b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    failures.get(ip).push(Date.now());
    return res.status(401).json({ error: 'Wrong password' });
  }
  failures.delete(ip);
  res.setHeader('Set-Cookie', `u21admin=${TOKEN}; ${cookieFlags(req)}; Max-Age=${60 * 60 * 24 * 30}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `u21admin=; ${cookieFlags(req)}; Max-Age=0`);
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ admin: isAdmin(req) }));

// ---------- admin: games ----------
app.get('/api/admin/games', requireAdmin, (req, res) => {
  const db = store.load();
  const names = new Map(db.teams.map(t => [t.id, t.name]));
  res.json(db.games.map(g => ({ ...g, homeName: names.get(g.homeId), awayName: names.get(g.awayId) }))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '')));
});
app.post('/api/admin/games', requireAdmin, (req, res) => {
  const db = store.load();
  const g = parseGameInput(req.body, db);
  if (typeof g === 'string') return bad(res, g);
  const key = gameKey(g.date, g.homeId, g.awayId, g.homeScore, g.awayScore);
  if (db.games.some(x => gameKey(x.date, x.homeId, x.awayId, x.homeScore, x.awayScore) === key) && !req.body.allowDuplicate)
    return res.status(409).json({ error: 'That exact game is already entered.' });
  const game = { id: store.id('g'), ...g, source: 'manual', createdAt: new Date().toISOString() };
  db.games.push(game); store.save();
  res.json(game);
});
app.put('/api/admin/games/:id', requireAdmin, (req, res) => {
  const db = store.load();
  const game = db.games.find(g => g.id === req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const g = parseGameInput({ ...game, ...req.body }, db);
  if (typeof g === 'string') return bad(res, g);
  Object.assign(game, g); store.save();
  res.json(game);
});
app.delete('/api/admin/games/:id', requireAdmin, (req, res) => {
  const db = store.load();
  const before = db.games.length;
  db.games = db.games.filter(g => g.id !== req.params.id);
  if (db.games.length === before) return res.status(404).json({ error: 'Game not found' });
  store.save(); res.json({ ok: true });
});

// ---------- admin: teams ----------
app.post('/api/admin/teams', requireAdmin, (req, res) => {
  const db = store.load();
  const t = cleanTeamInput(req.body);
  if (!t.name) return bad(res, 'Team name required');
  if (teamIndex(db).has(store.normName(t.name))) return res.status(409).json({ error: 'A team with that name already exists' });
  const team = { id: store.id('t'), name: t.name, association: t.association || '', tier: t.tier || '', league: t.league || '', aliases: [] };
  db.teams.push(team); store.save();
  res.json(team);
});
app.put('/api/admin/teams/:id', requireAdmin, (req, res) => {
  const db = store.load();
  const team = db.teams.find(t => t.id === req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const t = cleanTeamInput(req.body);
  if (t.name !== undefined && !t.name) return bad(res, 'Team name required');
  if (t.name && store.normName(t.name) !== store.normName(team.name)) {
    const clash = teamIndex(db).get(store.normName(t.name));
    if (clash && clash.id !== team.id) return res.status(409).json({ error: `"${t.name}" is already used by ${clash.name}` });
    team.aliases = [...new Set([...(team.aliases || []), team.name])];
  }
  if (Array.isArray(req.body.aliases)) team.aliases = req.body.aliases.map(a => String(a).trim()).filter(Boolean);
  Object.assign(team, t); store.save();
  res.json(team);
});
app.post('/api/admin/teams/:id/merge', requireAdmin, (req, res) => {
  const db = store.load();
  const from = db.teams.find(t => t.id === req.params.id);
  const into = db.teams.find(t => t.id === req.body.intoId);
  if (!from || !into || from.id === into.id) return bad(res, 'Pick two different teams');
  for (const g of db.games) {
    if (g.homeId === from.id) g.homeId = into.id;
    if (g.awayId === from.id) g.awayId = into.id;
  }
  db.games = db.games.filter(g => g.homeId !== g.awayId);
  into.aliases = [...new Set([...(into.aliases || []), from.name, ...(from.aliases || [])])];
  db.teams = db.teams.filter(t => t.id !== from.id);
  store.save(); res.json(into);
});
app.delete('/api/admin/teams/:id', requireAdmin, (req, res) => {
  const db = store.load();
  if (db.games.some(g => g.homeId === req.params.id || g.awayId === req.params.id))
    return bad(res, 'This team has games. Delete or merge them first.');
  db.teams = db.teams.filter(t => t.id !== req.params.id);
  store.save(); res.json({ ok: true });
});

// ---------- admin: import ----------
app.post('/api/admin/import/parse', requireAdmin, (req, res) => {
  const db = store.load();
  const rows = parseText(req.body.text, { season: db.settings.season, defaultDate: req.body.defaultDate });
  const idx = teamIndex(db);
  const existing = new Set(db.games.map(g => gameKey(g.date, g.homeId, g.awayId, g.homeScore, g.awayScore)));
  const unmatched = new Map();
  for (const r of rows) {
    if (r.error) continue;
    for (const side of ['home', 'away']) {
      const t = idx.get(store.normName(r[side]));
      r[side + 'Id'] = t ? t.id : null;
      if (!t && !unmatched.has(store.normName(r[side]))) unmatched.set(store.normName(r[side]), { name: r[side], suggestion: suggest(db, r[side]) });
    }
    if (r.homeId && r.awayId) r.duplicate = existing.has(gameKey(r.date, r.homeId, r.awayId, r.homeScore, r.awayScore));
  }
  res.json({ rows, unmatched: [...unmatched.values()] });
});

app.post('/api/admin/import/commit', requireAdmin, (req, res) => {
  const db = store.load();
  const { rows = [], resolutions = {}, defaults = {} } = req.body;
  const idx = teamIndex(db);
  let createdTeams = 0;
  const resolve = (name, division) => {
    const key = store.normName(name);
    const hit = idx.get(key);
    if (hit) return hit.id;
    const r = resolutions[key];
    if (r && r.mapTo) {
      const t = db.teams.find(x => x.id === r.mapTo);
      if (!t) return null;
      t.aliases = [...new Set([...(t.aliases || []), name])];
      idx.set(key, t);
      return t.id;
    }
    if (r && r.skip) return null;
    const team = {
      id: store.id('t'), name: String((r && r.name) || name).trim(),
      association: (r && r.association) || '', tier: (r && r.tier) || defaults.tier || '',
      league: (r && r.league) || String(division || '').trim().slice(0, 120) || defaults.league || '',
      aliases: [],
    };
    if (store.normName(team.name) !== key) team.aliases.push(name);
    db.teams.push(team); idx.set(key, team); idx.set(store.normName(team.name), team); createdTeams++;
    return team.id;
  };
  const existing = new Set(db.games.map(g => gameKey(g.date, g.homeId, g.awayId, g.homeScore, g.awayScore)));
  let added = 0, skipped = 0;
  for (const r of rows) {
    if (r.error || r.exclude) { skipped++; continue; }
    const homeId = resolve(r.home, r.division), awayId = resolve(r.away, r.division);
    const g = parseGameInput({ ...r, homeId, awayId, type: r.type || defaults.type }, db);
    if (typeof g === 'string') { skipped++; continue; }
    const key = gameKey(g.date, g.homeId, g.awayId, g.homeScore, g.awayScore);
    if (existing.has(key)) { skipped++; continue; }
    existing.add(key);
    db.games.push({ id: store.id('g'), ...g, source: 'import', createdAt: new Date().toISOString() });
    added++;
  }
  store.save();
  res.json({ added, skipped, createdTeams });
});

// ---------- admin: settings ----------
app.get('/api/admin/settings', requireAdmin, (req, res) => res.json(store.load().settings));
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const db = store.load();
  const s = req.body || {};
  if (s.season !== undefined) db.settings.season = String(s.season).trim().slice(0, 20);
  for (const k of ['minGames', 'goalCap', 'blowoutGap']) {
    if (s[k] === undefined) continue;
    const v = Number(s[k]);
    if (!Number.isFinite(v) || v < 0 || v > 50) return bad(res, `${k} must be between 0 and 50`);
    db.settings[k] = v;
  }
  if (s.oddsSpread !== undefined) {
    const v = Number(s.oddsSpread);
    if (!Number.isFinite(v) || v < 0.5 || v > 2) return bad(res, 'Odds spread must be between 0.5 and 2');
    db.settings.oddsSpread = v;
  }
  store.save(); res.json(db.settings);
});
app.get('/api/admin/export', requireAdmin, (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="u21-rankings-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(store.load());
});
// Build the public static site and push it to GitHub Pages (gh-pages branch).
app.post('/api/admin/publish', requireAdmin, async (req, res) => {
  try {
    res.json(await publish(store.load()));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Replace all data with an uploaded backup (from the export above). The current data is
// saved next to the data file first, so a bad restore can be undone.
app.post('/api/admin/restore', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.teams) || !Array.isArray(b.games)) return bad(res, 'That file is not a rankings backup (missing teams or games).');
  const ids = new Set(b.teams.map(t => t && t.id));
  if (b.teams.some(t => !t || typeof t.id !== 'string' || typeof t.name !== 'string')) return bad(res, 'Backup has a team without an id or name.');
  const badGame = b.games.find(g => !g || !ids.has(g.homeId) || !ids.has(g.awayId) || !Number.isFinite(g.homeScore) || !Number.isFinite(g.awayScore) || !/^\d{4}-\d{2}-\d{2}$/.test(g.date || ''));
  if (badGame) return bad(res, 'Backup has a game with a missing team, score or date.');
  const saved = store.replace({ teams: b.teams, games: b.games, settings: b.settings || {} });
  res.json({ ok: true, teams: b.teams.length, games: b.games.length, previousSavedAs: saved });
});

// ---------- nightly auto-import (from the Chrome extension in /extension) ----------
// Only accepted from this computer, and only from the extension: a web page can't send the
// custom header without a CORS preflight, which this server never approves. Off in production.
function autoAllowed(req) {
  if (PRODUCTION) return false;
  const ip = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return false;
  if (req.get('X-U21-Auto') !== '1') return false;
  const origin = req.get('Origin');
  return !origin || origin.startsWith('chrome-extension://');
}
let autoRunning = false;
// The Windows nightly task (scripts/nightly.ps1) wakes the PC and asks for a run here; the
// extension polls /api/auto/wanted every few minutes and runs when asked.
let autoWanted = 0;
function localOnly(req) {
  if (PRODUCTION) return false;
  const ip = req.socket.remoteAddress || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip) && req.get('X-U21-Auto') === '1';
}
app.post('/api/auto/request', (req, res) => {
  if (!localOnly(req)) return res.status(403).json({ error: 'Not allowed' });
  autoWanted = Date.now();
  res.json({ ok: true });
});
app.get('/api/auto/wanted', (req, res) => {
  if (!autoAllowed(req)) return res.status(403).json({ error: 'Not allowed' });
  res.json({ run: autoWanted > 0 && Date.now() - autoWanted < 6 * 3600 * 1000 });
});
app.get('/api/auto/last', (req, res) => {
  if (!localOnly(req)) return res.status(403).json({ error: 'Not allowed' });
  const db = store.load();
  res.json({ last: (db.autoLog || [])[0] || null, wanted: autoWanted > 0 });
});
app.post('/api/auto/import', async (req, res) => {
  if (!autoAllowed(req)) return res.status(403).json({ error: 'Not allowed' });
  if (autoRunning) return res.status(409).json({ error: 'Already running' });
  autoRunning = true;
  autoWanted = 0;
  try {
    const db = store.load();
    const leagues = Array.isArray(req.body.leagues) ? req.body.leagues.slice(0, 20) : [];
    const blocked = (Array.isArray(req.body.blocked) ? req.body.blocked : []).map(s => String(s).slice(0, 100)).slice(0, 20);
    const idx = teamIndex(db);
    const existing = new Set(db.games.map(g => gameKey(g.date, g.homeId, g.awayId, g.homeScore, g.awayScore)));
    db.pending = Array.isArray(db.pending) ? db.pending : [];
    const pendingKeys = new Set(db.pending.map(p => [p.date, p.home, p.away, p.homeScore, p.awayScore].join('|')));
    const summary = { at: new Date().toISOString(), added: 0, pending: 0, leagues: [], blocked };
    for (const lg of leagues) {
      const source = String(lg.source || '').slice(0, 100);
      if (typeof lg.csv !== 'string' || lg.csv.length > 2e6) continue;
      const rows = parseText(lg.csv, { season: db.settings.season });
      let added = 0, held = 0;
      for (const r of rows) {
        if (r.error) continue;
        const h = idx.get(store.normName(r.home)), a = idx.get(store.normName(r.away));
        // Unknown names are never guessed: they wait in Admin for a person to match or create.
        if (!h || !a) {
          const k = [r.date, r.home, r.away, r.homeScore, r.awayScore].join('|');
          if (!pendingKeys.has(k)) { pendingKeys.add(k); db.pending.push({ ...r, source }); held++; }
          continue;
        }
        const g = parseGameInput({ ...r, homeId: h.id, awayId: a.id }, db);
        if (typeof g === 'string') continue;
        const key = gameKey(g.date, g.homeId, g.awayId, g.homeScore, g.awayScore);
        if (existing.has(key)) continue;
        existing.add(key);
        db.games.push({ id: store.id('g'), ...g, source: 'auto', createdAt: new Date().toISOString() });
        added++;
      }
      summary.added += added; summary.pending += held;
      summary.leagues.push({ source, rows: rows.length, added, held });
    }
    db.autoLog = [summary, ...(Array.isArray(db.autoLog) ? db.autoLog : [])].slice(0, 30);
    store.save();
    if (summary.added > 0 && req.body.publish !== false) {
      try { summary.published = (await publish(store.load())).url; }
      catch (e) { summary.publishError = e.message; }
      store.save(); // keep the publish result in the log
    }
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    autoRunning = false;
  }
});
// Admin view of the nightly runs and of games held back because a team name was unknown.
app.get('/api/admin/auto', requireAdmin, (req, res) => {
  const db = store.load();
  res.json({ log: db.autoLog || [], pending: db.pending || [] });
});
app.delete('/api/admin/auto/pending', requireAdmin, (req, res) => {
  const db = store.load();
  db.pending = []; store.save(); res.json({ ok: true });
});

app.listen(PORT, () => console.log(`OMHA U21 Rankings running at http://localhost:${PORT}`));
