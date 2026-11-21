// Shared helpers + header/footer for every page.
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '-' : v.toFixed(d));
const signed = (v, d = 2) => (v == null || !Number.isFinite(v) ? '-' : (v > 0 ? '+' : '') + v.toFixed(d));
const cls = v => (v > 0.005 ? 'pos' : v < -0.005 ? 'neg' : '');
const record = t => `${t.w}-${t.l}-${t.t}`;
const fmtDate = d => (d ? new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

// ---------- odds ----------
// Goal margin ~ Normal(rating gap, sigma). A margin inside +/- w is a tie, with w set so a
// game between equal teams ties at the league's observed tie rate (shootouts count as ties).
function normCdf(x) {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}
function tieBand(sigma, tieRate) {
  let lo = 0, hi = 5 * sigma;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (2 * normCdf(mid / sigma) - 1 < tieRate) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
// gamesA / gamesB: games each rating is based on. A rating from 5 games is shakier than one
// from 20, so the prediction's spread grows by sqrt(1 + 1/gamesA + 1/gamesB).
function matchOdds(diff, settings, gamesA, gamesB) {
  const unc = Math.sqrt(1 + (gamesA > 0 ? 1 / gamesA : 0.5) + (gamesB > 0 ? 1 / gamesB : 0.5));
  const s = (settings.sigma || 2.6) * (settings.oddsSpread || 1) * unc;
  const w = tieBand(s, settings.tieRate ?? 0.12);
  const win = 1 - normCdf((w - diff) / s);
  const loss = normCdf((-w - diff) / s);
  const tie = Math.max(0, 1 - win - loss);
  return { win, tie, loss, twoWay: win / (win + loss) }; // twoWay: tie = push / no action
}
// American odds from a probability. vig (e.g. 0.045) is the total bookmaker margin, split evenly
// across the n outcomes so implied probabilities sum to 1 + vig.
function american(p, vig = 0, n = 2) {
  p = Math.min(0.999, Math.max(0.001, p + vig / n));
  const raw = p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
  const r = Math.abs(raw) >= 200 ? Math.round(raw / 5) * 5 : Math.round(raw);
  if (r === -100) return 'EVEN';
  return Math.abs(r) >= 10000 ? (r > 0 ? '+10000' : '-10000') : (r > 0 ? '+' : '') + r;
}
const pct = p => (p * 100).toFixed(p > 0.995 || p < 0.005 ? 1 : 0) + '%';

function renderChrome() {
  const page = document.body.dataset.page;
  const links = [['index', '/', 'Rankings'], ['predict', '/predict', 'Game Predictor'], ['method', '/method', 'How It Works'], ['admin', '/admin', 'Admin']];
  document.body.insertAdjacentHTML('afterbegin', `
    <header class="site-header"><div class="inner">
      <a class="logo" href="/"><span class="puck">U21</span>Ontario U21 Rankings</a>
      <nav>${links.map(([k, href, label]) => `<a href="${href}" class="${k === page ? 'active' : ''}">${label}</a>`).join('')}</nav>
    </div></header>`);
  document.body.insertAdjacentHTML('beforeend', `
    <footer>Independent computer rankings of OMHA U21 teams. Not affiliated with or endorsed by the OMHA or any league.
    Ratings come only from final scores entered on this site.</footer>`);
}
renderChrome();
