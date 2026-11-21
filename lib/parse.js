'use strict';
/*
 * Turns pasted schedule/results text or CSV into game rows:
 *   { line, date, home, away, homeScore, awayScore, shootout, type, error }
 * "home"/"away" just mean team 1 / team 2; order does not affect ratings.
 */

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const WD_RE = '(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,?\\s+)?';

function pad(n) { return String(n).padStart(2, '0'); }
function iso(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1990 && y < 2100)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
function seasonYear(month, season) {
  const start = parseInt(season, 10) || new Date().getFullYear();
  return month >= 8 ? start : start + 1;
}

function extractDate(s, season) {
  let m;
  if ((m = s.match(new RegExp(WD_RE + '\\b(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})\\b', 'i'))))
    return { date: iso(+m[1], +m[2], +m[3]), rest: s.replace(m[0], ' ') };
  if ((m = s.match(new RegExp(WD_RE + '\\b(\\d{1,2})/(\\d{1,2})/(\\d{2,4})\\b', 'i')))) {
    let y = +m[3]; if (y < 100) y += 2000;
    return { date: iso(y, +m[1], +m[2]), rest: s.replace(m[0], ' ') };
  }
  if ((m = s.match(new RegExp(WD_RE + '\\b' + MON_RE + '\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?', 'i')))) {
    const mo = MON[m[1].slice(0, 3).toLowerCase()];
    const y = m[3] ? +m[3] : seasonYear(mo, season);
    return { date: iso(y, mo, +m[2]), rest: s.replace(m[0], ' ') };
  }
  if ((m = s.match(new RegExp(WD_RE + '\\b(\\d{1,2})[\\s-]+' + MON_RE + '(?:[\\s,-]+(\\d{4}|\\d{2})\\b)?', 'i')))) {
    const mo = MON[m[2].slice(0, 3).toLowerCase()];
    let y = m[3] ? +m[3] : seasonYear(mo, season); if (y < 100) y += 2000;
    return { date: iso(y, mo, +m[1]), rest: s.replace(m[0], ' ') };
  }
  return { date: null, rest: s };
}

