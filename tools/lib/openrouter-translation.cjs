'use strict';
// Disabled since 2026-10-21: build-bilingual.cjs uses DeepL only. Kept for re-enabling later.

const MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const { hasSameAnchors } = require('./translation-anchors.cjs');

function parseOutput(content, items) {
  if (typeof content !== 'string' || content.length > 200000) throw new Error('OpenRouter returned invalid or oversized content');
  const clean = content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/giu, '').trim();
  let parsed;
  try { parsed = JSON.parse(clean); } catch { throw new Error('OpenRouter returned invalid JSON'); }
  const rows = Array.isArray(parsed) ? parsed : parsed?.translations;
  if (!Array.isArray(rows) || rows.length !== items.length) throw new Error('OpenRouter returned the wrong number of translations');
  const byId = new Map();
  for (const row of rows) {
    if (!row || !Number.isInteger(row.id) || typeof row.text !== 'string' || !row.text.trim() || byId.has(row.id)) throw new Error('OpenRouter returned an invalid translation row');
    byId.set(row.id, row.text.trim());
  }
  return items.map((item, id) => {
    const text = byId.get(id);
    if (!text || !hasSameAnchors(item.text, text)) throw new Error(`OpenRouter translation failed integrity checks for item ${id}`);
    return text;
  });
}

async function translate(items, apiKey, fetchImpl = fetch) {
  const maxTokens = Math.min(12000, Math.max(2048, Math.ceil(items.reduce((sum, item) => sum + item.text.length, 0) * 2)));
  const input = items.map((item, id) => ({ id, context: item.context || '', text: item.text }));
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature: 0.1, max_tokens: maxTokens, reasoning: { enabled: false }, messages: [
      { role: 'system', content: 'Translate each Chinese text into natural English. Preserve meaning, numbers, URLs, code-like tokens and punctuation. Use context only to disambiguate. Do not include reasoning. Return only JSON in the exact shape {"translations":[{"id":0,"text":"..."}]}; include every input id exactly once.' },
      { role: 'user', content: JSON.stringify(input) },
    ] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`);
  const data = await response.json();
  if (data?.error) {
    let detail = '';
    try {
      const upstream = JSON.parse(data.error.metadata?.raw || '{}');
      detail = upstream.error?.message || upstream.message || '';
    } catch { /* Provider diagnostics are optional; never log the raw payload. */ }
    const message = [data.error.message, detail].filter(value => typeof value === 'string').join(': ').split(apiKey).join('[redacted]').slice(0, 500);
    throw new Error(`OpenRouter API ${data.error.code || 'error'}: ${message}`);
  }
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('OpenRouter response was truncated');
  if (choice?.finish_reason !== 'stop') throw new Error(`OpenRouter returned unsupported finish reason: ${choice?.finish_reason || 'missing'}`);
  if (typeof choice.message?.content !== 'string' || choice.message.tool_calls || choice.message.refusal) throw new Error('OpenRouter did not return a normal text completion');
  return parseOutput(choice.message.content, items);
}

module.exports = { MODEL, ENDPOINT, hasSameAnchors, parseOutput, translate };
