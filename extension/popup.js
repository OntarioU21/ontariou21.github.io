const status = document.getElementById('status');
const btn = document.getElementById('run');

function show(last) {
  if (!last) { status.textContent = 'No runs yet.'; return; }
  const when = new Date(last.at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
  const s = last.summary;
  const lines = [`Last run: ${when}`];
  if (s && !s.error) {
    lines.push(`${s.added} new game(s)${s.pending ? `, ${s.pending} held for review (new team name)` : ''}${s.published ? ', site published' : ''}.`);
    if (s.publishError) lines.push(`Publish failed: ${s.publishError}`);
  }
  status.innerHTML = '';
  status.append(lines.join('\n'));
  const probs = [...(last.blocked || []).map(h => `${h} needs a human check (tab left open)`), ...(last.errors || [])];
  if (probs.length) {
    const p = document.createElement('div');
    p.className = 'bad';
    p.textContent = probs.join('\n');
    status.append(p);
  }
}

chrome.storage.local.get('last').then(({ last }) => show(last));
btn.addEventListener('click', async () => {
  btn.disabled = true; btn.textContent = 'Running… (about a minute)';
  const last = await chrome.runtime.sendMessage({ type: 'run-now' });
  btn.disabled = false; btn.textContent = 'Run now';
  if (last && last.error) status.textContent = last.error; else show(last);
});
