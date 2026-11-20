'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { fetchOfficialRates } = require('./lib/boc-rates.cjs');
const { mergeHistory, quoteDay } = require('./lib/boc-history.cjs');

const SNAPSHOT_URL = 'https://raw.githubusercontent.com/AdenXie/Aden.github.io/exchange-rates/aud-cny.json';
const SEED = path.join(__dirname, 'data/aud-cny-history-seed.json');

// The daily history lives in the snapshot itself, so the previous one must be read before it
// is replaced. A missing file starts from the seed; any other failure stops the run without
// writing, because a snapshot written without its history would erase it.
async function previousHistory(fetchImpl = fetch) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(`${SNAPSHOT_URL}?t=${Date.now()}`, { signal: AbortSignal.timeout(8000) });
      if (response.status === 404) return [];
      if (response.ok) {
        const previous = await response.json();
        return Array.isArray(previous?.history) ? previous.history : [];
      }
    } catch (_) { /* retried below */ }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error('Previous snapshot could not be read; keeping it unchanged');
}

// Readable fields, one line per day of history.
function serialize(quote) {
  const { history, ...fields } = quote;
  const head = JSON.stringify(fields, null, 2).replace(/\n}$/, '');
  const days = history.map(day => '    ' + JSON.stringify(day)).join(',\n');
  return head + ',\n  "history": [\n' + days + '\n  ]\n}\n';
}

async function main() {
  const [quote, previous, seed] = await Promise.all([
    fetchOfficialRates(),
    previousHistory(),
    fs.readFile(SEED, 'utf8').then(JSON.parse)
  ]);
  quote.history = mergeHistory(seed, previous, [quoteDay(quote)]);
  await fs.writeFile(process.argv[2], JSON.stringify(quote, null, 2) + '\n');
  console.log(`BOC AUD quote collected: ${quote.publishedAt} · ${quote.history.length} days of history`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { previousHistory, serialize };
