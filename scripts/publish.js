'use strict';
// npm run publish: same as Admin > Publish. Builds the static site and pushes it to gh-pages.
const store = require('../lib/store');
const { publish } = require('../lib/publish');

publish(store.load())
  .then(r => console.log(`Published ${r.teams} teams, ${r.games} games, ${r.seasons} season(s)${r.changed ? '' : ' (no changes since last publish)'}.
${r.url || ''}`))
  .catch(e => { console.error('Publish failed:', e.message); process.exit(1); });
