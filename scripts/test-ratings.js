'use strict';
const assert = require('assert');
const { computeRatings } = require('../lib/ratings');
const { parseText } = require('../lib/parse');

const T = ids => ids.map(id => ({ id, name: id }));
const G = (list) => list.map(([h, hs, a, as, so], i) => ({ id: 'g' + i, homeId: h, awayId: a, homeScore: hs, awayScore: as, shootout: !!so }));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

// 1. Every team satisfies rating = AGD + SCHED
{
  const r = computeRatings(T(['A', 'B', 'C', 'D']), G([['A', 3, 'B', 1], ['B', 2, 'C', 1], ['A', 2, 'C', 2], ['C', 4, 'D', 0], ['D', 1, 'A', 5], ['B', 3, 'D', 3]]), { minGames: 0 });
  for (const t of r.rows) near(t.rating, t.agd + t.sched, `identity ${t.id}`);
  assert.strictEqual(r.rows.find(t => t.rank === 1).id, 'A');
  near(Math.max(...r.rows.map(t => t.rating)), 99.99, 'top anchored');
  console.log('ok identity', r.rows.map(t => `${t.id}:${t.rating.toFixed(2)}`).join(' '));
}
// 2. Goal cap: 15-0 counts the same as 7-0
{
  const a = computeRatings(T(['A', 'B']), G([['A', 15, 'B', 0]]), { minGames: 0 });
  const b = computeRatings(T(['A', 'B']), G([['A', 7, 'B', 0]]), { minGames: 0 });
  near(a.byId.get('A').rating - a.byId.get('B').rating, 7, 'cap');
  near(b.byId.get('A').rating - b.byId.get('B').rating, 7, 'cap2');
  console.log('ok cap');
}
// 3. Shootout = tie
{
  const r = computeRatings(T(['A', 'B']), G([['A', 4, 'B', 3, true]]), { minGames: 0 });
  near(r.byId.get('A').rating, r.byId.get('B').rating, 'shootout tie');
  assert.strictEqual(r.byId.get('A').t, 1);
  console.log('ok shootout');
}
// 4. Blowout rule: strong team beating a much weaker team 9-0 should not hurt it
{
  // S is ~10 goals better than W via common opponent M.
  const games = G([['S', 5, 'M', 0], ['S', 5, 'M', 0], ['M', 5, 'W', 0], ['M', 5, 'W', 0], ['S', 9, 'W', 0]]);
  const r = computeRatings(T(['S', 'M', 'W']), games, { minGames: 0 });
  const blow = r.gameInfo.get('g4');
  assert.strictEqual(blow.counted, false, 'blowout should be dropped');
  near(r.byId.get('S').rating - r.byId.get('M').rating, 5, 'S-M gap preserved');
  console.log('ok blowout rule');
}
// 5. Min games
{
  const r = computeRatings(T(['A', 'B', 'C']), G([['A', 1, 'B', 0], ['A', 1, 'B', 0], ['C', 1, 'A', 0]]), { minGames: 2 });
  assert.strictEqual(r.byId.get('C').rank, null);
  assert.ok(r.byId.get('A').rank);
  console.log('ok min games');
}
// 6. Parser formats
{
  const txt = [
    'Date\tTime\tVisitor\tScore\tHome\tScore\tArena',
    'Sat, Nov 15, 2026\t7:30 PM\tLakeview Lions\t3\tHillside Hawks\t2\tHillside Arena',
    'Nov 16\t2:00 PM\tRiver Kings\t1\tLakeview Lions\t1\tSO',
    '2026-11-17  North Bay Blades 4 - 2 South Shore Sharks',
    '11/18/2026 | Hillside Hawks | 5 | River Kings | 0',
    'Nov 20  Hillside Hawks vs Lakeview Lions  6-1',
    'Nov 21\t8:00 PM\tRiver Kings\t\tHillside Hawks\t\tArena',
  ].join('\n');
  const rows = parseText(txt, { season: '2026-27' });
  const ok = rows.filter(r => !r.error);
  console.log(rows.map(r => r.error ? `ERR(${r.error}) ${r.line}` : `${r.date} ${r.home} ${r.homeScore}-${r.awayScore} ${r.away}${r.shootout ? ' SO' : ''}`).join('\n'));
  assert.strictEqual(ok.length, 5);
  assert.deepStrictEqual([ok[0].date, ok[0].home, ok[0].homeScore, ok[0].away, ok[0].awayScore], ['2026-11-15', 'Lakeview Lions', 3, 'Hillside Hawks', 2]);
  assert.strictEqual(ok[1].shootout, true);
  assert.strictEqual(ok[3].date, '2026-11-18');
  const csv = parseText('date,home,home_score,away,away_score\n2027-01-05,A Team,2,B Team,3', { season: '2026-27' });
  assert.strictEqual(csv[0].awayScore, 3);
  console.log('ok parser');
}
console.log('\nAll rating tests passed.');
