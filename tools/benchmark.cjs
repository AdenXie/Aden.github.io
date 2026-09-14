'use strict';
const { chromium } = require('playwright');
const fs = require('node:fs');
const { serve } = require('./preview.cjs');
async function main() {
  const [directory = 'public', label = 'after'] = process.argv.slice(2);
  fs.mkdirSync('.perf', { recursive: true });
  const server = await serve(directory);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  try {
    for (const profile of [{ name: 'normal', rate: -1, latency: 0, cpu: 1 }, { name: 'mobile', rate: 1600000 / 8, latency: 150, cpu: 4 }, { name: 'slow', rate: 400000 / 8, latency: 400, cpu: 6 }]) {
      for (let run = 1; run <= 3; run++) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latency, downloadThroughput: profile.rate, uploadThroughput: profile.rate });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
        let bytes = 0;
        const requests = [], errors = [];
        cdp.on('Network.loadingFinished', e => { bytes += e.encodedDataLength; });
        page.on('request', r => requests.push(r.url()));
        page.on('pageerror', e => errors.push(e.message));
        await page.addInitScript(() => {
          window.metrics = { lcp: 0, cls: 0 };
          new PerformanceObserver(list => { for (const e of list.getEntries()) window.metrics.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
          let start = 0, previous = 0, score = 0;
          new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) { if (e.startTime - previous > 1000 || e.startTime - start > 5000) { start = e.startTime; score = 0; } score += e.value; previous = e.startTime; window.metrics.cls = Math.max(window.metrics.cls, score); } }).observe({ type: 'layout-shift', buffered: true });
        });
        let timedOut = false;
        try { await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load', timeout: 180000 }); } catch { timedOut = true; }
        await page.waitForTimeout(3000);
        const metrics = await page.evaluate(() => ({ ...window.metrics, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime, heroLoaded: [...document.querySelectorAll('.home-banner-background img')].some(i => i.complete && i.naturalWidth > 0) }));
        const result = { profile: profile.name, run, ...metrics, bytes, requests: requests.length, externalRequests: requests.filter(u => !u.startsWith('http://127.0.0.1:')), errors, timedOut };
        results.push(result);
        fs.writeFileSync(`.perf/${label}.json`, JSON.stringify({ browser: browser.version(), results }, null, 2));
        if (run === 1) await page.screenshot({ path: `.perf/${label}-${profile.name}.png` });
        console.log(JSON.stringify(result));
        await context.close();
      }
    }
  } finally { await browser.close(); server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
