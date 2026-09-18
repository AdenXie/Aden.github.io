'use strict';
const fs = require('node:fs/promises');
const { fetchOfficialRates } = require('./lib/boc-rates.cjs');
async function main() {
  const quote = await fetchOfficialRates();
  await fs.writeFile(process.argv[2], JSON.stringify(quote, null, 2) + '\n');
  console.log(`BOC AUD quote collected: ${quote.publishedAt}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
