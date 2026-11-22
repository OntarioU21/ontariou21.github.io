'use strict';
// Seasons run August to July. A game's season comes from its date, so past seasons can be
// stored alongside the current one and each season gets its own rankings.
const { computeRatings } = require('./ratings');

function seasonOf(date) {
  const y = +String(date).slice(0, 4), m = +String(date).slice(5, 7);
  const start = m >= 8 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

// Every season with games, newest first, always including the current one.
function listSeasons(db) {
  const set = new Set(db.games.map(g => seasonOf(g.date)));
  set.add(db.settings.season);
  return [...set].sort().reverse();
}

// The teams and games that belong to one season. Past seasons only list teams that played;
// the current season also keeps teams with no games at all (just added, nothing played yet).
function seasonSlice(db, season) {
  const games = db.games.filter(g => seasonOf(g.date) === season);
  const played = new Set(games.flatMap(g => [g.homeId, g.awayId]));
  let teams;
  if (season === db.settings.season) {
    const everPlayed = new Set(db.games.flatMap(g => [g.homeId, g.awayId]));
    teams = db.teams.filter(t => played.has(t.id) || !everPlayed.has(t.id));
  } else {
    teams = db.teams.filter(t => played.has(t.id));
  }
  return { teams, games };
}

function seasonRatings(db, season) {
  const { teams, games } = seasonSlice(db, season);
  return computeRatings(teams, games, db.settings);
}

// Accepts "2024-25" style input only; anything else falls back to the current season.
function pickSeason(db, q) {
  return typeof q === 'string' && /^\d{4}-\d{2}$/.test(q) ? q : db.settings.season;
}

module.exports = { seasonOf, listSeasons, seasonSlice, seasonRatings, pickSeason };
