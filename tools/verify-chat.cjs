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
  const report = [];
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, isMobile: width < 600 });
      const page = await context.newPage(); const errors = [], posted = [];
      page.on('pageerror', e => errors.push(e.message));
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
      for (const lang of ['', '/en']) {
        mode='ok';
        await page.goto(base+lang+'/chat/');
        const input = page.locator('#chat-input'), send = page.locator('[data-chat="send"]'), reasoning = page.locator('[data-chat="reasoning"]'), status = page.locator('[data-chat="status"]');
        await page.waitForFunction(()=>!document.querySelector('#chat-input').disabled);
        assert.match(await page.locator('#aden-chat h2').innerText(),lang?/What/:/想聊/);
        assert.equal(await reasoning.locator('[data-reasoning="low"]').getAttribute('aria-checked'),'true');
        await input.fill('private-test-marker'); await send.click();
        await page.waitForFunction(()=>{const text=document.querySelector('.chat-message[data-role="assistant"] .chat-message-body')?.textContent||'';return text.length>0&&text.length<40;});
        await page.waitForFunction(()=>document.querySelectorAll('.chat-message button').length===1);
        assert.equal(posted.at(-1).reasoningEffort,'low');
        assert.equal(await page.locator('.chat-message-body strong').innerText(),'Hello 世界');
        assert.match(await page.locator('.chat-message-progress').last().innerText(),/回答已完成|Answer complete/);
        assert.equal(await page.locator('.chat-message-body script,.chat-message-body img').count(),0);
        assert.equal(await page.locator('.chat-message-body li').count(),1);
        await reasoning.locator('[data-reasoning="medium"]').click();
        await reasoning.locator('[data-reasoning="xhigh"]').click();
        assert.equal(await reasoning.locator('[data-reasoning="xhigh"]').getAttribute('aria-checked'),'true');
        await input.fill('follow-up'); await send.click();
        await page.waitForFunction(()=>document.querySelectorAll('.chat-message button').length===2);
        assert.equal(posted.at(-1).messages.length,3);
        assert.equal(posted.at(-1).reasoningEffort,'xhigh');
        assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('private-test-marker')),false);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1));
        await page.locator('#aden-chat').screenshot({path:`.perf/chat-${width}-${lang?'en':'zh'}-dark.png`});
        await page.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');});
        await page.locator('#aden-chat').screenshot({path:`.perf/chat-${width}-${lang?'en':'zh'}-light.png`});
        await page.locator('[data-chat="clear"]').click(); assert.equal(await page.locator('.chat-message').count(),0);
        mode='quota'; await input.fill('quota'); await send.click();
        await page.waitForFunction(()=>document.querySelector('[data-chat="status"]').dataset.error==='true');
        assert.match(await status.innerText(),/一分钟|minute/);
        mode='broken'; await input.fill('broken'); await send.click();
        await page.waitForFunction(()=>document.querySelector('[data-chat="status"]').textContent.includes('中断')||document.querySelector('[data-chat="status"]').textContent.includes('interrupted'));
        assert.match(await page.locator('.chat-message-progress').last().innerText(),/中断|interrupted/);
        mode='slow'; await input.fill('stop-me'); await send.click();
        assert.match(await page.locator('.chat-message-progress').last().innerText(),/正在(?:等待模型|.*思考)|Waiting for the model|reasoning/);
        await page.locator('[data-chat="stop"]').click();
        await page.waitForFunction(()=>document.querySelector('[data-chat="stop"]').hidden);
        assert.match(await status.innerText(),/停止|Stopped/);
        assert.match(await page.locator('.chat-message-progress').last().innerText(),/已停止生成|Generation stopped/);
        await input.fill('clear-during-request'); await send.click(); await page.locator('[data-chat="clear"]').click();
        assert.equal(await page.locator('.chat-message').count(),0);
        mode='ok'; await page.reload(); await page.waitForFunction(()=>!document.querySelector('#chat-input').disabled);
        assert.equal(await page.locator('.chat-message').count(),0);
        await input.fill('back-test'); await send.click(); await page.waitForFunction(()=>document.querySelectorAll('.chat-message button').length===1);
        await page.goto(base+'/archives/'); await page.goBack(); await page.waitForFunction(()=>!!window.AdenSite);
        assert.equal(await page.locator('.chat-message').count(),0);
        mode='missing'; await page.reload(); await page.waitForFunction(()=>document.querySelector('[data-chat="status"]').textContent.includes('暂未开放')||document.querySelector('[data-chat="status"]').textContent.includes('not available yet'));
        assert(await send.isDisabled());
        report.push({width,lang:lang||'zh',passed:true});
      }
      const requests=[];page.on('request',r=>requests.push(r.url()));await page.goto(base+'/archives/');
      assert(!requests.some(u=>/\/js\/chat\.js|\/css\/chat\.css|\/api\/chat/.test(u)));
      assert.deepEqual(errors,[]); await context.close();
    }
    const zlib=require('node:zlib');
    const bytes=['public/js/chat.js','public/css/chat.css'].reduce((n,f)=>n+zlib.gzipSync(fs.readFileSync(f)).length,0);
    assert(bytes < 50000);
    const result={checks:report,gzipBytes:bytes,realProviderTested:false};
    fs.writeFileSync('.perf/chat-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } finally { await browser.close(); await new Promise(r=>server.close(r)); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
