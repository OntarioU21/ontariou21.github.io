'use strict';
// npm run publish: same as Admin > Publish. Builds the static site and pushes it to gh-pages.
const store = require('../lib/store');
const { computeRatings } = require('../lib/ratings');
const { publish } = require('../lib/publish');

const db = store.load();
publish(db, computeRatings(db.teams, db.games, db.settings))
  .then(r => console.log(`Published ${r.teams} teams and ${r.games} games${r.changed ? '' : ' (no changes since last publish)'}.\n${r.url || ''}`))
  .catch(e => { console.error('Publish failed:', e.message); process.exit(1); });
