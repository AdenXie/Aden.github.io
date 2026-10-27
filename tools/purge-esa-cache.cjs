'use strict';
// After a deploy, wait until Vercel (the origin) serves the new build, then purge the
// Alibaba Cloud ESA edge so cached HTML (1 hour, see the "html" cache rule) updates now.
// Needs ESA_ACCESS_KEY_ID / ESA_ACCESS_KEY_SECRET (a RAM user allowed esa:PurgeCaches);
// without them it skips, since the edge cache expires on its own within the hour.
const crypto = require('node:crypto');
const dns = require('node:dns/promises');
const https = require('node:https');

const HOST = 'blog.adenxie.com.cn';
const ORIGIN = 'cname.vercel-dns.com';
const SITE_ID = '185885930741984';
const ENDPOINT = 'esa.cn-hangzhou.aliyuncs.com';
const WAIT_MS = 10 * 60 * 1000;

// Fetch from Vercel directly, bypassing ESA, so the edge cache cannot answer.
async function originBuildId() {
  const { address } = await dns.lookup(ORIGIN);
  return new Promise((resolve, reject) => {
    const req = https.get({ host: address, servername: HOST, headers: { Host: HOST, 'Cache-Control': 'no-cache' }, path: `/build-id.txt?t=${Date.now()}`, timeout: 15000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(res.statusCode === 200 ? body.trim() : ''));
    });
    req.on('timeout', () => req.destroy(new Error('origin timeout')));
    req.on('error', reject);
  });
}

async function waitForOrigin(sha) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const id = await originBuildId().catch(() => '');
    if (id === sha) return true;
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  return false;
}

// Alibaba Cloud API signature V3 (ACS3-HMAC-SHA256), RPC style with query parameters.
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
function callApi(action, version, params, { id, secret }) {
  const query = Object.keys(params).sort().map(key => `${encode(key)}=${encode(params[key])}`).join('&');
  const bodyHash = crypto.createHash('sha256').update('').digest('hex');
  const headers = {
    host: ENDPOINT,
    'x-acs-action': action,
    'x-acs-content-sha256': bodyHash,
    'x-acs-date': new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    'x-acs-signature-nonce': crypto.randomUUID(),
    'x-acs-version': version
  };
  const names = Object.keys(headers).sort();
  const canonical = ['POST', '/', query, ...names.map(name => `${name}:${headers[name]}`), '', names.join(';'), bodyHash].join('\n');
  const toSign = `ACS3-HMAC-SHA256\n${crypto.createHash('sha256').update(canonical).digest('hex')}`;
  const signature = crypto.createHmac('sha256', secret).update(toSign).digest('hex');
  headers.Authorization = `ACS3-HMAC-SHA256 Credential=${id},SignedHeaders=${names.join(';')},Signature=${signature}`;
  return new Promise((resolve, reject) => {
    const req = https.request({ host: ENDPOINT, method: 'POST', path: `/?${query}`, headers, timeout: 20000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => (res.statusCode === 200 ? resolve(JSON.parse(body)) : reject(new Error(`${action} ${res.statusCode}: ${body.slice(0, 300)}`))));
    });
    req.on('timeout', () => req.destroy(new Error(`${action} timeout`)));
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const id = process.env.ESA_ACCESS_KEY_ID?.trim(), secret = process.env.ESA_ACCESS_KEY_SECRET?.trim();
  if (!id || !secret) return console.log('ESA purge skipped: ESA_ACCESS_KEY_ID / ESA_ACCESS_KEY_SECRET not set.');
  const sha = process.env.GITHUB_SHA;
  if (sha && !(await waitForOrigin(sha))) console.warn('Origin did not report this build within 10 minutes; purging anyway.');
  const result = await callApi('PurgeCaches', '2024-09-10', {
    SiteId: SITE_ID,
    Type: 'directory',
    Content: JSON.stringify({ Directories: [`https://${HOST}/`] })
  }, { id, secret });
  console.log(`ESA purge requested for https://${HOST}/ (task ${result.TaskId}).`);
}

main().catch(error => {
  // A failed purge only delays updates until the cache expires; never fail the deploy.
  console.warn(`ESA purge failed: ${error.message}`);
});
