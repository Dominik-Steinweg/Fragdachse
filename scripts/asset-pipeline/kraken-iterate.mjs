import { draft, krakenAssets } from './draft-v2.mjs';

draft([...krakenAssets, ...process.argv.slice(2)]).then(results => {
  if (results) console.log('Published draft version; an open Dev scenario with draft assets reloads automatically.');
}).catch(error => { console.error(error); process.exitCode = 1; });