const TIME_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?|\b\d{1,2}\s*[ap]\.?m\.?\b/gi;
const SO_RE = /\b(so|s\/o|shoot-?out|f\/so|final\s*\/?\s*so)\b/i;
const JUNK_RE = /^(final|f|ot|so|f\/ot|f\/so|final\s*[-/]?\s*(ot|so)|w|l|t|reg|regular season|league|exhibition|playoffs?|tournament|game|box ?score|game ?sheet|details|recap|preview|tickets|-+|vs\.?|v|@|at|h|a|home|away|visitor|visitors|date|time|score|scores|venue|arena|location|rink|result|results|status|#|no\.?|game ?#|game ?no\.?)$/i;
const SCORE_RE = /^\d{1,2}$/;
const COMBO_RE = /^(\d{1,2})\s*[-–—:]\s*(\d{1,2})(?:\s*\(?\s*(?:ot|so|s\/o)\s*\)?)?$/i;

function cleanTeam(s) {
  return String(s || '')
    .replace(/^\s*(?:@|vs\.?|at)\s+/i, '')
    .replace(/\s*\((?:h|a|home|away)\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fromCells(cells) {
  const seq = [];
  for (const raw of cells) {
    const c = raw.trim();
    if (!c || JUNK_RE.test(c)) continue;
    let m;
    if (SCORE_RE.test(c) && +c <= 40) seq.push({ t: 'S', v: +c });
    else if ((m = c.match(COMBO_RE))) seq.push({ t: 'C', v: [+m[1], +m[2]] });
    else if (/[a-z]/i.test(c)) seq.push({ t: 'T', v: cleanTeam(c) });
  }
  const types = seq.map(x => x.t).join('');
  let m;
  // Team Score Team Score (most results tables)
  const pairs = [];
  for (let i = 0; i < seq.length - 1; i++) if (seq[i].t === 'T' && seq[i + 1].t === 'S') { pairs.push([seq[i].v, seq[i + 1].v]); i++; }
  if (pairs.length >= 2) return { home: pairs[0][0], homeScore: pairs[0][1], away: pairs[1][0], awayScore: pairs[1][1] };
  if ((m = types.indexOf('TCT')) >= 0) return { home: seq[m].v, homeScore: seq[m + 1].v[0], awayScore: seq[m + 1].v[1], away: seq[m + 2].v };
  if ((m = types.indexOf('TTC')) >= 0) return { home: seq[m].v, away: seq[m + 1].v, homeScore: seq[m + 2].v[0], awayScore: seq[m + 2].v[1] };
  if ((m = types.indexOf('TTSS')) >= 0) return { home: seq[m].v, away: seq[m + 1].v, homeScore: seq[m + 2].v, awayScore: seq[m + 3].v };
  return null;
}

function fromSentence(s) {
  s = s.replace(/\bfinal\b[:\s-]*/i, ' ').replace(/\s+/g, ' ').trim();
  let m;
  if ((m = s.match(/^(.+?)\s+(?:vs\.?|v\.?|at|@)\s+(.+?)\s+(\d{1,2})\s*[-–—:]\s*(\d{1,2})$/i)))
    return { home: cleanTeam(m[1]), away: cleanTeam(m[2]), homeScore: +m[3], awayScore: +m[4] };
  if ((m = s.match(/^(.+?)\s+(\d{1,2})\s*[-–—:]\s*(\d{1,2})\s+(.+)$/)))
    return { home: cleanTeam(m[1]), homeScore: +m[2], awayScore: +m[3], away: cleanTeam(m[4]) };
  if ((m = s.match(/^(.+?)\s+(\d{1,2})\s*(?:,|@|at|vs\.?|-)?\s+(.+?)\s+(\d{1,2})$/i)))
    return { home: cleanTeam(m[1]), homeScore: +m[2], away: cleanTeam(m[3]), awayScore: +m[4] };
  return null;
}

function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

const COLS = {
  date: ['date', 'game date', 'day'],
  home: ['home', 'home team', 'team 1', 'team1', 'team a'],
  homeScore: ['home score', 'home_score', 'hs', 'home goals', 'score 1', 'score1', 'team 1 score'],
  away: ['away', 'away team', 'visitor', 'visiting team', 'visitors', 'team 2', 'team2', 'team b'],
  awayScore: ['away score', 'away_score', 'as', 'away goals', 'visitor score', 'visitor_score', 'score 2', 'score2', 'team 2 score'],
  shootout: ['shootout', 'so'],
  type: ['type', 'game type'],
  division: ['division', 'group', 'league'],
};

function parseCsv(lines, season) {
  const first = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/_/g, ' ').trim());
  const map = {};
  for (const [k, names] of Object.entries(COLS)) {
    const i = first.findIndex(h => names.includes(h) || names.includes(h.replace(/ /g, '_')));
    if (i >= 0) map[k] = i;
  }
  const hasHeader = map.home !== undefined && map.away !== undefined;
  const pos = hasHeader ? map : { date: 0, home: 1, homeScore: 2, away: 3, awayScore: 4, shootout: 5, type: 6 };
  const rows = [];
  for (const line of hasHeader ? lines.slice(1) : lines) {
    const c = parseCsvLine(line);
    const get = k => (pos[k] !== undefined ? c[pos[k]] || '' : '');
    const dateRaw = get('date');
    const d = extractDate(dateRaw, season);
    const row = {
      line,
      date: d.date,
      home: cleanTeam(get('home')),
      away: cleanTeam(get('away')),
      homeScore: get('homeScore') === '' ? null : Number(get('homeScore')),
      awayScore: get('awayScore') === '' ? null : Number(get('awayScore')),
      shootout: /^(1|y|yes|true|so)$/i.test(get('shootout')),
      type: normType(get('type')),
      division: get('division').slice(0, 120),
    };
    rows.push(validate(row, dateRaw));
  }
  return rows;
}

function normType(s) {
  s = String(s || '').toLowerCase();
  if (s.startsWith('play')) return 'playoff';
  if (s.startsWith('tour')) return 'tournament';
  if (s.startsWith('exh')) return 'exhibition';
  return 'league';
}

function validate(row, dateRaw) {
  if (!row.home || !row.away) row.error = 'Could not find two team names';
  else if (!Number.isInteger(row.homeScore) || !Number.isInteger(row.awayScore)) row.error = 'No final score (unplayed game?)';
  else if (!row.date) row.error = dateRaw ? `Could not read date "${dateRaw}"` : 'No date found';
  return row;
}

function parseText(text, { season, defaultDate } = {}) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.replace(/ /g, ' ')).filter(l => l.trim());
  if (!lines.length) return [];

  const commaLines = lines.filter(l => !l.includes('\t') && (l.match(/,/g) || []).length >= 3).length;
  if (commaLines >= Math.ceil(lines.length * 0.6)) return parseCsv(lines, season);

  const rows = [];
  let lastDate = defaultDate || null;
  for (const line of lines) {
    const d = extractDate(line, season);
    // A line that is only a date acts as a heading for the games under it.
    let rest = d.rest.replace(TIME_RE, ' ');
    if (d.date) lastDate = d.date;
    const shootout = SO_RE.test(rest);
    let cells;
    if (rest.includes('\t')) cells = rest.split('\t');
    else if (rest.includes('|')) cells = rest.split('|');
    else cells = rest.split(/\s{2,}/);
    cells = cells.map(c => c.trim()).filter(Boolean);
    if (!cells.length || cells.every(c => JUNK_RE.test(c))) continue;
    let g = cells.length > 1 ? fromCells(cells) : null;
    if (!g) g = fromSentence(cells.join(' ').replace(SO_RE, ' '));
    if (!g) {
      const textCells = cells.filter(c => /[a-z]/i.test(c) && !JUNK_RE.test(c)).length;
      if (textCells >= 2 && !cells.some(c => SCORE_RE.test(c) || COMBO_RE.test(c))) rows.push({ line, error: 'No final score (unplayed game?)' });
      else if (/\d/.test(rest) || cells.length > 1) rows.push({ line, error: 'Could not read this line' });
      continue;
    }
    rows.push(validate({ line, date: d.date || lastDate, ...g, shootout, type: 'league' }, null));
  }
  return rows;
}

module.exports = { parseText, extractDate };
