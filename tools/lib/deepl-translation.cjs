'use strict';

const { hasSameAnchors } = require('./translation-anchors.cjs');

const MODEL = 'deepl-api-v2';
const FREE_ENDPOINT = 'https://api-free.deepl.com/v2/translate';
const PRO_ENDPOINT = 'https://api.deepl.com/v2/translate';
const RETRY_DELAYS_MS = [2000, 6000];

// DeepL Free keys end in ":fx" and must use the free host.
const endpointFor = apiKey => (/:fx$/u.test(apiKey) ? FREE_ENDPOINT : PRO_ENDPOINT);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Provider-wide failures stop the whole run; retrying other batches cannot help.
function providerError(message, fatal) {
  const error = new Error(message);
  error.fatal = fatal;
  return error;
}

function retryDelay(response, attempt, delays) {
  const header = Number(response.headers?.get?.('retry-after'));
  return Number.isFinite(header) && header > 0 ? Math.min(header * 1000, 30000) : delays[attempt];
}

function parseOutput(data, items) {
  const rows = data?.translations;
  if (!Array.isArray(rows) || rows.length !== items.length) throw providerError('DeepL returned the wrong number of translations', false);
  // A rejected item is skipped (null) so one odd segment does not discard the batch.
  return rows.map((row, i) => {
    const text = typeof row?.text === 'string' ? row.text.trim() : '';
    return text && hasSameAnchors(items[i].text, text) ? text : null;
  });
}

async function translate(items, apiKey, fetchImpl = fetch, options = {}) {
  if (!apiKey) throw providerError('DeepL API key missing', true);
  const delays = options.retryDelaysMs || RETRY_DELAYS_MS;
  const wait = options.sleep || sleep;
  const body = JSON.stringify({ text: items.map(item => item.text), source_lang: 'ZH', target_lang: 'EN-GB', preserve_formatting: true });
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetchImpl(endpointFor(apiKey), {
        method: 'POST',
        headers: { Authorization: `DeepL-Auth-Key ${apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(options.timeoutMs || 60000),
      });
    } catch (error) {
      if (attempt < delays.length) { await wait(delays[attempt]); continue; }
      throw providerError(`DeepL request failed: ${error.name === 'TimeoutError' ? 'timeout' : 'network error'}`, true);
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt < delays.length) { await wait(retryDelay(response, attempt, delays)); continue; }
      throw providerError(`DeepL HTTP ${response.status}`, true);
    }
    if (response.status === 456) throw providerError('DeepL HTTP 456: character quota exceeded', true);
    if (response.status === 401 || response.status === 403) throw providerError(`DeepL HTTP ${response.status}: API key rejected`, true);
    if (!response.ok) throw providerError(`DeepL HTTP ${response.status}`, false);
    return parseOutput(await response.json(), items);
  }
}

module.exports = { MODEL, FREE_ENDPOINT, PRO_ENDPOINT, endpointFor, parseOutput, translate };
