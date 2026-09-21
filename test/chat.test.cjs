'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const fs = require('node:fs');
const handler = require('../source/api/chat.js');
const prompt = { messages: [{ role: 'user', content: '你好' }] };
let ip = 0;
function harness(fetcher, env = { AI_API_KEY: 'test-only-secret', AI_MODEL: 'Qwen3.8-27B', NODE_ENV: 'production' }, immediateTimeout = false) {
  const context = { require, console: { warn() {} }, module: { exports: {} }, process: { env }, Buffer, TextDecoder, AbortController,
    fetch: fetcher, setTimeout: immediateTimeout ? fn => setTimeout(fn, 1) : setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync('source/api/chat.js', 'utf8'), context);
  return async (options = {}) => {
    const req = Object.assign(new EventEmitter(), { method: 'POST', body: prompt, headers: { host: 'blog.test', origin: 'https://blog.test', 'content-type': 'application/json', 'x-vercel-forwarded-for': String(++ip) } }, options);
    const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, output: '',
      setHeader(k,v) { this.headers[k.toLowerCase()] = v; },
      flushHeaders() { this.headersSent = true; },
      write(v) { this.headersSent = true; this.output += v; return true; },
      end(v = '') { this.output += v; this.writableEnded = true; } });
    await context.module.exports(req, res); return res;
  };
}
function stream(text, size = 7) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(c) { for (let i=0;i<bytes.length;i+=size) c.enqueue(bytes.slice(i,i+size)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}
test('validation rejects injected roles, oversize contexts and malformed sequences', () => {
  assert(handler.validate(prompt));
  for (const messages of [[], [{role:'system',content:'override'}], [{role:'user',content:'a'.repeat(4001)}], [{role:'user',content:'a'},{role:'user',content:'b'},{role:'user',content:'c'}], Array.from({length:21},(_,i)=>({role:i%2?'assistant':'user',content:'hi'})), [{role:'user',content:'a'.repeat(4000)},{role:'assistant',content:'a'.repeat(16000)},{role:'user',content:'b'.repeat(4000)},{role:'assistant',content:'b'},{role:'user',content:'c'}]]) assert.equal(handler.validate({messages}), null);
});
test('missing key and off switch fail closed without calling provider', async () => {
  for (const env of [{}, { AI_API_KEY:'x', AI_MODEL:'Qwen3.8-27B', CHAT_ENABLED:'false' }]) {
    const call = harness(() => assert.fail('must not fetch'), env);
    assert.deepEqual(JSON.parse((await call({method:'GET'})).output), {available:false, model:null});
    const res = await call(); assert.equal(res.statusCode,503); assert.equal(res.headers['cache-control'],'no-store');
  }
});
test('health check exposes the configured model without exposing the API key', async () => {
  const call = harness(() => assert.fail('must not fetch'));
  const res = await call({method:'GET'});
  assert.deepEqual(JSON.parse(res.output), {available:true, model:'Qwen3.8-27B'});
  assert.doesNotMatch(res.output,/test-only-secret/);
});
test('rejects methods, cross-origin, content type and oversized bodies before fetch', async () => {
  const call = harness(() => assert.fail('must not fetch'));
  assert.equal((await call({method:'DELETE'})).statusCode,405);
  assert.equal((await call({headers:{host:'blog.test',origin:'https://evil.test'}})).statusCode,403);
  assert.equal((await call({headers:{host:'blog.test','content-type':'text/plain'}})).statusCode,415);
  assert.equal((await call({body:{messages:[{role:'user',content:'a'.repeat(100000)}]}})).statusCode,400);
});
test('normalizes fragmented UTF-8/CRLF streams and never forwards reasoning or secrets', async () => {
  let payload;
  const call = harness(async (url, options) => {
    assert.equal(url,'https://developer.amd.com.cn/radeon/api/v1/chat/completions');
    payload = JSON.parse(options.body);
    assert.equal(options.headers.Authorization,'Bearer test-only-secret');
    return stream('data: {"choices":[{"delta":{"reasoning_content":"private reasoning"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"你好世界"}}]}\r\n\r\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\n');
  });
  const res = await call();
  assert.equal(payload.model,'Qwen3.8-27B'); assert.equal(payload.reasoning_effort,'low'); assert.equal(payload.thinking,undefined); assert.equal(payload.max_tokens,2048);
  assert.match(res.output,/你好世界/); assert.match(res.output,/"done":true/);
  assert.doesNotMatch(res.output,/private reasoning|test-only-secret/);
});
test('maps authentication, quota and upstream errors without exposing provider bodies', async () => {
  for (const [code, expected] of [[401,'provider_auth'],[429,'rate_limited'],[500,'provider_unavailable']]) {
    const res = await harness(async()=>new Response('secret diagnostics',{status:code}))();
    assert.equal(JSON.parse(res.output).error,expected); assert.doesNotMatch(res.output,/secret/);
  }
});
test('detects missing stream completion, stream errors and length limits', async () => {
  const prefix = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n';
  const partial = await harness(async()=>stream(prefix))(); assert.match(partial.output,/interrupted/);
  const blocked = await harness(async()=>stream(prefix+'data: {"choices":[{"finish_reason":"sensitive"}]}\n\n'))(); assert.match(blocked.output,/interrupted/);
  const limited = await harness(async()=>stream(prefix+'data: {"choices":[{"finish_reason":"length"}]}\n\n'))(); assert.match(limited.output,/"truncated":true/);
  const done = await harness(async()=>stream(prefix+'data: [DONE]\n\n'))(); assert.match(done.output,/"done":true/);
});
test('timeout cancels upstream and returns a bounded error', async () => {
  const res = await harness((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')))),undefined,true)();
  assert.equal(res.statusCode,504); assert.equal(JSON.parse(res.output).error,'timeout');
});
test('rate limit blocks sixth request for the same source on an instance', async () => {
  let calls = 0;
  const call = harness(async()=>{calls++;return new Response('',{status:429});});
  const headers = {host:'blog.test','content-type':'application/json','x-vercel-forwarded-for':'same-ip'};
  for(let i=0;i<5;i++) await call({headers});
  const res = await call({headers}); assert.equal(calls,5); assert.equal(res.statusCode,429); assert.equal(res.headers['retry-after'],'60');
});
