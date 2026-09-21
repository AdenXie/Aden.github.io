'use strict';
const { createHash } = require('node:crypto');
const ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const MAX_BODY = 96000, MAX_CONTEXT = 24000;
// Best-effort per-instance protection; WAF is the cross-instance rate limiter.
// Only short-lived hashed IP counters are kept, never message content.
const buckets = new Map();
function allowed(ip) {
  const now = Date.now();
  for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key);
  const key = createHash('sha256').update(ip).digest('hex');
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= 2048) return false;
    buckets.set(key, bucket = { count: 0, until: now + 60000 });
  }
  return ++bucket.count <= 5;
}
function json(res, status, value) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}
function validate(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > 19 || messages.length % 2 !== 1) return null;
  let total = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || m.role !== (i % 2 ? 'assistant' : 'user') || typeof m.content !== 'string' || !m.content.trim() || m.content.length > (i % 2 ? 16000 : 4000)) return null;
    total += m.content.length;
  }
  return total <= MAX_CONTEXT ? messages.map(({ role, content }) => ({ role, content })) : null;
}
async function bodyOf(req) {
  if (Number(req.headers['content-length']) > MAX_BODY) throw new Error('too_large');
  if (req.body !== undefined) {
    if (Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) > MAX_BODY) throw new Error('too_large');
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const configured = Boolean(process.env.BIGMODEL_API_KEY?.trim()) && process.env.CHAT_ENABLED !== 'false';
  if (req.method === 'GET') return json(res, 200, { available: configured });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return json(res, 405, { error: 'method_not_allowed' }); }
  const host = req.headers.host;
  if (req.headers.origin && req.headers.origin !== `https://${host}` && !(process.env.NODE_ENV !== 'production' && req.headers.origin === `http://${host}`)) return json(res, 403, { error: 'forbidden' });
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'invalid_request' });
  if (!configured) return json(res, 503, { error: 'not_configured' });
  let messages;
  try { messages = validate(await bodyOf(req)); } catch { return json(res, 400, { error: 'invalid_request' }); }
  if (!messages) return json(res, 400, { error: 'invalid_request' });
  const ip = String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (!allowed(ip)) { res.setHeader('Retry-After', '60'); return json(res, 429, { error: 'rate_limited' }); }
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once('aborted', abort); res.once('close', abort);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, 60000);
  let reader;
  const emit = value => { if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(value)}\n\n`); };
  try {
    const upstream = await fetch(ENDPOINT, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.BIGMODEL_API_KEY.trim()}` },
      body: JSON.stringify({ model: 'glm-4.7-flash', messages: [{ role: 'system', content: 'You are a helpful assistant on Aden’s Space. Reply in the user’s language. You have no browsing tools or access to site articles. Be concise and honest about uncertainty.' }, ...messages], stream: true, thinking: { type: 'disabled' }, max_tokens: 2048, temperature: 0.7 })
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return json(res, upstream.status === 429 ? 429 : 502, { error: upstream.status === 429 ? 'rate_limited' : [401,403].includes(upstream.status) ? 'provider_auth' : 'provider_unavailable' });
    }
    if (!upstream.body || !upstream.headers.get('content-type')?.includes('text/event-stream')) {
      await upstream.body?.cancel();
      return json(res, 502, { error: 'provider_unavailable' });
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.flushHeaders?.();
    reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', finished = false, output = 0, lines = [];
    const event = () => {
      if (!lines.length) return;
      const data = lines.join('\n'); lines = [];
      if (data === '[DONE]') { finished = true; emit({ done: true }); return; }
      const payload = JSON.parse(data);
      if (payload.error) throw new Error('provider_error');
      const choice = payload.choices?.[0], text = choice?.delta?.content;
      if (typeof text === 'string') {
        output += text.length;
        if (output > 16000) throw new Error('output_limit');
        emit({ text });
      }
      if (choice?.finish_reason) {
        if (!['stop', 'length'].includes(choice.finish_reason)) throw new Error('provider_error');
        finished = true; emit({ done: true, truncated: choice.finish_reason === 'length' });
      }
    };
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 128000) throw new Error('invalid_stream');
      let index;
      while (!finished && (index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1);
        if (!line) event(); else if (line.startsWith('data:')) lines.push(line.slice(5).trimStart());
      }
    }
    if (!finished) throw new Error('interrupted');
    res.end();
  } catch {
    if (res.destroyed || res.writableEnded) return;
    const error = timedOut ? 'timeout' : 'interrupted';
    if (res.headersSent) { emit({ error }); res.end(); }
    else json(res, timedOut ? 504 : 502, { error });
  } finally {
    clearTimeout(timer); req.removeListener('aborted', abort); res.removeListener('close', abort);
    abort(); await reader?.cancel().catch(() => {});
  }
}
module.exports = handler;
module.exports.validate = validate;
