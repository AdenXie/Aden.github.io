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
async function main() {
  const post = bilingualPost();
  const server = await serve('public');
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome' });
  fs.mkdirSync('.perf', { recursive: true });
  const report = [];
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage(); const errors = [], posted = [], requests = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => requests.push(r.url()));
      let mode = 'ok';
      await context.route('**/*', async route => {
        const req = route.request(), url = req.url();
        if (!url.startsWith(base)) return route.abort();
        if (new URL(url).pathname !== '/api/chat') return route.continue();
        if (req.method() === 'GET') return route.fulfill({json:{available:mode!=='missing'}});
        posted.push(req.postDataJSON());
        if (mode === 'quota') return route.fulfill({status:429,json:{error:{code:'TOO_MANY_REQUESTS',message:'Rate limit exceeded'}}});
        if (mode === 'slow') { await new Promise(r=>setTimeout(r,500)); return route.abort().catch(()=>{}); }
        const text = '**Hello 世界**\n- item\n```html\n<script>alert(1)</script>\n```\n<img src=x onerror=alert(1)>';
        const body = `data: ${JSON.stringify({text})}\n\n` + (mode === 'broken' ? '' : 'data: {"done":true}\n\n');
        return route.fulfill({contentType:'text/event-stream',body});
      });
      const launcher = page.locator('#aden-chat-launcher'), panel = page.locator('#aden-chat');
      const input = page.locator('#chat-input'), send = page.locator('[data-chat="send"]'), status = page.locator('[data-chat="status"]');
      const open = async () => { await launcher.click(); await page.waitForFunction(()=>document.querySelector('#chat-input') && !document.querySelector('#chat-input').disabled); };
      const chatRequests = () => requests.filter(u=>/\/js\/chat\.js|\/css\/chat\.css|\/api\/chat/.test(u));
      for (const lang of ['', '/en']) {
        mode='ok'; requests.length = 0;
        await page.goto(base+lang+post);
        // Nothing chat-related loads until the visitor asks for it.
        await page.waitForTimeout(300);
        assert.deepEqual(chatRequests(), []);
        assert.equal(await page.locator('.navbar-list a[href$="/chat/"], .drawer-navbar-list a[href$="/chat/"]').count(), 0);
        assert.equal(await launcher.getAttribute('aria-expanded'), 'false');
        await page.mouse.wheel(0, 600); await page.waitForTimeout(400);
        await page.screenshot({path:`.perf/chat-launcher-${width}-${lang?'en':'zh'}.png`});
        await open();
        assert.equal(await launcher.getAttribute('aria-expanded'), 'true');
        assert.match(await page.locator('#aden-chat h2').innerText(),lang?/What/:/想聊/);
        const title = (await page.locator('.post-page-container .article-title').innerText()).trim();
        assert((await page.locator('[data-chat="context"]').innerText()).includes(title));
        const box = await panel.boundingBox();
        if (width < 600) assert(box.x === 0 && box.width === width, 'phone panel is full width');
        else assert(box.width <= 400 && box.x + box.width <= width && box.y >= 70, 'desktop panel floats below the header');
        assert.equal(await page.locator('[data-chat="reasoning"]').count(), 0);
        assert(await page.locator('[data-chat="attach"]').isChecked());
        await input.fill('private-test-marker'); await send.click();
        await page.waitForFunction(()=>{const text=document.querySelector('.chat-message[data-role="assistant"] .chat-message-body')?.textContent||'';return text.length>0&&text.length<40;});
        await page.waitForFunction(()=>document.querySelectorAll('.chat-message button').length===1);
        assert.equal(posted.at(-1).reasoningEffort, undefined);
        // The open article travels with the question, in the language the reader sees.
        assert.equal(posted.at(-1).page.title, title);
        assert.equal(posted.at(-1).page.url, new URL(page.url()).pathname);
        assert(posted.at(-1).page.content.length > 200 && posted.at(-1).page.content.length <= 32000);
        assert(posted.at(-1).page.content.includes((await page.locator('.article-content h2, .article-content p').first().innerText()).trim().slice(0, 12)));
        assert.equal(await page.locator('.chat-message-body strong').innerText(),'Hello 世界');
        assert.match(await page.locator('.chat-message-progress').last().innerText(),/回答已完成|Answer complete/);
        assert.equal(await page.locator('.chat-message-body script,.chat-message-body img').count(),0);
        assert.equal(await page.locator('.chat-message-body li').count(),1);
        // Unticking the article box sends the follow-up without the article.
        await page.locator('[data-chat="context"]').click();
        assert.equal(await page.locator('[data-chat="attach"]').isChecked(), false);
        await input.fill('follow-up'); await send.click();
        await page.waitForFunction(()=>document.querySelectorAll('.chat-message button').length===2);
        assert.equal(posted.at(-1).messages.length,3);
        assert.equal(posted.at(-1).page, undefined);
        assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('private-test-marker')),false);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1));
        await page.screenshot({path:`.perf/chat-${width}-${lang?'en':'zh'}-dark.png`});
        await page.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');});
        await page.screenshot({path:`.perf/chat-${width}-${lang?'en':'zh'}-light.png`});
        // Closing keeps the conversation for this page view; the launcher, close button and Escape all work.
        await page.locator('[data-chat="close"]').click(); assert(await panel.isHidden());
        assert.equal(await launcher.getAttribute('aria-expanded'), 'false');
        await launcher.click(); assert(await panel.isVisible()); assert.equal(await page.locator('.chat-message').count(),4);
        await input.focus(); await page.keyboard.press('Escape'); assert(await panel.isHidden());
        await launcher.click();
        await page.locator('[data-chat="clear"]').click(); assert.equal(await page.locator('.chat-message').count(),0);
        mode='quota'; await input.fill('quota'); await send.click();
        await page.waitForFunction(()=>document.querySelector('[data-chat="status"]').dataset.error==='true');
        assert.match(await status.innerText(),/一分钟|minute/);
        mode='broken'; await input.fill('broken'); await send.click();
        await page.waitForFunction(()=>document.querySelector('[data-chat="status"]').textContent.includes('中断')||document.querySelector('[data-chat="status"]').textContent.includes('interrupted'));
        assert.match(await page.locator('.chat-message-progress').last().innerText(),/中断|interrupted/);
        mode='slow'; await input.fill('stop-me'); await send.click();
        assert.match(await page.locator('.chat-message-progress').last().innerText(),/正在等待模型|Waiting for the model/);
        await page.locator('[data-chat="stop"]').click();
        await page.waitForFunction(()=>document.querySelector('[data-chat="stop"]').hidden);
        assert.match(await status.innerText(),/停止|Stopped/);
        assert.match(await page.locator('.chat-message-progress').last().innerText(),/已停止生成|Generation stopped/);
        await input.fill('clear-during-request'); await send.click(); await page.locator('[data-chat="clear"]').click();
        assert.equal(await page.locator('.chat-message').count(),0);
        // Reloading or leaving discards the conversation.
        mode='ok'; await page.reload(); assert.equal(await page.locator('.chat-message').count(),0);
        await open(); await input.fill('back-test'); await send.click(); await page.waitForFunction(()=>document.querySelectorAll('.chat-message button').length===1);
        // Pages without a post send no article.
        await page.goto(base+lang+'/archives/'); await open();
        assert(await page.locator('[data-chat="context"]').isHidden());
        await input.fill('no-article'); await send.click(); await page.waitForFunction(()=>document.querySelectorAll('.chat-message button').length===1);
        assert.equal(posted.at(-1).page, undefined);
        await page.goBack(); await page.waitForFunction(()=>!!window.AdenSite);
        assert.equal(await page.locator('.chat-message').count(),0);
        mode='missing'; await page.reload(); await launcher.click();
        await page.waitForFunction(()=>{const text=document.querySelector('[data-chat="status"]')?.textContent||'';return text.includes('暂未开放')||text.includes('not available yet');});
        assert(await send.isDisabled());
        // Retired /chat/ links land here (Vercel redirect) and open the panel.
        mode='ok'; await page.goto(base+lang+'/?chat=open'); await page.waitForFunction(()=>document.querySelector('#aden-chat') && !document.querySelector('#aden-chat').hidden);
        report.push({width,lang:lang||'zh',passed:true});
      }
      assert.deepEqual(errors,[]); await context.close();
    }
    const zlib=require('node:zlib');
    const bytes=['public/js/chat.js','public/css/chat.css'].reduce((n,f)=>n+zlib.gzipSync(fs.readFileSync(f)).length,0);
    assert(bytes < 50000);
    const result={checks:report,post,gzipBytes:bytes,realProviderTested:false};
    fs.writeFileSync('.perf/chat-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } finally { await browser.close(); await new Promise(r=>server.close(r)); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
