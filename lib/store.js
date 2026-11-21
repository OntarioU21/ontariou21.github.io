'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json');

const DEFAULT_SETTINGS = { season: '2026-27', minGames: 10, goalCap: 7, blowoutGap: 7, oddsSpread: 1 };

let db = null;
let version = 0;

function load() {
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    db = { teams: [], games: [], settings: {} };
  }
  db.teams = db.teams || [];
  db.games = db.games || [];
  db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
  db.updatedAt = db.updatedAt || null;
  return db;
}

function save() {
  db.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, FILE);
  version++;
}

// Swap in a whole new dataset, keeping a copy of the current one beside the data file.
function replace(next) {
  load();
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(path.dirname(FILE), `pre-restore-${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify(db));
  db = { teams: next.teams, games: next.games, settings: { ...DEFAULT_SETTINGS, ...next.settings } };
  save();
  return path.basename(backup);
}

function id(prefix) {
  return prefix + crypto.randomBytes(5).toString('hex');
}

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

module.exports = { load, save, replace, id, normName, getVersion: () => version, FILE };
