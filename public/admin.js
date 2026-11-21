let teams = [], games = [], parsed = null;

function flash(text, kind = 'ok') {
  $('#msg').innerHTML = `<div class="notice ${kind}">${esc(text)}</div>`;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { $('#msg').innerHTML = ''; }, 6000);
}
const fail = e => flash(e.message, 'err');

// Two-click confirm for destructive buttons (avoids browser dialogs).
function confirmClick(btn, action) {
  if (btn.dataset.armed) { action(); return; }
  btn.dataset.armed = '1'; const old = btn.textContent; btn.textContent = 'Click again to confirm';
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = old; }, 3000);
}

async function boot() {
  const { admin } = await api('/api/me');
  $('#login').hidden = admin; $('#app').hidden = !admin;
  if (admin) await refresh();
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { await api('/api/login', { method: 'POST', body: { password: $('#pw').value } }); await boot(); applyPendingImport(); }
  catch (err) { $('#loginMsg').innerHTML = `<div class="notice err">${esc(err.message)}</div>`; }
});
$('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); boot(); });

$$('#tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(tab) {
  $$('#tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab; });
}

async function refresh() {
  [teams, games] = await Promise.all([api('/api/teams'), api('/api/admin/games')]);
  const uniq = k => [...new Set(teams.map(t => t[k]).filter(Boolean))].sort();
  $('#leagueList').innerHTML = uniq('league').map(v => `<option>${esc(v)}</option>`).join('');
  $('#assocList').innerHTML = uniq('association').map(v => `<option>${esc(v)}</option>`).join('');
  const opts = '<option value="">Choose team</option>' + teams.map(t => `<option value="${esc(t.id)}">${esc(t.name)}${t.tier ? ' (' + esc(t.tier) + ')' : ''}</option>`).join('');
  const keep = [$('#gHome').value, $('#gAway').value];
  $('#gHome').innerHTML = opts; $('#gAway').innerHTML = opts;
  $('#gHome').value = keep[0]; $('#gAway').value = keep[1];
  renderGames(); renderTeams(); loadSettings();
}

// ---------- import ----------
$('#previewBtn').addEventListener('click', async () => {
  const text = $('#pasteText').value;
  if (!text.trim()) return flash('Paste some results first.', 'err');
  try {
    parsed = await api('/api/admin/import/parse', { method: 'POST', body: { text, defaultDate: $('#impDate').value || undefined } });
    renderPreview();
  } catch (e) { fail(e); }
});

function renderPreview() {
  const { rows, unmatched } = parsed;
  const good = rows.filter(r => !r.error && !r.duplicate).length;
  const dup = rows.filter(r => r.duplicate).length;
  const err = rows.filter(r => r.error).length;
  const teamOpts = teams.map(t => `<option value="${esc(t.id)}">${esc(t.name)}${t.tier ? ' (' + esc(t.tier) + ')' : ''}</option>`).join('');
  $('#preview').innerHTML = `
    <h2>Preview</h2>
    <p>${good} new game(s) ready · ${dup} already entered · ${err} line(s) skipped</p>
    ${unmatched.length ? `
      <div class="card pad" style="margin-bottom:14px">
        <strong>${unmatched.length} team name(s) not recognised.</strong>
        <span class="muted small">Create them as new teams, or match them to a team you already have (the name is remembered for next time).</span>
        <div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Name in pasted text</th><th>Action</th><th>Tier</th><th>League</th></tr></thead><tbody>
        ${unmatched.map((u, i) => `
          <tr data-un="${i}">
            <td>${esc(u.name)}</td>
            <td><select class="un-act">
              <option value="new">Create new team</option>
              <option value="skip">Skip games with this team</option>
              <optgroup label="Same team as…">${teamOpts}</optgroup>
            </select>${u.suggestion ? `<div class="small muted">Possible match: ${esc(u.suggestion.name)}</div>` : ''}</td>
            <td><input class="un-tier" list="tierList" value="${esc($('#impTier').value)}" size="5"></td>
            <td><input class="un-league" list="leagueList" value="${esc($('#impLeague').value)}"></td>
          </tr>`).join('')}
        </tbody></table></div>
      </div>` : ''}
    <div class="card table-wrap"><table>
      <thead><tr><th><input type="checkbox" id="pvAll" checked></th><th>Date</th><th>Team 1</th><th class="num">Score</th><th>Team 2</th><th>Status</th></tr></thead>
      <tbody>${rows.map((r, i) => r.error ? `
        <tr class="not-counted"><td></td><td colspan="4" class="small" style="white-space:normal">${esc(r.line)}</td><td class="small">${esc(r.error)}</td></tr>` : `
        <tr><td><input type="checkbox" class="pv" data-i="${i}" ${r.duplicate ? '' : 'checked'}></td>
          <td>${esc(r.date)}</td><td>${esc(r.home)}${r.homeId ? '' : ' <span class="pill">new</span>'}</td>
          <td class="num">${r.homeScore}-${r.awayScore}${r.shootout ? ' SO' : ''}</td>
          <td>${esc(r.away)}${r.awayId ? '' : ' <span class="pill">new</span>'}</td>
          <td class="small ${r.duplicate ? 'muted' : 'pos'}">${r.duplicate ? 'Already entered' : 'Ready'}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="toolbar" style="margin-top:14px"><button class="primary" id="commitBtn">Import selected games</button></div>`;

  // Suggestions are shown but never preselected: across leagues, similar names are often
  // different teams (e.g. "Shallow Lake Lakers" vs "Wallaceburg Lakers").
  $('#pvAll').addEventListener('change', e => $$('.pv').forEach(c => { c.checked = e.target.checked; }));
  $('#commitBtn').addEventListener('click', commitImport);
}

async function commitImport() {
  const norm = s => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const resolutions = {};
  parsed.unmatched.forEach((u, i) => {
    const row = $(`[data-un="${i}"]`);
    const act = $('.un-act', row).value;
    const key = norm(u.name);
    if (act === 'skip') resolutions[key] = { skip: true };
    else if (act === 'new') resolutions[key] = { tier: $('.un-tier', row).value.trim(), league: $('.un-league', row).value.trim() };
    else resolutions[key] = { mapTo: act };
  });
  const rows = $$('.pv').filter(c => c.checked).map(c => ({ ...parsed.rows[+c.dataset.i], type: $('#impType').value }));
  if (!rows.length) return flash('No games selected.', 'err');
  try {
    const r = await api('/api/admin/import/commit', { method: 'POST', body: { rows, resolutions, defaults: { type: $('#impType').value, tier: $('#impTier').value, league: $('#impLeague').value } } });
    flash(`Imported ${r.added} game(s), created ${r.createdTeams} team(s), skipped ${r.skipped}.`);
    $('#preview').innerHTML = ''; $('#pasteText').value = ''; parsed = null;
    await refresh();
  } catch (e) { fail(e); }
}

// ---------- add / edit game ----------
$('#gDate').value = new Date().toLocaleDateString('en-CA');
$('#gameForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = { date: $('#gDate').value, homeId: $('#gHome').value, awayId: $('#gAway').value, homeScore: +$('#gHs').value, awayScore: +$('#gAs').value, shootout: $('#gSo').checked, type: $('#gType').value };
  const id = $('#gId').value;
  try {
    if (id) await api('/api/admin/games/' + id, { method: 'PUT', body });
    else await api('/api/admin/games', { method: 'POST', body });
    flash(id ? 'Game updated.' : 'Game saved.');
    resetGameForm(); await refresh();
  } catch (err) { fail(err); }
});
function resetGameForm() {
  $('#gId').value = ''; $('#gHs').value = ''; $('#gAs').value = ''; $('#gSo').checked = false;
  $('#gSubmit').textContent = 'Save game'; $('#gCancel').hidden = true;
}
$('#gCancel').addEventListener('click', resetGameForm);

// ---------- games list ----------
$('#gSearch').addEventListener('input', renderGames);
function renderGames() {
  const q = $('#gSearch').value.trim().toLowerCase();
  const list = games.filter(g => !q || `${g.date} ${g.homeName} ${g.awayName}`.toLowerCase().includes(q));
  $('#gCount').textContent = `${list.length} of ${games.length} games`;
  $('#gamesBody').innerHTML = list.slice(0, 500).map(g => `
    <tr data-id="${esc(g.id)}">
      <td>${esc(g.date)}</td><td>${esc(g.homeName || '?')}</td>
      <td class="num">${g.homeScore}-${g.awayScore}${g.shootout ? ' SO' : ''}</td>
      <td>${esc(g.awayName || '?')}</td><td class="hide-sm muted">${esc(g.type)}</td><td class="hide-sm muted">${esc(g.source || '')}</td>
      <td><button class="edit">Edit</button> <button class="danger del">Delete</button></td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">No games.</td></tr>';
  $$('#gamesBody .del').forEach(b => b.addEventListener('click', () => confirmClick(b, async () => {
    try { await api('/api/admin/games/' + b.closest('tr').dataset.id, { method: 'DELETE' }); flash('Game deleted.'); await refresh(); } catch (e) { fail(e); }
  })));
  $$('#gamesBody .edit').forEach(b => b.addEventListener('click', () => {
    const g = games.find(x => x.id === b.closest('tr').dataset.id);
    $('#gId').value = g.id; $('#gDate').value = g.date; $('#gHome').value = g.homeId; $('#gAway').value = g.awayId;
    $('#gHs').value = g.homeScore; $('#gAs').value = g.awayScore; $('#gSo').checked = !!g.shootout; $('#gType').value = g.type;
    $('#gSubmit').textContent = 'Update game'; $('#gCancel').hidden = false;
    showTab('add');
  }));
}

// ---------- teams ----------
$('#teamForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('/api/admin/teams', { method: 'POST', body: { name: $('#tName').value, association: $('#tAssoc').value, tier: $('#tTier').value, league: $('#tLeague').value } });
    flash('Team added.'); $('#tName').value = ''; await refresh();
  } catch (err) { fail(err); }
});
$('#tSearch').addEventListener('input', renderTeams);
function renderTeams() {
  const q = $('#tSearch').value.trim().toLowerCase();
  const list = teams.filter(t => !q || `${t.name} ${t.association} ${t.league}`.toLowerCase().includes(q));
  const opts = teams.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  $('#teamsBody').innerHTML = list.map(t => `
    <tr data-id="${esc(t.id)}">
      <td><input class="f-name" value="${esc(t.name)}" title="${esc((t.aliases || []).length ? 'Also known as: ' + t.aliases.join(', ') : '')}"></td>
      <td><input class="f-association" value="${esc(t.association)}" list="assocList"></td>
      <td><input class="f-tier" value="${esc(t.tier)}" list="tierList" size="5"></td>
      <td><input class="f-league" value="${esc(t.league)}" list="leagueList"></td>
      <td class="num">${t.gp || 0}</td>
      <td><button class="save">Save</button> ${t.gp ? '' : '<button class="danger tdel">Delete</button>'}</td>
      <td><select class="merge-into"><option value="">Choose</option>${opts}</select> <button class="merge">Merge</button></td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">No teams yet.</td></tr>';
  $$('#teamsBody .save').forEach(b => b.addEventListener('click', async () => {
    const tr = b.closest('tr');
    const body = {}; ['name', 'association', 'tier', 'league'].forEach(k => { body[k] = $('.f-' + k, tr).value; });
    try { await api('/api/admin/teams/' + tr.dataset.id, { method: 'PUT', body }); flash('Team saved.'); await refresh(); } catch (e) { fail(e); }
  }));
  $$('#teamsBody .tdel').forEach(b => b.addEventListener('click', () => confirmClick(b, async () => {
    try { await api('/api/admin/teams/' + b.closest('tr').dataset.id, { method: 'DELETE' }); flash('Team deleted.'); await refresh(); } catch (e) { fail(e); }
  })));
  $$('#teamsBody .merge').forEach(b => b.addEventListener('click', () => {
    const tr = b.closest('tr'); const intoId = $('.merge-into', tr).value;
    if (!intoId) return flash('Choose the team to merge into.', 'err');
    confirmClick(b, async () => {
      try { const t = await api(`/api/admin/teams/${tr.dataset.id}/merge`, { method: 'POST', body: { intoId } }); flash(`Merged into ${t.name}.`); await refresh(); } catch (e) { fail(e); }
    });
  }));
}

// ---------- settings ----------
async function loadSettings() {
  const s = await api('/api/admin/settings');
  $('#sSeason').value = s.season; $('#sMin').value = s.minGames; $('#sCap').value = s.goalCap; $('#sGap').value = s.blowoutGap; $('#sSpread').value = s.oddsSpread ?? 1;
}
$('#settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('/api/admin/settings', { method: 'PUT', body: { season: $('#sSeason').value, minGames: $('#sMin').value, goalCap: $('#sCap').value, blowoutGap: $('#sGap').value, oddsSpread: $('#sSpread').value } });
    flash('Settings saved. Ratings recalculated.');
  } catch (err) { fail(err); }
});

$('#restoreBtn').addEventListener('click', () => {
  const file = $('#restoreFile').files[0];
  if (!file) return flash('Choose a backup file first.', 'err');
  confirmClick($('#restoreBtn'), async () => {
    try {
      const data = JSON.parse(await file.text());
      const r = await api('/api/admin/restore', { method: 'POST', body: data });
      flash(`Restored ${r.teams} teams and ${r.games} games. Previous data saved as ${r.previousSavedAs}.`);
      $('#restoreFile').value = '';
      await refresh();
    } catch (e) { fail(e instanceof SyntaxError ? new Error('That file is not valid JSON.') : e); }
  });
});

// ---------- bookmarklet ----------
fetch('/bookmarklet.src.js').then(r => r.text()).then(src => {
  const code = src.replace(/^\/\*[\s\S]*?\*\/\s*/, '').replace('__TARGET__', location.origin);
  $('#bmLink').href = 'javascript:' + encodeURIComponent(code);
}).catch(() => {});

// Games sent from a league site by the bookmarklet arrive via postMessage.
let pendingImport = null, importReceived = false;
function applyPendingImport() {
  if (!pendingImport) return;
  if ($('#app').hidden) {
    $('#loginMsg').innerHTML = `<div class="notice ok">${pendingImport.count} results from ${esc(pendingImport.source)} are waiting. Log in to review them.</div>`;
    return;
  }
  const p = pendingImport; pendingImport = null;
  showTab('import');
  $('#pasteText').value = p.csv;
  if (p.league && !$('#impLeague').value) $('#impLeague').value = p.league;
  flash(`Received ${p.count} results from ${p.source}. Check the preview, then press Import.`);
  $('#previewBtn').click();
}
if (new URLSearchParams(location.search).get('import') && window.opener) {
  flash('Waiting for results from the league site...');
  window.addEventListener('message', e => {
    const d = e.data;
    if (e.source !== window.opener || !d || d.type !== 'u21-import' || typeof d.csv !== 'string' || d.csv.length > 2e6) return;
    window.opener.postMessage({ type: 'u21-ack' }, e.origin);
    if (importReceived) return; // bookmarklet retries until acked
    importReceived = true;
    pendingImport = { csv: d.csv, league: String(d.league || '').slice(0, 120), source: String(d.source || 'league site').slice(0, 100), count: +d.count || 0 };
    applyPendingImport();
  });
  history.replaceState(null, '', '/admin');
}

boot().then(applyPendingImport).catch(fail);
