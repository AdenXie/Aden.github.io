'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serve } = require('./preview.cjs');
// A post that exists in both languages in this build (local builds may lack some translations).
function bilingualPost() {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const file = walk('public/en').find(f => /[\\/]\d{4}[\\/]\d{2}[\\/]\d{2}[\\/].+[\\/]index\.html$/.test(f) && fs.existsSync(f.replace(/^public[\\/]en/, 'public')));
  assert(file, 'No post is available in both languages');
  return '/' + path.relative('public/en', path.dirname(file)).split(path.sep).map(encodeURIComponent).join('/') + '/';
}
// Ask AI in the bottom dock (source/js/chat.js): questions are typed in the dock, the dock shows the work,
// and the conversation panel opens when the answer starts. The provider is mocked; nothing real is sent.
async function main() {
  const post = bilingualPost();
  const server = await serve('public');
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome' });
  fs.mkdirSync('.perf', { recursive: true });
  const report = [];
  try {
    for (const width of [390, 1440]) {
      const phone = width < 600;
      const context = await browser.newContext({ viewport: { width, height: 950 }, isMobile: phone, hasTouch: phone });
      const page = await context.newPage(); const errors = [], posted = [], requests = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => requests.push(r.url()));
      let mode = 'ok';
      await context.route('**/*', async route => {
        const req = route.request(), url = req.url();
        if (!url.startsWith(base)) return route.abort();
        if (new URL(url).pathname !== '/api/chat') return route.continue();
        if (req.method() === 'GET') return route.fulfill({ json: mode === 'missing' ? { available: false, model: null } : { available: true, model: 'gemini-test-model', reachable: true } });
        posted.push(req.postDataJSON());
        if (mode === 'quota') return route.fulfill({ status: 429, headers: { 'Retry-After': '30' }, json: { error: 'rate_limited' } });
        if (mode === 'daily') return route.fulfill({ status: 429, json: { error: 'rate_limited', reason: 'daily_quota' } });
        if (mode === 'search') { await new Promise(r => setTimeout(r, 1200)); return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"status":"searching"}\n\n' }); }
        if (mode === 'slow') { await new Promise(r => setTimeout(r, 2500)); return route.abort().catch(() => {}); }
        const text = '**Hello 世界**\n- item\n```html\n<script>alert(1)</script>\n```\n<img src=x onerror=alert(1)>\n来源 [示例](https://example.org/a?b=1) [坏链接](javascript:alert(1))';
        const body = `data: ${JSON.stringify({ text })}\n\n` + (mode === 'broken' ? '' : 'data: {"done":true}\n\n');
        return route.fulfill({ contentType: 'text/plain; charset=utf-8', body });
      });
      const ask = page.locator('#aden-ask'), input = page.locator('#aden-ask-input'), send = page.locator('.aden-ask-send'), stop = page.locator('.aden-ask-stop');
      const opener = page.locator('.aden-ask-open'), panel = page.locator('#aden-chat'), toast = page.locator('.aden-ask-toast');
      const openField = async () => {
        if (phone) await opener.click(); else await input.click();
        await page.waitForFunction(() => window.AdenChat && document.querySelector('#aden-chat'));
      };
      const answered = n => page.waitForFunction(count => document.querySelectorAll('#aden-chat .chat-copy').length === count, n);
      const chatRequests = () => requests.filter(u => /\/js\/chat\.js|\/css\/chat\.css|\/api\/chat/.test(u));
      for (const lang of ['', '/en']) {
        mode = 'ok'; requests.length = 0;
        await page.goto(base + lang + post);
        // Nothing chat-related loads until the visitor asks for it.
        await page.waitForTimeout(300);
        assert.deepEqual(chatRequests(), []);
        assert.equal(await page.locator('.navbar-list a[href$="/chat/"], .drawer-navbar-list a[href$="/chat/"]').count(), 0);
        if (phone) { assert(await opener.isVisible()); assert(await ask.isHidden()); } else { assert(await ask.isVisible()); assert(await opener.isHidden()); }
        await page.screenshot({ path: `.perf/ask-dock-${width}-${lang ? 'en' : 'zh'}.png` });
        await openField();
        if (phone) {
          assert(await ask.isVisible(), 'the field opens over the dock');
          assert.equal(await opener.getAttribute('aria-expanded'), 'true');
        }
        // First use shows the privacy note, naming the provider.
        assert.match(await toast.innerText(), /Google Gemini/);
        const title = (await page.locator('.post-page-container .article-title').innerText()).trim();
        assert.match(await input.getAttribute('placeholder'), /这篇文章|this article/);
        // The article tab sits on top of the field as soon as it is in use, before any question.
        assert(await page.locator('.aden-ask-context').isVisible());
        assert((await page.locator('.aden-ask-context').innerText()).includes((await page.locator('.post-page-container .article-title').innerText()).trim()));
        {
          const tab = await page.locator('.aden-ask-context').boundingBox(), field = await ask.boundingBox();
          assert(tab.y + tab.height <= field.y, 'the article tab sits above the field');
        }

        // While the model works, only the dock shows it; the panel waits for the answer.
        mode = 'slow'; await input.fill('stop-me'); await send.click();
        await page.waitForFunction(() => document.querySelector('#aden-ask').classList.contains('is-working'));
        assert(await page.locator('.aden-ask-thinking').isVisible());
        assert(await stop.isVisible()); assert(await send.isHidden());
        assert(await panel.isHidden(), 'no panel while thinking');
        await stop.click();
        await page.waitForFunction(() => !document.querySelector('#aden-ask').classList.contains('is-working'));
        assert.match(await toast.innerText(), /停止|Stopped/);
        assert.equal(await input.inputValue(), 'stop-me');

        // A web search shows its own state in the dock while the model works.
        mode = 'search'; await input.fill('search-me'); await send.click();
        await page.waitForFunction(() => /联网搜索|Searching the web/.test(document.querySelector('.aden-ask-thinking-label')?.textContent || ''));
        assert(await panel.isHidden(), 'no panel while searching');
        await page.waitForFunction(() => !document.querySelector('#aden-ask').classList.contains('is-working'));
        await input.fill('');

        // The answer opens the panel; the article travels with the question.
        mode = 'ok'; await input.fill('private-test-marker'); await send.click();
        await answered(1);
        assert(await panel.isVisible());
        assert.match(await page.locator('#aden-chat h2').innerText(), lang ? /Ask AI/ : /问 AI/);
        assert.equal(await page.locator('#aden-chat .chat-model').innerText(), 'gemini-test-model');
        // The privacy note is one line until opened.
        const privacy = page.locator('#aden-chat .chat-privacy');
        assert.match(await privacy.locator('summary').innerText(), lang ? /Privacy/ : /隐私说明/);
        assert(await privacy.locator('p').isHidden());
        await privacy.locator('summary').click();
        assert.match(await privacy.locator('p').innerText(), /Google Gemini/);
        assert((await page.locator('.aden-ask-context').innerText()).includes(title));
        assert(await page.locator('.aden-ask-context input').isChecked());
        assert.equal(posted.at(-1).reasoningEffort, undefined);
        assert.equal(posted.at(-1).page.title, title);
        assert.equal(posted.at(-1).page.url, new URL(page.url()).pathname);
        assert(posted.at(-1).page.content.length > 200 && posted.at(-1).page.content.length <= 32000);
        assert.equal(await page.locator('.chat-message-body strong').innerText(), 'Hello 世界');
        assert.equal(await page.locator('.chat-message-body script, .chat-message-body img').count(), 0);
        assert.equal(await page.locator('.chat-message-body li').count(), 1);
        // Sources become links (http/https only, new tab, no referrer); other schemes stay text.
        const links = page.locator('.chat-message-body a');
        assert.equal(await links.count(), 1);
        assert.equal(await links.getAttribute('href'), 'https://example.org/a?b=1');
        assert.equal(await links.getAttribute('target'), '_blank');
        assert.match(await links.getAttribute('rel'), /noopener/);
        assert.match(await page.locator('.chat-message[data-role="assistant"] .chat-message-body').last().innerText(), /\[坏链接\]\(javascript/);
        const box = await panel.boundingBox(), dock = await page.locator('.right-side-tools-container').boundingBox();
        assert(box.y + box.height <= dock.y, 'the panel sits above the dock');
        if (phone) assert(box.height >= 950 * 0.45 && box.height <= 950 * 0.76, 'phone panel takes half to three quarters of the screen');
        else assert(box.width <= 560, 'desktop panel width');

        // Unticking the article box sends the follow-up without the article.
        await page.locator('.aden-ask-context').click();
        assert.equal(await page.locator('.aden-ask-context input').isChecked(), false);
        await input.fill('follow-up'); await send.click(); await answered(2);
        assert.equal(posted.at(-1).messages.length, 3);
        assert.equal(posted.at(-1).page, undefined);
        assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('private-test-marker')), false);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: `.perf/ask-panel-${width}-${lang ? 'en' : 'zh'}-dark.png` });
        await page.evaluate(() => { document.documentElement.classList.remove('dark'); document.documentElement.classList.add('light'); });
        await page.screenshot({ path: `.perf/ask-panel-${width}-${lang ? 'en' : 'zh'}-light.png` });

        // Hiding keeps the conversation; returning to the field brings it back. Escape hides it too.
        await page.locator('[data-chat="close"]').click(); assert(await panel.isHidden());
        await input.blur(); await input.focus(); assert(await panel.isVisible());
        assert.equal(await page.locator('.chat-message').count(), 4);
        await page.keyboard.press('Escape'); assert(await panel.isHidden());
        await input.blur(); await input.focus(); assert(await panel.isVisible());
        await page.locator('[data-chat="clear"]').click(); assert.equal(await page.locator('.chat-message').count(), 0); assert(await panel.isHidden());

        // Rate limits name the wait when the server knows it, and fall back to a general notice.
        mode = 'quota'; await input.fill('quota'); await send.click();
        await page.waitForFunction(() => document.querySelector('.aden-ask-toast')?.dataset.error === 'true');
        assert.match(await toast.innerText(), /30 秒|30 seconds/);
        assert.equal(await input.inputValue(), 'quota');
        mode = 'daily'; await send.click();
        await page.waitForFunction(() => /用量限制|Usage limit/.test(document.querySelector('.aden-ask-toast')?.textContent || ''));
        assert.doesNotMatch(await toast.innerText(), /一分钟|a minute/);
        mode = 'broken'; await input.fill('broken'); await send.click();
        await page.waitForFunction(() => /中断|interrupted/.test(document.querySelector('#aden-chat .chat-message-note')?.textContent || ''));

        if (phone) {
          // A tap outside the dock and the panel closes the field and keeps the draft.
          await page.locator('[data-chat="close"]').click();
          await input.fill('draft');
          await page.mouse.click(20, 200);
          await page.waitForFunction(() => !document.querySelector('.right-side-tools-container').classList.contains('is-asking'));
          assert.equal(await opener.getAttribute('aria-expanded'), 'false');
          await opener.click(); assert.equal(await input.inputValue(), 'draft');
        }

        // Reloading or leaving discards the conversation.
        await page.reload(); assert.equal(await page.locator('.chat-message').count(), 0);
        await openField(); await input.fill('back-test'); await send.click(); await answered(1);
        // Pages without a post send no article.
        await page.goto(base + lang + '/archives/'); await openField();
        await input.fill('no-article'); await send.click(); await answered(1);
        assert(await page.locator('.aden-ask-context').isHidden());
        assert.equal(posted.at(-1).page, undefined);
        await page.goBack(); await page.waitForFunction(() => !!window.AdenSite);
        assert.equal(await page.locator('.chat-message').count(), 0);
        mode = 'missing'; await page.reload(); await openField();
        await page.waitForFunction(() => document.querySelector('#aden-ask-input').disabled);
        assert.match(await input.getAttribute('placeholder'), /暂未开放|not available yet/);
        // Retired /chat/ links land on the post list (Vercel redirect) with the field ready.
        mode = 'ok'; await page.goto(base + lang + '/?chat=open');
        if (phone) await page.waitForFunction(() => document.querySelector('.right-side-tools-container').classList.contains('is-asking'));
        else await page.waitForFunction(() => document.activeElement?.id === 'aden-ask-input');
        report.push({ width, lang: lang || 'zh', passed: true });
      }
      assert.deepEqual(errors, []); await context.close();
    }
    const zlib = require('node:zlib');
    const bytes = ['public/js/chat.js', 'public/css/chat.css'].reduce((n, f) => n + zlib.gzipSync(fs.readFileSync(f)).length, 0);
    assert(bytes < 50000);
    const result = { checks: report, post, gzipBytes: bytes, realProviderTested: false };
    fs.writeFileSync('.perf/chat-verification.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
