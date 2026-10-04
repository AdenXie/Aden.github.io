/* Temporary chat panel, loaded on the first click of the launcher. Page memory only:
   no browser storage, cookies or analytics. */
(() => {
  'use strict';
  const en = document.documentElement.lang.startsWith('en');
  const t = (zh, english) => en ? english : zh;
  const ARTICLE_LIMIT = 32000; // Keep in sync with MAX_ARTICLE in source/api/chat.js.
  if (!document.getElementById('aden-chat')) {
    const panel = document.createElement('section');
    panel.id = 'aden-chat'; panel.hidden = true;
    panel.setAttribute('translate', 'no'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'aden-chat-title');
    // Static interface text only; article titles and model output are added as text nodes.
    panel.innerHTML = `<header class="chat-heading"><div><span class="chat-label">ADEN'S SPACE / AI CHAT</span><h2 id="aden-chat-title">${t('想聊点什么？', 'What’s on your mind?')}</h2></div><div class="chat-heading-actions"><button type="button" data-chat="clear">${t('清空', 'Clear')}</button><button type="button" data-chat="close" aria-label="${t('关闭聊天', 'Close chat')}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div></header>
  <p class="chat-context" data-chat="context" hidden></p>
  <div class="chat-transcript" data-chat="messages" role="region" aria-label="${t('对话内容', 'Conversation')}" tabindex="0">
    <div class="chat-empty" data-chat="empty"><span class="chat-spark" aria-hidden="true">✳</span><p>${t('从你的第一个问题开始', 'Start with your first question')}</p><span data-chat="hint"></span></div>
  </div>
  <form data-chat="form" class="chat-composer">
    <label for="chat-input" class="chat-input-label">${t('你的消息', 'Your message')}</label>
    <textarea id="chat-input" data-chat="input" rows="2" maxlength="4000" autocomplete="off" placeholder="${t('在这里输入问题…', 'Type your question here…')}"></textarea>
    <div class="chat-reasoning-row"><span>${t('思考深度', 'Reasoning')}</span><div class="chat-reasoning" data-chat="reasoning" role="radiogroup" aria-label="${t('思考深度', 'Reasoning effort')}"><button type="button" role="radio" data-reasoning="low" aria-checked="true">Low</button><button type="button" role="radio" data-reasoning="medium" aria-checked="false">Medium</button><button type="button" role="radio" data-reasoning="xhigh" aria-checked="false">XHigh</button></div></div>
    <div class="chat-composer-footer"><span class="chat-key-hint">${t('Enter 发送 · Shift + Enter 换行', 'Enter to send · Shift + Enter for a new line')}</span><div><button type="button" data-chat="stop" hidden>${t('停止生成', 'Stop')}</button><button type="submit" data-chat="send" disabled>${t('发送', 'Send')} <span aria-hidden="true">↑</span></button></div></div>
  </form>
  <p data-chat="status" class="chat-status" role="status" aria-live="polite">${t('正在连接聊天服务…', 'Connecting to chat…')}</p>
  <p class="chat-privacy">${t('本站不保存对话。消息会发送至 AMD Radeon Cloud，数据处理以其政策为准。AI 回答可能有误，请核对重要信息。', 'This site does not save conversations. Messages are sent to AMD Radeon Cloud under its data policies. AI can make mistakes; check important information.')}</p>`;
    document.body.append(panel);
  }
  // The open post as the reader sees it (the translated text on English pages).
  function readArticle() {
    const body = document.querySelector('.post-page-container .article-content');
    const content = body?.innerText.replace(/\xa0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!content) return null;
    const title = (document.querySelector('.post-page-container .article-title')?.textContent || document.title).trim().slice(0, 300);
    return { title, url: location.pathname.slice(0, 500), content: content.slice(0, ARTICLE_LIMIT), truncated: content.length > ARTICLE_LIMIT };
  }
  window.AdenSite.register('chat', '#aden-chat', (root, scope) => {
    const find = name => root.querySelector(`[data-chat="${name}"]`);
    const input = find('input'), form = find('form'), send = find('send'), stop = find('stop'), reasoning = find('reasoning');
    const transcript = find('messages'), empty = find('empty'), status = find('status');
    const launcher = document.getElementById('aden-chat-launcher');
    const page = readArticle();
    find('context').hidden = !page;
    if (page) find('context').textContent = t('AI 可读取本文：', 'AI can read this article: ') + page.title;
    find('hint').textContent = page
      ? t('可以直接问这篇文章的内容，也可以聊别的。刷新或离开页面后，对话即清空。', 'Ask about this article or anything else. Refreshing or leaving clears this chat.')
      : t('可以连续追问。刷新或离开页面后，对话即清空。', 'Ask follow-up questions. Refreshing or leaving clears this chat.');
    let history = [], active = null, available = false, reasoningEffort = 'low', assistantLabel = 'AI ASSISTANT';
    const errors = {
      not_configured: t('聊天暂未开放，请稍后再来。', 'Chat is not available yet. Please check back later.'),
      rate_limited: t('请求较多，请稍等一分钟再发送。', 'Too many requests. Wait a minute before sending again.'),
      provider_auth: t('聊天服务配置异常，请稍后再试。', 'Chat configuration needs attention. Please try again later.'),
      provider_unavailable: t('模型暂时无法响应，请稍后再试。', 'The model is unavailable. Please try again later.'),
      provider_connect_timeout: t('网站暂时无法连接模型服务，请稍后再试。', 'The site could not connect to the model service. Please try again later.'),
      timeout: t('等待超时，请稍后重试。', 'The request timed out. Please try again later.'),
      interrupted: t('连接中断，已收到的内容保留在下方。可重新发送问题。', 'Connection interrupted. Received text is kept below. You can send your question again.'),
      invalid_request: t('对话过长或消息格式有误，请清空后重新开始。', 'The conversation is too long or invalid. Clear it to start again.')
    };
    function setStatus(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
    function controls() {
      send.disabled = !available || !!active || !input.value.trim();
      input.disabled = !available;
      stop.hidden = !active;
      input.readOnly = !!active;
      reasoning.querySelectorAll('button').forEach(button => { button.disabled = !available || !!active; });
      transcript.setAttribute('aria-busy', String(!!active));
    }
    function setReasoning(value) {
      if (!['low', 'medium', 'xhigh'].includes(value)) return;
      reasoningEffort = value;
      reasoning.querySelectorAll('[data-reasoning]').forEach(button => { button.setAttribute('aria-checked', String(button.dataset.reasoning === value)); });
    }
    function inline(node, text) {
      // A small safe subset: model HTML is always rendered as text.
      const regex = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
      let last = 0;
      for (const match of text.matchAll(regex)) {
        node.append(document.createTextNode(text.slice(last, match.index)));
        const code = match[0].startsWith('`'), el = document.createElement(code ? 'code' : 'strong');
        el.textContent = match[0].slice(code ? 1 : 2, code ? -1 : -2); node.append(el);
        last = match.index + match[0].length;
      }
      node.append(document.createTextNode(text.slice(last)));
    }
    function markdown(node, text) {
      node.replaceChildren();
      let code = null, list = null;
      for (const line of text.split('\n')) {
        if (/^\s*```/.test(line)) {
          list = null;
          if (code) code = null;
          else { const pre = document.createElement('pre'); code = document.createElement('code'); pre.append(code); node.append(pre); }
        } else if (code) code.append(document.createTextNode(line + '\n'));
        else {
          const item = line.match(/^\s*(?:([-*])|\d+[.)])\s+(.+)$/);
          if (item) {
            const tag = item[1] ? 'UL' : 'OL';
            if (!list || list.tagName !== tag) { list = document.createElement(tag); node.append(list); }
            const li = document.createElement('li'); inline(li, item[2]); list.append(li);
          } else {
            list = null;
            if (line.trim()) { const p = document.createElement('p'); inline(p, line.replace(/^#{1,6}\s+/, '')); node.append(p); }
          }
        }
      }
    }
    function message(role, text) {
      empty.hidden = true;
      const article = document.createElement('div'); article.className = 'chat-message'; article.dataset.role = role;
      const label = document.createElement('span'); label.className = 'chat-message-label';
      label.textContent = role === 'user' ? t('你', 'YOU') : assistantLabel;
      const body = document.createElement('div'); body.className = 'chat-message-body'; body.textContent = text;
      article.append(label, body); transcript.append(article);
      return { article, body };
    }
    function scroll() { transcript.scrollTop = transcript.scrollHeight; }
    async function submit(event) {
      event.preventDefault();
      if (active || !available || !input.value.trim()) return;
      const prompt = input.value.trim();
      if (history.length >= 20 || history.reduce((n, m) => n + m.content.length, prompt.length) > 24000) {
        setStatus(errors.invalid_request, true); return;
      }
      const controller = new AbortController(); active = controller;
      const timeout = setTimeout(() => { controller.timedOut = true; controller.abort(); }, 70000);
      message('user', prompt); const reply = message('assistant', '');
      const progress = document.createElement('div'); progress.className = 'chat-message-progress';
      progress.setAttribute('role', 'status');
      const requestReasoning = reasoningEffort;
      progress.textContent = requestReasoning === 'low' ? t('正在等待模型回答…', 'Waiting for the model…') : requestReasoning === 'medium' ? t('正在深入思考…', 'Thinking more deeply…') : t('正在进行最深入思考…', 'Using maximum reasoning…');
      reply.article.insertBefore(progress, reply.body);
      input.value = ''; controls(); scroll();
      setStatus(t('正在连接模型…', 'Connecting to the model…'));
      let answer = '', shown = 0, complete = false, truncated = false, reader, frame = null, drained = null;
      const update = () => {
        frame = null;
        if (active !== controller || scope.signal.aborted || controller.signal.aborted) { drained?.(); drained = null; return; }
        const atBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 100;
        const remaining = answer.length - shown;
        if (remaining > 0) {
          shown = matchMedia('(prefers-reduced-motion: reduce)').matches ? answer.length : Math.min(answer.length, shown + (remaining > 180 ? Math.ceil(remaining / 60) : 2));
          reply.body.textContent = answer.slice(0, shown);
        }
        if (atBottom) scroll();
        if (shown < answer.length) frame = requestAnimationFrame(update);
        else { drained?.(); drained = null; }
      };
      const schedule = () => { if (frame === null) frame = requestAnimationFrame(update); };
      const finishTyping = () => shown >= answer.length ? Promise.resolve() : new Promise(resolve => { drained = resolve; schedule(); });
      try {
        const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [...history, { role: 'user', content: prompt }], reasoningEffort: requestReasoning, ...(page && { page }) }), signal: controller.signal, cache: 'no-store' });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(response.status === 429 ? 'rate_limited' : typeof data.error === 'string' ? data.error : 'provider_unavailable');
        }
        if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('provider_unavailable');
        reader = response.body.getReader();
        const decoder = new TextDecoder(); let buffer = '';
        while (!complete) {
          const { value, done } = await reader.read();
          if (done) break;
          if (active !== controller || scope.signal.aborted) return;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 128000) throw new Error('interrupted');
          let index;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const raw = buffer.slice(0, index); buffer = buffer.slice(index + 2);
            if (!raw.startsWith('data: ')) continue;
            const data = JSON.parse(raw.slice(6));
            if (data.error) throw new Error(data.error);
            if (typeof data.text === 'string') {
              answer += data.text;
              if (answer.length > 16000) throw new Error('interrupted');
              if (answer.trim()) progress.textContent = t('正在生成回答…', 'Writing the answer…');
              setStatus(progress.textContent);
              schedule();
            }
            if (data.done) {
              complete = true;
              truncated = Boolean(data.truncated);
              setStatus(data.truncated ? t('回答达到长度上限，可以继续追问。', 'Response length limit reached. You can ask a follow-up.') : t('可以继续追问，或清空开始新的对话。', 'Ask a follow-up, or clear this chat to start again.'));
              break;
            }
          }
        }
        if (!complete || !answer.trim()) throw new Error('interrupted');
        await finishTyping();
        if (controller.signal.aborted) throw new Error('interrupted');
        progress.textContent = truncated ? t('已达到回答长度上限', 'Response length limit reached') : t('回答已完成', 'Answer complete');
        reply.article.append(progress);
        history.push({ role: 'user', content: prompt }, { role: 'assistant', content: answer });
      } catch (error) {
        if (active !== controller || scope.signal.aborted) return;
        const stopped = controller.signal.aborted && !controller.timedOut;
        const text = stopped ? t('已停止。可重新发送问题。', 'Stopped. You can send your question again.') : errors[controller.timedOut ? 'timeout' : error.message] || errors.interrupted;
        setStatus(text, !stopped);
        progress.textContent = stopped ? t('已停止生成', 'Generation stopped') : text;
        progress.dataset.error = String(!stopped);
        reply.article.append(progress);
        input.value = prompt;
        if (!answer) reply.body.textContent = text;
      } finally {
        clearTimeout(timeout); if (frame !== null) cancelAnimationFrame(frame);
        await reader?.cancel().catch(() => {});
        if (active === controller && !scope.signal.aborted) {
          if (answer) {
            markdown(reply.body, answer);
            const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = t('复制回答', 'Copy response');
            copy.addEventListener('click', async () => {
              try { await navigator.clipboard.writeText(answer); copy.textContent = t('已复制', 'Copied'); }
              catch { setStatus(t('无法自动复制，请选中文字复制。', 'Select the text to copy it manually.'), true); }
            }, { signal: scope.signal });
            reply.article.append(copy);
          }
          active = null; controls();
        }
      }
    }
    function reset() {
      const previous = active; active = null; previous?.abort(); history = [];
      transcript.querySelectorAll('.chat-message').forEach(el => el.remove());
      empty.hidden = false; input.value = ''; controls();
      setStatus(available ? t('对话仅在当前页面保留。', 'This conversation stays only on this page.') : errors.not_configured);
    }
    function setOpen(open) {
      root.hidden = !open;
      document.documentElement.classList.toggle('aden-chat-open', open);
      launcher?.setAttribute('aria-expanded', String(open));
      if (!open) launcher?.focus();
      else { scroll(); if (!matchMedia('(pointer: coarse)').matches) input.focus(); }
    }
    document.addEventListener('aden-chat:toggle', () => setOpen(root.hidden), { signal: scope.signal });
    find('close').addEventListener('click', () => setOpen(false), { signal: scope.signal });
    root.addEventListener('keydown', event => { if (event.key === 'Escape') setOpen(false); }, { signal: scope.signal });
    // Phones show the panel full screen; keep the composer above the on-screen keyboard.
    const viewport = window.visualViewport;
    if (viewport) {
      const fit = () => { root.style.setProperty('--chat-height', `${viewport.height}px`); root.style.setProperty('--chat-top', `${viewport.offsetTop}px`); };
      viewport.addEventListener('resize', fit, { signal: scope.signal }); viewport.addEventListener('scroll', fit, { signal: scope.signal }); fit();
    }
    form.addEventListener('submit', submit, { signal: scope.signal });
    input.addEventListener('input', controls, { signal: scope.signal });
    reasoning.addEventListener('click', event => { const button = event.target.closest('[data-reasoning]'); if (button) setReasoning(button.dataset.reasoning); }, { signal: scope.signal });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !matchMedia('(pointer: coarse)').matches) { event.preventDefault(); form.requestSubmit(); }
    }, { signal: scope.signal });
    stop.addEventListener('click', () => active?.abort(), { signal: scope.signal });
    find('clear').addEventListener('click', () => { reset(); input.focus(); }, { signal: scope.signal });
    setReasoning('low');
    const check = new AbortController();
    const checkTimeout = setTimeout(() => check.abort(), 10000);
    scope.signal.addEventListener('abort', () => check.abort(), { once: true });
    fetch('/api/chat', { signal: check.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (scope.signal.aborted) return;
      const configuredModel = typeof data.model === 'string' ? data.model.trim() : '';
      if (configuredModel) assistantLabel = configuredModel;
      available = data.available === true; controls();
      if (available && !root.hidden && !matchMedia('(pointer: coarse)').matches) input.focus();
      setStatus(available ? t('对话仅在当前页面保留。', 'This conversation stays only on this page.') : errors.not_configured);
    }).catch(() => {
      if (!scope.signal.aborted) { available = true; controls(); setStatus(t('服务状态暂不可用，可以尝试发送。', 'Service status unavailable. You can try sending a message.')); }
    }).finally(() => clearTimeout(checkTimeout));
    return () => { reset(); check.abort(); clearTimeout(checkTimeout); };
  });
})();
