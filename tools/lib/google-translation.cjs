'use strict';

const { hasSameAnchors } = require('./openrouter-translation.cjs');

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MAX_URL_LENGTH = 1800;

function encodedLength(text) {
  return `${ENDPOINT}?${new URLSearchParams({ client: 'gtx', dt: 't', sl: 'zh-CN', tl: 'en', q: text })}`.length;
}

function splitText(text, maxUrlLength) {
  const chunks = [];
  let current = [];
  const units = text.match(/\d+(?:[.,]\d+)*%?|[A-Za-z_][A-Za-z0-9_]*|\s+|./gu) || [];
  function flush(count = current.length) {
    if (!count) return;
    chunks.push({ text: current.slice(0, count).join(''), protected: false });
    current = current.slice(count);
  }
  for (const unit of units) {
    while (current.length && encodedLength(current.join('') + unit) > maxUrlLength) {
      const boundary = current.findLastIndex((part, index) => index < current.length - 1 && (/^\s+$/u.test(part) || /^[。！？；;.!?,，]$/u.test(part)));
      flush(boundary >= 0 ? boundary + 1 : current.length);
    }
    if (encodedLength(unit) > maxUrlLength) {
      for (const char of unit) {
        if (current.length && encodedLength(current.join('') + char) > maxUrlLength) flush();
        current.push(char);
      }
    } else current.push(unit);
  }
  flush();
  return chunks;
}

function chunksFor(text, maxUrlLength = MAX_URL_LENGTH) {
  const chunks = [];
  const urlPattern = /https?:\/\/[^\s<>()]+/giu;
  let start = 0;
  let match;
  while ((match = urlPattern.exec(text))) {
    chunks.push(...splitText(text.slice(start, match.index), maxUrlLength));
    chunks.push({ text: match[0], protected: true });
    start = match.index + match[0].length;
  }
  chunks.push(...splitText(text.slice(start), maxUrlLength));
  return chunks.filter(chunk => chunk.text);
}

function parseResponse(data) {
  if (!Array.isArray(data) || !Array.isArray(data[0]) || !data[0].length) throw new Error('Google Translate returned an invalid response');
  const parts = data[0].map(row => {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0].trim()) throw new Error('Google Translate returned a malformed translation segment');
    return row[0];
  });
  return parts.join('');
}

function joinChunks(parts) {
  return parts.reduce((result, part) => {
    if (!result) return part;
    const left = result.trimEnd().at(-1) || '';
    const right = part.trimStart()[0] || '';
    const needsSpace = /[\p{L}\p{N}]/u.test(left) || '.!?;:,)]'.includes(left);
    const separator = result === result.trimEnd() && part === part.trimStart() && needsSpace && /^[\p{L}\p{N}]/u.test(right) ? ' ' : '';
    return result + separator + part;
  }, '');
}

async function translateText(text, fetchImpl = fetch, options = {}) {
  const chunks = chunksFor(text, options.maxUrlLength || MAX_URL_LENGTH);
  const translated = [];
  for (const chunk of chunks) {
    if (chunk.protected || !/[\u3400-\u9fff]/u.test(chunk.text)) {
      translated.push(chunk.text);
      continue;
    }
    const params = new URLSearchParams({ client: 'gtx', dt: 't', sl: 'zh-CN', tl: 'en', q: chunk.text });
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetchImpl(`${ENDPOINT}?${params}`, { method: 'GET', signal: AbortSignal.timeout(options.timeoutMs || 20000) });
        if (response.status === 429 || response.status >= 500) {
          if (attempt === 0) continue;
          throw new Error(`Google Translate HTTP ${response.status}`);
        }
        if (!response.ok) throw new Error(`Google Translate HTTP ${response.status}`);
        const contentType = response.headers?.get?.('content-type') || '';
        if (contentType && !/json/i.test(contentType)) throw new Error('Google Translate returned a non-JSON response');
        const data = await response.json();
        const leading = chunk.text.match(/^\s*/u)[0];
        const trailing = chunk.text.match(/\s*$/u)[0];
        translated.push(leading + parseResponse(data).trim() + trailing);
        response = null;
        break;
      } catch (error) {
        const transient = error.name === 'AbortError' || error.name === 'TimeoutError' || error instanceof TypeError || /HTTP (429|5\d\d)/u.test(error.message);
        if (attempt === 0 && transient) continue;
        if (/Google Translate/u.test(error.message)) throw error;
        throw new Error('Google Translate request failed');
      }
    }
    if (response) throw new Error('Google Translate request failed');
  }
  const result = joinChunks(translated);
  if (!result.trim() || !hasSameAnchors(text, result)) throw new Error('Google Translate translation failed integrity checks');
  return result;
}

async function translate(items, fetchImpl = fetch, options = {}) {
  const results = [];
  for (const item of items) results.push(await translateText(item.text, fetchImpl, options));
  return results;
}

module.exports = { ENDPOINT, MAX_URL_LENGTH, chunksFor, parseResponse, joinChunks, translateText, translate };
