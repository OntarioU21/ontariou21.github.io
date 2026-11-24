// Nightly import: opens each league's Schedule page in a background tab of your own Chrome,
// reads the final scores, and sends them to the rankings server on this computer, which
// imports new games (known teams only) and republishes the public site.
// It never answers a Cloudflare or "verify you're human" check. If a site asks for one, the
// tab is left open, the icon shows "!", and the next run picks up the missed games.

const LEAGUES = [
  'https://beechey.ca/Schedule/',
  'https://woaa.on.ca/Schedule/',
  'https://shamrockhockeyleague.ca/Schedule/',
  'https://eomhl.ca/Schedule/',
];
const SERVER = 'http://localhost:4700';
const RUN_AT = { hour: 23, minute: 30 }; // local time
const CHECK_RE = /just a moment|human verification|attention required|verify you are human/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function nextRunTime() {
  const d = new Date();
  d.setHours(RUN_AT.hour, RUN_AT.minute, 0, 0);
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  return d.getTime();
}
function lastScheduledTime() { return nextRunTime() - 24 * 3600 * 1000; }
// One-shot alarm, re-armed for the next 11:30 PM after every run, so a late run (PC asleep)
// never shifts the schedule.
async function schedule() {
  await chrome.alarms.clear('nightly');
  chrome.alarms.create('nightly', { when: nextRunTime() });
  // Every minute: ask the local server whether the Windows nightly task wants a run.
  const pa = await chrome.alarms.get('poll');
  if (!pa || pa.periodInMinutes !== 1) chrome.alarms.create('poll', { periodInMinutes: 1, delayInMinutes: 1 });
}
// If the last 11:30 PM run was missed (Chrome closed or PC asleep), catch up shortly.
async function catchUp() {
  const { last } = await chrome.storage.local.get('last');
  if (!last || last.at < lastScheduledTime()) chrome.alarms.create('catchup', { delayInMinutes: 1 });
}
async function poll() {
  const { last } = await chrome.storage.local.get('last');
  if (last && Date.now() - last.at < 20 * 60 * 1000) return; // just ran
  try {
    const r = await fetch(SERVER + '/api/auto/wanted', { headers: { 'X-U21-Auto': '1' } });
    if (r.ok && (await r.json()).run) run('task');
  } catch {} // server not running; the nightly task starts it
}
chrome.runtime.onInstalled.addListener(() => { schedule(); catchUp(); });
chrome.runtime.onStartup.addListener(() => { schedule(); catchUp(); });
chrome.alarms.onAlarm.addListener(a => {
  if (a.name === 'poll') { poll(); return; }
  if (a.name === 'nightly') schedule();
  if (['nightly', 'catchup', 'retry'].includes(a.name)) run(a.name);
});
// Service workers can be restarted at any time; make sure the alarms always exist.
chrome.alarms.get('nightly').then(a => { if (!a) schedule(); });
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg && msg.type === 'run-now') { run('manual').then(reply); return true; }
});

async function waitForTab(tabId, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) return 'closed';
    if (t.status === 'complete' && !CHECK_RE.test(t.title || '')) return 'ok';
    await sleep(3000);
  }
  return 'check';
}

let running = false;
async function run(reason) {
  if (running) return { error: 'Already running' };
  running = true;
  const leagues = [], blocked = [], errors = [];
  try {
    chrome.action.setBadgeText({ text: '…' });
    for (const url of LEAGUES) {
      const host = new URL(url).hostname;
      let tab;
      try {
        tab = await chrome.tabs.create({ url, active: false });
        // Real browsers usually pass Cloudflare on their own within a few seconds.
        const state = await waitForTab(tab.id, 75000);
        if (state !== 'ok') { blocked.push(host); tab = null; continue; } // leave it open for you
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrapeSchedule });
        if (result && result.error) errors.push(`${host}: ${result.error}`);
        else if (result) leagues.push({ source: host, csv: result.csv, count: result.count });
      } catch (e) {
        errors.push(`${host}: ${e.message}`);
      } finally {
        if (tab) chrome.tabs.remove(tab.id).catch(() => {});
      }
    }
    let summary = null;
    try {
      const res = await fetch(SERVER + '/api/auto/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-U21-Auto': '1' },
        body: JSON.stringify({ leagues, blocked }),
      });
      summary = await res.json();
      if (!res.ok) throw new Error(summary.error || `Server said ${res.status}`);
    } catch (e) {
      errors.push(`Rankings server: ${e.message === 'Failed to fetch' ? 'not running on this computer' : e.message}`);
      chrome.alarms.create('retry', { delayInMinutes: 30 }); // try again later tonight
    }
    const record = { at: Date.now(), reason, blocked, errors, summary };
    await chrome.storage.local.set({ last: record, ...(errors.length ? {} : { lastOk: Date.now() }) });
    const problem = blocked.length || errors.length;
    chrome.action.setBadgeText({ text: problem ? '!' : '' });
    chrome.action.setBadgeBackgroundColor({ color: problem ? '#c0392b' : '#1e7d3a' });
    if (blocked.length) {
      chrome.notifications.create('u21-check', {
        type: 'basic', iconUrl: 'icon.png', title: 'U21 Rankings: human check needed',
        message: `${blocked.join(', ')} asked for a verification. Its tab is open; complete it and press "Run now" in the extension.`,
      });
    } else if (errors.length) {
      chrome.notifications.create('u21-error', { type: 'basic', iconUrl: 'icon.png', title: 'U21 Rankings import problem', message: errors.join('\n').slice(0, 250) });
    }
    return record;
  } finally {
    running = false;
  }
}

