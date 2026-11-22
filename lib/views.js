'use strict';
// Public data payloads, shared by the live server (server.js) and the static publisher
// (lib/publish.js) so both always show exactly the same thing.
const { seasonOf, listSeasons } = require('./season');

// r must be the ratings computed for `season` (see lib/season.js seasonRatings).
function rankingsPayload(db, r, season = db.settings.season) {
  const teams = [...r.rows].sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank;
    if (a.rank) return -1; if (b.rank) return 1;
    return (b.rating ?? -1e9) - (a.rating ?? -1e9);
  });
  const gameCount = db.games.filter(g => seasonOf(g.date) === season).length;
  return {
    season, currentSeason: db.settings.season, seasons: listSeasons(db),
    settings: r.settings, updatedAt: db.updatedAt, gameCount, teams,
  };
}

function teamPayload(db, r, id, season = db.settings.season) {
  const team = db.teams.find(t => t.id === id);
  if (!team) return null;
  const me = r.byId.get(team.id);
  const mine = db.games.filter(g => g.homeId === team.id || g.awayId === team.id);
  const teamSeasons = [...new Set(mine.map(g => seasonOf(g.date)))].sort().reverse();
  const games = mine
    .filter(g => seasonOf(g.date) === season)
    .map(g => {
      const home = g.homeId === team.id;
      const oppId = home ? g.awayId : g.homeId;
      const opp = r.byId.get(oppId);
      const info = r.gameInfo.get(g.id) || { d: 0, counted: false };
      const d = home ? info.d : -info.d;
      const gf = home ? g.homeScore : g.awayScore, ga = home ? g.awayScore : g.homeScore;
      const oppTeam = opp || db.teams.find(t => t.id === oppId);
      return {
        id: g.id, date: g.date, type: g.type, shootout: g.shootout,
        opponent: opp
          ? { id: oppId, name: opp.name, tier: opp.tier, rating: opp.rating, rank: opp.rank ?? opp.groupRank ?? null, counted: opp.counted }
          : { id: oppId, name: oppTeam ? oppTeam.name : '(deleted team)' },
        gf, ga,
        result: g.shootout || gf === ga ? 'T' : gf > ga ? 'W' : 'L',
        cappedDiff: d,
        gameRating: opp && opp.rating != null ? d + opp.rating : null,
        expected: me && me.rating != null && opp && opp.rating != null ? me.rating - opp.rating : null,
        counted: info.counted,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const { aliases, ...publicTeam } = team; // aliases are an admin detail
  const blank = { gp: 0, w: 0, l: 0, t: 0, gf: 0, ga: 0, rating: null, agd: null, sched: null, connected: true };
  return {
    team: { ...publicTeam, ...blank, ...me }, games, settings: r.settings,
    season, currentSeason: db.settings.season, seasons: teamSeasons,
  };
}

module.exports = { rankingsPayload, teamPayload };
