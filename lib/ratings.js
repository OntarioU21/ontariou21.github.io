'use strict';
/*
 * Rating = Average Goal Differential (AGD) + Schedule Strength (SCHED)
 *
 *  - Each game's goal differential is capped at +/- goalCap (default 7).
 *  - Shootout games count as ties (differential 0).
 *  - SCHED is the average rating of the opponents a team played.
 *  - Because every rating depends on every other rating, the system is solved
 *    simultaneously. For every team: rating_i = avg(diff_ig) + avg(rating_opp).
 *    That is the linear system L * r = b (L = game-count Laplacian), which we
 *    solve with conjugate gradient.
 *  - Blowout rule: when two teams' ratings differ by more than blowoutGap and the
 *    stronger team wins by at least the cap, the game is dropped for both teams
 *    (the favourite did all it could, so the cap should not drag it down).
 *  - The scale is shifted so the #1 ranked team sits at 99.99. Only differences
 *    matter: a 2.00 gap means the stronger team is expected to win by 2 goals.
 */

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function solve(n, G, excl) {
  const cnt = new Float64Array(n);
  const b = new Float64Array(n);
  for (let k = 0; k < G.length; k++) {
    if (excl[k]) continue;
    const { h, a, d } = G[k];
    cnt[h]++; cnt[a]++;
    b[h] += d; b[a] -= d;
  }
  const mul = (x, y) => {
    for (let i = 0; i < n; i++) y[i] = cnt[i] * x[i];
    for (let k = 0; k < G.length; k++) {
      if (excl[k]) continue;
      const { h, a } = G[k];
      y[h] -= x[a]; y[a] -= x[h];
    }
  };
  const dot = (u, v) => { let s = 0; for (let i = 0; i < n; i++) s += u[i] * v[i]; return s; };

  const x = new Float64Array(n);
  const r = Float64Array.from(b);
  const p = Float64Array.from(b);
  const Ap = new Float64Array(n);
  let rs = dot(r, r);
  const tol = 1e-20 * Math.max(1, rs);
  for (let it = 0; it < 4 * n + 100 && rs > tol; it++) {
    mul(p, Ap);
    const pAp = dot(p, Ap);
    if (pAp <= 1e-30) break;
    const alpha = rs / pAp;
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
    const rsNew = dot(r, r);
    const beta = rsNew / rs;
    for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i];
    rs = rsNew;
  }
  // CG started at 0 stays orthogonal to the null space, so every connected
  // group of teams is centred on 0. Teams with no counted games stay at 0.
  return x;
}

function components(n, G) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const { h, a } of G) { const x = find(h), y = find(a); if (x !== y) parent[x] = y; }
  const size = new Map();
  const comp = new Array(n);
  for (let i = 0; i < n; i++) { comp[i] = find(i); size.set(comp[i], (size.get(comp[i]) || 0) + 1); }
  return { comp, size };
}