// Runs inside the league's Schedule page. Reads the month shown (and, early in a month, the
// previous month too) and returns U21 rep games as CSV. Same rules as the bookmarklet.
async function scrapeSchedule() {
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const MONTH_RE = /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})$/i;
  const U21_RE = /\bu\s?-?21|\bunder\s?-?21|juvenile|\bjuv\b/i;
  const LL_RE = /local league|\bu21\s?ll\b|\bnpll\b|\bll\b|house/i;
  const SITE = ((document.title.match(/\(([^)]+)\)\s*$/) || [])[1] || location.hostname).replace(/^OMHA\s+/i, '').trim();
  const divisionName = g => (!g || /league|juvenile/i.test(g) ? g : `${SITE} • ${g}`);
  const pad = n => String(n).padStart(2, '0');
  if (!document.querySelector('.game_score') && !document.querySelector('.day_of_month')) return { error: 'no schedule found on the page' };

  function parseDoc(doc, url) {
    const u = new URL(url);
    let cur = u.searchParams.get('Month') ? { m: +u.searchParams.get('Month'), y: +u.searchParams.get('Year') } : null;
    const heads = [...doc.querySelectorAll('body *')].filter(e => MONTH_RE.test(e.textContent.trim()) && ![...e.children].some(c => MONTH_RE.test(c.textContent.trim())));
    const rows = [...doc.querySelectorAll('.game_score')].map(s => s.closest('.grid-x')).filter(Boolean);
    const items = [...heads.map(h => ({ h })), ...rows.map(r => ({ r }))]
      .sort((a, b) => ((a.h || a.r).compareDocumentPosition(b.h || b.r) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const out = [];
    for (const it of items) {
      if (it.h) { const m = it.h.textContent.trim().match(MONTH_RE); cur = { m: MONTHS.indexOf(m[1].toLowerCase()) + 1, y: +m[2] }; continue; }
      const r = it.r;
      const score = (r.querySelector('.game_score')?.textContent || '').trim();
      const sm = score.match(/^(\d+)\s*-\s*(\d+)/);
      if (!sm || !cur) continue;
      const day = +(r.querySelector('.day_of_month')?.textContent.match(/(\d{1,2})\s*$/) || [])[1];
      const visitor = r.querySelector('.subject-owner')?.textContent.trim();
      const homeEl = r.querySelector('.subject-text');
      const home = homeEl ? [...homeEl.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').replace(/^\s*@\s*/, '').replace(/\s+/g, ' ').trim() : '';
      if (!day || !visitor || !home) continue;
      const result = (r.querySelector('.game_result')?.textContent || '') + ' ' + score;
      const tag = (r.querySelector('.tag')?.textContent || '').toLowerCase();
      out.push({
        date: `${cur.y}-${pad(cur.m)}-${pad(day)}`, home, away: visitor,
        homeScore: +sm[2], awayScore: +sm[1], // site shows visitor-home
        shootout: /\b(so|s\/o|shoot)/i.test(result),
        type: /playoff|championship/.test(tag) ? 'playoff' : /exhib/.test(tag) ? 'exhibition' : /tourn/.test(tag) ? 'tournament' : 'league',
        group: divisionName(r.querySelector('.subject-group')?.textContent.trim() || ''),
      });
    }
    return out;
  }

  let games = parseDoc(document, location.href);
  const now = new Date();
  if (now.getDate() <= 3) { // catch the last games of the previous month
    const p = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const url = `${location.origin}${location.pathname}?Month=${p.getMonth() + 1}&Year=${p.getFullYear()}`;
    try {
      const html = await fetch(url, { credentials: 'include' }).then(r => r.text());
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (!/human verification|just a moment/i.test(doc.title)) games = games.concat(parseDoc(doc, url));
    } catch {}
  }
  const uniq = new Map();
  for (const g of games) uniq.set([g.date, g.home, g.away, g.homeScore, g.awayScore].join('|'), g);
  games = [...uniq.values()].filter(g => U21_RE.test(g.group) && !LL_RE.test(g.group));
  const q = s => (/[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s));
  const csv = ['date,home,home_score,away,away_score,shootout,type,division']
    .concat(games.map(g => [g.date, g.home, g.homeScore, g.away, g.awayScore, g.shootout ? 'yes' : '', g.type, g.group].map(q).join(',')))
    .join('\n');
  return { csv, count: games.length };
}
