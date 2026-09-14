'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { serve } = require('./preview.cjs');
async function main() {
  const server = await serve('public');
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome' });
  fs.mkdirSync('.perf', { recursive: true });
  const results = [];
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
      const context = await browser.newContext({ viewport, isMobile: viewport.width < 600 });
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.testAudio = [];
        const create = document.createElement.bind(document);
        document.createElement = (tag, ...args) => { const el = create(tag, ...args); if (tag === 'audio') window.testAudio.push(el); return el; };
      });
      const errors = [], requests = [], badAssets = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => requests.push(r.url()));
      page.on('response', r => { if (r.url().startsWith(base) && !r.url().includes('/api/') && r.status() >= 400) badAssets.push(r.url()); });
      // Deliberately make every external service unavailable; navigation must still work.
      await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
      await page.goto(base);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      assert.equal(await page.locator('#visitor-status-hud').count(), 1);
      assert.equal(await page.locator('#aud-cny-exchange-card').count(), 1);
      assert.equal(requests.some(u => u.includes('search.xml')), false);
      assert.equal(requests.some(u => u.includes('/meting/')), false);
      assert.equal(await page.evaluate(() => window.testAudio[0]?.preload), 'none');
      await page.screenshot({ path: `.perf/home-${viewport.width}.png` });
      await page.locator('.search-popup-trigger:visible').first().click();
      const input = page.locator('.search-input:visible');
      await input.fill('每日');
      await page.waitForFunction(() => document.querySelector('#search-result a'));
      assert.equal(requests.filter(u => u.includes('search.xml')).length, 1);
      await page.keyboard.press('Escape');
      await page.locator('.search-popup-trigger:visible').first().click();
      await page.keyboard.press('Escape');
      assert.equal(requests.filter(u => u.includes('search.xml')).length, 1);
      // The existing theme hides the player on mobile; exercise its retained play handler.
      await page.locator('.aplayer-button').first().dispatchEvent('click');
      await page.waitForTimeout(300);
      assert(requests.some(u => u.includes('/meting/')), 'music starts its request only after play');
      const article = await page.locator('.home-article-title a').first().getAttribute('href');
      for (const [name, url] of [['article', article], ['archives', '/archives/'], ['world-time', '/world-time/'], ['english', '/en/']]) {
        const start = requests.length;
        await page.goto(base + url);
        await page.waitForTimeout(400);
        assert.equal(await page.locator('body').count(), 1);
        if (name !== 'english') assert.equal(requests.slice(start).some(u => /cyber-(weather|exchange)\.js/.test(u)), false);
        if (name === 'article') {
          assert.equal(requests.slice(start).some(u => u.includes('twikoo.all.min.js')), false);
          await page.locator('#twikoo-comment').scrollIntoViewIfNeeded();
          await page.waitForFunction(() => typeof window.twikoo !== 'undefined');
        }
        if (name === 'world-time') {
          await page.locator('button[data-city="london"]').click();
          assert.equal(await page.locator('button[data-city="london"]').getAttribute('aria-pressed'), 'true');
          assert(!/--:--/.test(await page.locator('[data-wt="remote-time"]').innerText()));
        }
        if (name === 'english') {
          await page.locator('.search-popup-trigger:visible').first().click();
          await page.locator('.search-input:visible').fill('daily');
          await page.waitForFunction(() => document.querySelector('#search-result a'));
          assert(requests.slice(start).some(u => u.includes('/en/search.xml')));
          await page.keyboard.press('Escape');
        }
        await page.waitForTimeout(600);
        await page.screenshot({ path: `.perf/${name}-${viewport.width}.png` });
      }
      await page.goto(base);
      await page.goto(base + '/world-time/');
      await page.goBack();
      await page.waitForTimeout(300);
      assert.equal(await page.locator('#visitor-status-hud').count(), 1);
      // Explicitly request light mode and confirm the site's normal control works.
      const darkBefore = await page.locator('html').evaluate(el => el.classList.contains('dark'));
      await page.mouse.wheel(0, 950);
      await page.locator('.toggle-tools-list').click();
      await page.locator('.tool-dark-light-toggle').click();
      await page.waitForTimeout(600);
      assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dark')), !darkBefore);
      await page.screenshot({ path: `.perf/theme-toggle-${viewport.width}.png` });
      // Twikoo 1.7.20 rejects with numeric 0 when its remote service is blocked.
      // Record that SDK failure while requiring our page interactions to stay usable.
      assert.deepEqual(errors.filter(error => error !== '0'), []);
      assert.deepEqual(badAssets, []);
      results.push({ viewport, passed: true, externalServicesBlocked: true, externalSdkErrors: errors, requests: requests.length });
      await context.close();
    }
    const retryContext = await browser.newContext();
    let attempts = 0;
    await retryContext.route('**/*', route => {
      const url = route.request().url();
      if (!url.startsWith(base)) return route.abort();
      if (url.endsWith('/search.xml') && ++attempts === 1) return route.fulfill({ status: 503, body: 'Unavailable' });
      return route.continue();
    });
    const retryPage = await retryContext.newPage();
    await retryPage.goto(base);
    await retryPage.locator('.search-popup-trigger:visible').first().click();
    await retryPage.locator('.search-input:visible').fill('每日');
    await retryPage.waitForFunction(() => document.querySelector('#no-result')?.textContent.includes('重新打开'));
    await retryPage.keyboard.press('Escape');
    await retryPage.locator('.search-popup-trigger:visible').first().click();
    await retryPage.locator('.search-input:visible').fill('每日');
    await retryPage.waitForFunction(() => document.querySelector('#search-result a'));
    assert.equal(attempts, 2);
    results.push({ searchFailureAndRetry: true });
    await retryContext.close();
    fs.writeFileSync('.perf/browser-verification.json', JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally { await browser.close(); server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