function computeRatings(teams, games, settings = {}) {
  const cap = Number(settings.goalCap) || 7;
  const gap = Number(settings.blowoutGap) || 7;
  const minGames = Number(settings.minGames) || 0;
  const n = teams.length;
  const idx = new Map(teams.map((t, i) => [t.id, i]));

  const G = [];
  for (const g of games) {
    const h = idx.get(g.homeId), a = idx.get(g.awayId);
    if (h === undefined || a === undefined || h === a) continue;
    if (!Number.isFinite(g.homeScore) || !Number.isFinite(g.awayScore)) continue;
    const raw = g.shootout ? 0 : g.homeScore - g.awayScore;
    G.push({ g, h, a, d: clamp(raw, -cap, cap) });
  }

  // Alternate between solving and re-evaluating the blowout rule until stable.
  const excl = new Uint8Array(G.length);
  let R = solve(n, G, excl);
  for (let pass = 0; pass < 25; pass++) {
    let changed = false;
    for (let k = 0; k < G.length; k++) {
      const { h, a, d } = G[k];
      const diff = R[h] - R[a];
      const x = (diff > gap && d >= cap) || (-diff > gap && -d >= cap) ? 1 : 0;
      if (x !== excl[k]) { excl[k] = x; changed = true; }
    }
    if (!changed) break;
    R = solve(n, G, excl);
  }

  // Per-team aggregates.
  const st = teams.map(() => ({ gp: 0, w: 0, l: 0, t: 0, gf: 0, ga: 0, counted: 0, sumD: 0, sumOpp: 0 }));
  G.forEach(({ g, h, a, d }, k) => {
    const H = st[h], A = st[a];
    H.gp++; A.gp++;
    H.gf += g.homeScore; H.ga += g.awayScore; A.gf += g.awayScore; A.ga += g.homeScore;
    if (g.shootout || g.homeScore === g.awayScore) { H.t++; A.t++; }
    else if (g.homeScore > g.awayScore) { H.w++; A.l++; }
    else { A.w++; H.l++; }
    if (!excl[k]) {
      H.counted++; A.counted++;
      H.sumD += d; A.sumD -= d;
      H.sumOpp += R[a]; A.sumOpp += R[h];
    }
  });

  const { comp, size } = components(n, G);
  let mainComp = null, best = 0;
  for (const [c, s] of size) if (s > best) { best = s; mainComp = c; }

  const eligible = i => st[i].counted > 0 && st[i].gp >= minGames;
  let top = -Infinity;
  for (let i = 0; i < n; i++) if (eligible(i) && comp[i] === mainComp) top = Math.max(top, R[i]);
  if (top === -Infinity) for (let i = 0; i < n; i++) if (st[i].counted > 0) top = Math.max(top, R[i]);
  const offset = top === -Infinity ? 90 : 99.99 - top;

  const rows = teams.map((t, i) => {
    const s = st[i];
    const has = s.counted > 0;
    return {
      id: t.id, name: t.name, association: t.association || '', tier: t.tier || '', league: t.league || '',
      gp: s.gp, w: s.w, l: s.l, t: s.t, gf: s.gf, ga: s.ga, counted: s.counted,
      agd: has ? s.sumD / s.counted : null,
      sched: has ? s.sumOpp / s.counted + offset : null,
      rating: has ? R[i] + offset : null,
      ranked: eligible(i),
      connected: comp[i] === mainComp,
      rank: null,
    };
  });

  // Only teams linked to the main group (directly or through opponents) can be compared,
  // so the overall rank covers the main group. Every other group is ranked on its own.
  const groupOf = new Map();
  teams.forEach((t, i) => {
    rows[i].group = comp[i] === mainComp ? 'main' : 'g' + comp[i];
    if (!groupOf.has(rows[i].group)) groupOf.set(rows[i].group, []);
    groupOf.get(rows[i].group).push(rows[i]);
  });
  for (const [g, members] of groupOf) {
    const elig = members.filter(r => r.ranked).sort((x, y) => y.rating - x.rating);
    elig.forEach((r, i) => { r.groupRank = i + 1; if (g === 'main') r.rank = i + 1; });
    const leagues = [...new Set(members.map(r => r.league).filter(Boolean))];
    members.forEach(r => { r.groupLabel = leagues.join(' + ') || 'Unassigned'; });
  }

  // Spread of actual results around the rating prediction (in goals). Used to turn a
  // rating gap into win/tie/loss probabilities. Needs a reasonable sample to be stable.
  // The ratings were fitted to these same games, so raw residuals understate the real
  // spread. Divide by the residual degrees of freedom (games minus fitted ratings) instead.
  let sse = 0, m = 0;
  G.forEach(({ h, a, d }, k) => { if (!excl[k]) { const e = d - (R[h] - R[a]); sse += e * e; m++; } });
  const fitted = new Set();
  st.forEach((s, i) => { if (s.counted > 0) fitted.add(i); });
  const fittedGroups = new Set([...fitted].map(i => comp[i])).size;
  const df = m - (fitted.size - fittedGroups);
  const DEFAULT_SIGMA = 2.6;
  const sigma = m >= 30 && df >= 20 ? Math.max(1.5, Math.sqrt(sse / df)) : DEFAULT_SIGMA;
  // Observed tie rate (incl. shootouts), blended toward 12% when the sample is small.
  const ties = G.filter(({ d }) => d === 0).length;
  const tieRate = (ties + 0.12 * 50) / (G.length + 50);

  const byId = new Map(rows.map(r => [r.id, r]));
  const gameInfo = new Map();
  G.forEach(({ g, d }, k) => gameInfo.set(g.id, { d, counted: !excl[k] }));

  const oddsSpread = Number(settings.oddsSpread) > 0 ? Number(settings.oddsSpread) : 1;
  return { rows, byId, gameInfo, offset, settings: { goalCap: cap, blowoutGap: gap, minGames, sigma, tieRate, sampleGames: m, oddsSpread } };
}

module.exports = { computeRatings };
