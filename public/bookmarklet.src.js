/* "Send to Rankings" bookmarklet.
 * Runs on an OMHA league "Schedule & Results" page (e.g. beechey.ca/Schedule/) in the
 * user's own browser. Reads the games on that page and the other month pages linked
 * from it, then hands them to the rankings admin import screen as CSV.
 * __TARGET__ is replaced with the rankings site's origin when the link is built.
 */
(async () => {
  const TARGET = '__TARGET__';
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const MONTH_RE = /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})$/i;
  const U21_RE = /\bu\s?-?21|\bunder\s?-?21|juvenile|\bjuv\b/i; // "U21", "U-21", "U21LL", "Under 21", "Juvenile"

  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;background:#0f2a52;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:14px 18px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);max-width:340px';
  const say = (t) => { box.textContent = t; };
  document.body.appendChild(box);
  const done = (t) => { say(t); setTimeout(() => box.remove(), 6000); };

  if (!document.querySelector('.game_score')) {
    done('No games found here. Open the league\'s "Schedule & Results" page, then click Send to Rankings again.');
    return;
  }
  // Open the rankings window now, while the click still counts as a user action
  // (otherwise popup blockers stop it after the page fetches below).
  const win = window.open(TARGET + '/admin?import=1', 'u21import');
  if (!win) { done('Your browser blocked the popup. Allow popups for this site and try again.'); return; }

  const pad = (n) => String(n).padStart(2, '0');
  // Page titles look like "Schedule & Results (Shamrock Hockey League)".
  const SITE = ((document.title.match(/\(([^)]+)\)\s*$/) || [])[1] || location.hostname).replace(/^OMHA\s+/i, '').trim();
  // Division labels are often just "U21"; prefix the league unless it's already named.
  const divisionName = (g) => (!g || /league|juvenile/i.test(g) ? g : `${SITE} • ${g}`);

  function parseDoc(doc, url) {
    const u = new URL(url);
    let fallback = null;
    if (u.searchParams.get('Month') && u.searchParams.get('Year')) fallback = { m: +u.searchParams.get('Month'), y: +u.searchParams.get('Year') };
    const heads = [...doc.querySelectorAll('body *')].filter((e) => MONTH_RE.test(e.textContent.trim()) && ![...e.children].some((c) => MONTH_RE.test(c.textContent.trim())));
    const rows = [...doc.querySelectorAll('.game_score')].map((s) => s.closest('.grid-x')).filter(Boolean);
    const items = [...heads.map((h) => ({ h })), ...rows.map((r) => ({ r }))]
      .sort((a, b) => ((a.h || a.r).compareDocumentPosition(b.h || b.r) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    let cur = fallback;
    const out = [];
    for (const it of items) {
      if (it.h) {
        const m = it.h.textContent.trim().match(MONTH_RE);
        cur = { m: MONTHS.indexOf(m[1].toLowerCase()) + 1, y: +m[2] };
        continue;
      }
      const r = it.r;
      const score = (r.querySelector('.game_score')?.textContent || '').trim();
      const sm = score.match(/^(\d+)\s*-\s*(\d+)/);
      if (!sm || !cur) continue; // unplayed game, or no month known
      const day = +(r.querySelector('.day_of_month')?.textContent.match(/(\d{1,2})\s*$/) || [])[1];
      const visitor = r.querySelector('.subject-owner')?.textContent.trim();
      const homeEl = r.querySelector('.subject-text');
      const home = homeEl ? [...homeEl.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/^\s*@\s*/, '').replace(/\s+/g, ' ').trim() : '';
      if (!day || !visitor || !home) continue;
      const result = (r.querySelector('.game_result')?.textContent || '') + ' ' + score;
      const tag = (r.querySelector('.tag')?.textContent || '').toLowerCase();
      out.push({
        date: `${cur.y}-${pad(cur.m)}-${pad(day)}`,
        home, away: visitor,
        homeScore: +sm[2], awayScore: +sm[1], // site shows visitor-home
        shootout: /\b(so|s\/o|shoot)/i.test(result),
        type: /playoff/.test(tag) ? 'playoff' : /exhib/.test(tag) ? 'exhibition' : /tourn/.test(tag) ? 'tournament' : 'league',
        group: divisionName(r.querySelector('.subject-group')?.textContent.trim() || ''),
      });
    }
    const monthLinks = [...doc.querySelectorAll('a[href]')]
      .map((a) => { try { return new URL(a.getAttribute('href'), url); } catch { return null; } })
      .filter((x) => x && x.origin === location.origin && x.searchParams.has('Month') && x.searchParams.has('Year'))
      .map((x) => x.href);
    return { games: out, monthLinks };
  }

  try {
    // Month pages link to their neighbours, so a crawl could slide into other seasons.
    // Only follow months inside the season of the page we started on (Aug to Jul).
    const ym = (l) => { const u = new URL(l); return +u.searchParams.get('Year') * 12 + (+u.searchParams.get('Month') - 1); };
    const first = parseDoc(document, location.href);
    const startDate = first.games[0]?.date || new Date().toISOString().slice(0, 10);
    const sy = +startDate.slice(0, 4), sm = +startDate.slice(5, 7);
    const seasonStart = (sm >= 8 ? sy : sy - 1) * 12 + 7; // August
    const inSeason = (k) => k >= seasonStart && k < seasonStart + 12;
    const seenMonths = new Set([sy * 12 + sm - 1]);
    const queue = [];
    const enqueue = (links) => links.forEach((l) => { const k = ym(l); if (inSeason(k) && !seenMonths.has(k)) { seenMonths.add(k); queue.push(l); } });
    let games = first.games;
    enqueue(first.monthLinks);
    let n = 1;
    while (queue.length && n < 13) {
      const url = queue.shift();
      n++;
      say(`Reading month ${n}... (${games.length} results so far)`);
      const html = await fetch(url, { credentials: 'include' }).then((r) => r.text());
      const res = parseDoc(new DOMParser().parseFromString(html, 'text/html'), url);
      games = games.concat(res.games);
      enqueue(res.monthLinks);
      await new Promise((r) => setTimeout(r, 250));
    }
    const uniq = new Map();
    for (const g of games) uniq.set([g.date, g.home, g.away, g.homeScore, g.awayScore].join('|'), g);
    games = [...uniq.values()].sort((a, b) => a.date.localeCompare(b.date));
    // League sites that run every age group: keep only U21 / Juvenile games.
    const total = games.length;
    // Rep teams only: skip local league / house league divisions.
    const LL_RE = /local league|\bu21\s?ll\b|\bnpll\b|\bll\b|house/i;
    games = games.filter((g) => U21_RE.test(g.group) && !LL_RE.test(g.group));
    if (!games.length) {
      done(total ? `Found ${total} results, but none are U21 rep games (local league games are skipped).` : 'No final scores found yet.');
      try { win.close(); } catch {}
      return;
    }

    const q = (s) => (/[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s));
    const csv = ['date,home,home_score,away,away_score,shootout,type,division']
      .concat(games.map((g) => [g.date, g.home, g.homeScore, g.away, g.awayScore, g.shootout ? 'yes' : '', g.type, g.group].map(q).join(',')))
      .join('\n');
    const groups = [...new Set(games.map((g) => g.group).filter(Boolean))];
    const payload = { type: 'u21-import', csv, league: groups.length === 1 ? groups[0] : '', source: location.hostname, count: games.length };

    say(`Found ${games.length} results across ${n} page(s). Sending to the rankings site...`);
    let acked = false;
    window.addEventListener('message', (e) => {
      if (e.source === win && e.data && e.data.type === 'u21-ack') acked = true;
    });
    for (let i = 0; i < 40 && !acked; i++) {
      try { win.postMessage(payload, TARGET); } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    done(acked ? `Sent ${games.length} results. Review and import them in the rankings tab.` : 'Could not reach the rankings tab. Make sure it opened, then try again.');
  } catch (err) {
    done('Something went wrong: ' + err.message);
  }
})();
