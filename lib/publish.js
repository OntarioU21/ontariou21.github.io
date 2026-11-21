'use strict';
// Builds the public, read-only site (rankings, team pages, predictor, method) with the
// data baked in as JSON, and pushes it to the gh-pages branch for GitHub Pages.
// The admin console, data file and bookmarklet are never published.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { rankingsPayload, teamPayload } = require('./views');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, '.publish'); // git worktree checked out on gh-pages
const BRANCH = 'gh-pages';
const PAGES = ['index.html', 'team.html', 'predict.html', 'method.html'];
const ASSETS = ['styles.css', 'app.js'];

function git(args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]} failed: ${(stderr || err.message).trim()}`));
      else resolve(stdout.trim());
    });
  });
}

function pagesUrl(remote) {
  const m = remote.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  return m ? `https://${m[1].toLowerCase()}.github.io/${m[2]}/` : null;
}

// Write the static site into `dir`, replacing everything except git's own files.
function build(dir, db, r) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git') continue;
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
  for (const page of PAGES) {
    let html = fs.readFileSync(path.join(PUBLIC, page), 'utf8');
    html = html.replace('<script src="app.js"></script>', '<script src="config.js"></script>\n<script src="app.js"></script>');
    fs.writeFileSync(path.join(dir, page), html);
  }
  for (const a of ASSETS) fs.copyFileSync(path.join(PUBLIC, a), path.join(dir, a));
  fs.writeFileSync(path.join(dir, 'config.js'), 'window.STATIC_SITE = true;\n');
  fs.writeFileSync(path.join(dir, '.nojekyll'), ''); // serve files as-is
  fs.mkdirSync(path.join(dir, 'data', 'teams'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'rankings.json'), JSON.stringify(rankingsPayload(db, r)));
  for (const t of db.teams) {
    fs.writeFileSync(path.join(dir, 'data', 'teams', `${t.id}.json`), JSON.stringify(teamPayload(db, r, t.id)));
  }
  return { teams: db.teams.length, games: db.games.length };
}

async function ensureWorktree() {
  if (fs.existsSync(path.join(OUT, '.git'))) return;
  await git(['worktree', 'prune']);
  const local = await git(['rev-parse', '--verify', '--quiet', BRANCH]).then(() => true, () => false);
  if (local) return git(['worktree', 'add', OUT, BRANCH]);
  const remote = (await git(['ls-remote', '--heads', 'origin', BRANCH])).length > 0;
  if (remote) {
    await git(['fetch', 'origin', BRANCH]);
    return git(['worktree', 'add', '-b', BRANCH, OUT, `origin/${BRANCH}`]);
  }
  return git(['worktree', 'add', '--orphan', '-b', BRANCH, OUT]);
}

let running = false;
async function publish(db, r) {
  if (running) throw new Error('A publish is already running.');
  running = true;
  try {
    const remote = await git(['remote', 'get-url', 'origin']).catch(() => '');
    if (!remote || /YOUR-USERNAME/.test(remote)) throw new Error('No GitHub remote set up (git remote "origin").');
    await ensureWorktree();
    const counts = build(OUT, db, r);
    await git(['add', '-A'], OUT);
    const changed = (await git(['status', '--porcelain'], OUT)).length > 0;
    if (changed) {
      await git(['commit', '-m', `Publish rankings ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`], OUT);
    }
    await git(['push', '-u', 'origin', BRANCH], OUT);
    return { ...counts, changed, url: pagesUrl(remote) };
  } finally {
    running = false;
  }
}

module.exports = { publish, build, pagesUrl };
