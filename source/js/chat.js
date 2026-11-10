/* Ask AI, loaded on first use of the dock field (site-runtime.js). Questions are typed in the dock; while
   the model thinks only the dock shows it (rainbow beam, dot wave); the conversation panel opens when the
   answer starts to arrive. Page memory only: no browser storage, cookies or analytics. */
(() => {
  'use strict';
  const en = document.documentElement.lang.startsWith('en');
  const t = (zh, english) => en ? english : zh;
  const ARTICLE_LIMIT = 32000; // Keep in sync with MAX_ARTICLE in source/api/chat.js.
  const coarse = () => matchMedia('(pointer: coarse)').matches;
  const errors = {
    not_configured: t('聊天暂未开放，请稍后再来。', 'Chat is not available yet. Please check back later.'),
    rate_limited: t('暂时达到用量限制，请稍后再试。', 'Usage limit reached for now. Please try again later.'),
    provider_auth: t('聊天服务配置异常，请稍后再试。', 'Chat configuration needs attention. Please try again later.'),
    provider_unavailable: t('模型暂时无法响应，请稍后再试。', 'The model is unavailable. Please try again later.'),
    provider_connect_timeout: t('AI 服务商暂时无法连接，请稍后再试。', 'The AI provider can’t be reached right now. Please try again later.'),
    timeout: t('等待超时，请稍后重试。', 'The request timed out. Please try again later.'),
    interrupted: t('连接中断，已收到的内容保留在对话里。可重新发送问题。', 'Connection interrupted. Received text is kept in the conversation. You can send your question again.'),
    invalid_request: t('对话过长或消息格式有误，请清空后重新开始。', 'The conversation is too long or invalid. Clear it to start again.')
  };
  const PRIVACY = t('本站不保存对话。消息会发送至 Google Gemini，数据处理以其政策为准；使用免费 API 时，输入和输出可能被用于改进 Google 产品。AI 回答可能有误，请核对重要信息。', 'This site does not save conversations. Messages are sent to Google Gemini under its data policies; with the free API, inputs and outputs may be used to improve Google products. AI can make mistakes; check important information.');
  // A 429 names its wait in Retry-After when the server knows it (seconds or an HTTP date).
  function rateLimitMessage(header) {
    const value = (header || '').trim();
    const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
    if (!Number.isFinite(seconds) || seconds <= 0) return errors.rate_limited;
    if (seconds < 90) return t(`请求较多，请等待 ${seconds} 秒后再试。`, `Too many requests. Try again in ${seconds} seconds.`);
    const minutes = Math.ceil(seconds / 60);
    return t(`暂时达到用量限制，请约 ${minutes} 分钟后再试。`, `Usage limit reached. Try again in about ${minutes} minutes.`);
  }

  // The open post as the reader sees it (the translated text on English pages).
  function readArticle() {
    const body = document.querySelector('.post-page-container .article-content');
    const content = body?.innerText.replace(/\xa0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!content) return null;
    const title = (document.querySelector('.post-page-container .article-title')?.textContent || document.title).trim().slice(0, 300);
    return { title, url: location.pathname.slice(0, 500), content: content.slice(0, ARTICLE_LIMIT), truncated: content.length > ARTICLE_LIMIT };
  }
  function inline(node, text) {
    // A small safe subset: model HTML is always rendered as text.
    // Links: only [text](http(s) URL), opened in a new tab without referrer; anything else stays text.
    const regex = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]{1,300}\]\(https?:\/\/[^\s()]{1,2048}\))/g;
    let last = 0;
    for (const match of text.matchAll(regex)) {
      node.append(document.createTextNode(text.slice(last, match.index)));
      const link = match[0].match(/^\[([^\]]+)\]\((.+)\)$/);
      if (link) {
        const a = document.createElement('a');
        try { const url = new URL(link[2]); if (!/^https?:$/.test(url.protocol)) throw 0; a.href = url.href; }
        catch { node.append(document.createTextNode(match[0])); last = match.index + match[0].length; continue; }
        a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; a.textContent = link[1].replace(/\*\*/g, '');
        node.append(a); last = match.index + match[0].length; continue;
      }
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

  window.AdenChat = true;
  window.AdenSite.register('chat', '#aden-ask', (form, scope) => {
    const signal = scope.signal;
    const input = form.querySelector('.aden-ask-input'), send = form.querySelector('.aden-ask-send'), stop = form.querySelector('.aden-ask-stop');
    const thinking = form.querySelector('.aden-ask-thinking'), thinkingLabel = form.querySelector('.aden-ask-thinking-label');
    const page = readArticle();
    if (page) input.placeholder = t('问这篇文章，或任何问题…', 'Ask about this article, or anything…');

    // Conversation panel: built per page and removed when the page goes, so leaving clears the chat.
    const panel = document.createElement('section');
    panel.id = 'aden-chat'; panel.hidden = true;
    panel.setAttribute('translate', 'no'); panel.setAttribute('role', 'region'); panel.setAttribute('aria-labelledby', 'aden-chat-title');
    // Static interface text only; article titles and model output are added as text nodes.
    panel.innerHTML = `<header class="chat-heading"><h2 id="aden-chat-title">${t('问 AI', 'Ask AI')}</h2><span class="chat-model" data-chat="model"></span><div class="chat-heading-actions"><button type="button" data-chat="clear">${t('清空', 'Clear')}</button><button type="button" data-chat="close" aria-label="${t('收起对话', 'Hide conversation')}"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button></div></header>
  <div class="chat-transcript" data-chat="messages" role="log" aria-label="${t('对话内容', 'Conversation')}" tabindex="0"></div>
  <p class="chat-privacy">${PRIVACY}</p>`;
    document.body.append(panel);
    const find = name => panel.querySelector(`[data-chat="${name}"]`);
    const transcript = find('messages');
    // On a post, a tab on top of the dock field says the article goes with the question (ticked by default).
    // It shows whenever the field is in use or the conversation is open, before the first question too.
    const context = document.createElement('label');
    context.className = 'aden-ask-context'; context.hidden = !page;
    context.innerHTML = '<input type="checkbox" checked><span></span>';
    const attach = context.querySelector('input');
    if (page) context.querySelector('span').textContent = t('AI 可读取本文：', 'AI can read this article: ') + page.title;
    form.append(context);
    document.documentElement.classList.toggle('aden-ask-has-context', Boolean(page));

    // Notices above the dock: privacy on first use, errors while the panel is closed.
    const toast = document.createElement('p');
    toast.className = 'aden-ask-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); toast.hidden = true;
    document.body.append(toast);
    // Notices rise out of the dock and sink back into it; errors stay a little longer (6 s) than other notes.
    let toastTimer = 0, hideTimer = 0;
    const notice = (text, error = false, ms = 4000) => {
      clearTimeout(toastTimer); clearTimeout(hideTimer);
      if (!text) {
        toast.classList.remove('is-shown');
        hideTimer = setTimeout(() => { toast.hidden = true; }, 220);
        return;
      }
      toast.classList.remove('is-shown');
      toast.textContent = text; toast.dataset.error = String(error); toast.hidden = false;
      void toast.offsetWidth;
      toast.classList.add('is-shown');
      if (ms) toastTimer = setTimeout(() => notice(''), ms);
    };

    let history = [], active = null, available = true, assistantLabel = 'AI', reachable = true, privacyShown = false;
    const setWorking = working => {
      form.classList.toggle('is-working', working);
      thinking.hidden = !working; stop.hidden = !working; send.hidden = working;
      if (!working) send.disabled = !input.value.trim() || !available;
    };
    const setTyping = () => form.classList.toggle('is-typing', document.activeElement === input && Boolean(input.value));
    const scroll = () => { transcript.scrollTop = transcript.scrollHeight; };
    function setOpen(open) {
      panel.hidden = !open;
      document.documentElement.classList.toggle('aden-chat-open', open);
      if (open) scroll();
    }
    function message(role, text) {
      const article = document.createElement('div'); article.className = 'chat-message'; article.dataset.role = role;
      const label = document.createElement('span'); label.className = 'chat-message-label';
      label.textContent = role === 'user' ? t('你', 'You') : assistantLabel;
      const body = document.createElement('div'); body.className = 'chat-message-body'; body.textContent = text;
      article.append(label, body); transcript.append(article);
      return { article, body };
    }

    async function submit(event) {
      event?.preventDefault();
      delete form.dataset.queued;
      if (active || !input.value.trim()) return;
      const prompt = input.value.trim();
      if (history.length >= 20 || history.reduce((n, m) => n + m.content.length, prompt.length) > 24000) {
        notice(errors.invalid_request, true, 6000); return;
      }
      const controller = new AbortController(); active = controller;
      const timeout = setTimeout(() => { controller.timedOut = true; controller.abort(); }, 70000);
      let reply = null, answer = '', shown = 0, complete = false, truncated = false, reader, frame = null, drained = null, searching = false;
      input.value = ''; setTyping(); setWorking(true); notice('');
      thinkingLabel.textContent = t('思考中', 'Thinking');
      // A slow connection usually means the provider is struggling; say so instead of a silent wait.
      const slow = setTimeout(() => { if (active === controller && !answer && !searching) thinkingLabel.textContent = t('仍在连接 AI 服务商', 'Still connecting'); }, 6000);
      // The exchange enters the transcript when the answer starts (or at once if the panel is already open).
      const reveal = () => {
        if (reply) return;
        message('user', prompt); reply = message('assistant', '');
        reply.article.dataset.pending = '';
        setOpen(true);
      };
      if (!panel.hidden) reveal();
      const update = () => {
        frame = null;
        if (active !== controller || signal.aborted || controller.signal.aborted) { drained?.(); drained = null; return; }
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
        const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [...history, { role: 'user', content: prompt }], ...(page && attach.checked && { page }) }), signal: controller.signal, cache: 'no-store' });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          if (response.status === 429) throw Object.assign(new Error('rate_limited'), { detail: rateLimitMessage(response.headers.get('retry-after')) });
          throw new Error(typeof data.error === 'string' ? data.error : 'provider_unavailable');
        }
        if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('provider_unavailable');
        reader = response.body.getReader();
        const decoder = new TextDecoder(); let buffer = '';
        while (!complete) {
          const { value, done } = await reader.read();
          if (done) break;
          if (active !== controller || signal.aborted) return;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 128000) throw new Error('interrupted');
          let index;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const raw = buffer.slice(0, index); buffer = buffer.slice(index + 2);
            if (!raw.startsWith('data: ')) continue;
            const data = JSON.parse(raw.slice(6));
            if (data.error) throw new Error(data.error);
            // Model state from the server: a web search, then back to thinking over the results.
            if (data.status === 'rate' && !answer.trim()) { searching = searching || 'rate'; thinkingLabel.textContent = t('正在读取汇率', 'Reading the exchange rate'); }
            if (data.status === 'searching' && !answer.trim()) { searching = 'web'; thinkingLabel.textContent = t('正在联网搜索', 'Searching the web'); }
            if (data.status === 'thinking' && !answer.trim()) thinkingLabel.textContent = searching === 'web' ? t('正在整理搜索结果', 'Reading the results') : t('正在整理结果', 'Putting it together');
            if (typeof data.text === 'string') {
              answer += data.text;
              if (answer.length > 16000) throw new Error('interrupted');
              if (answer.trim()) { reveal(); thinkingLabel.textContent = t('正在回答', 'Answering'); }
              schedule();
            }
            if (data.done) { complete = true; truncated = Boolean(data.truncated); break; }
          }
        }
        if (!complete || !answer.trim()) throw new Error('interrupted');
        await finishTyping();
        if (controller.signal.aborted) throw new Error('interrupted');
        history.push({ role: 'user', content: prompt }, { role: 'assistant', content: answer });
        if (truncated) notice(t('回答达到长度上限，可以继续追问。', 'Response length limit reached. You can ask a follow-up.'));
      } catch (error) {
        if (active !== controller || signal.aborted) return;
        const stopped = controller.signal.aborted && !controller.timedOut;
        const text = stopped ? t('已停止。问题已放回输入框，可以重新发送。', 'Stopped. Your question is back in the field to send again.') : error.detail || errors[controller.timedOut ? 'timeout' : error.message] || errors.interrupted;
        if (reply) {
          const note = document.createElement('p'); note.className = 'chat-message-note'; note.dataset.error = String(!stopped); note.textContent = text;
          reply.article.append(note);
          if (!answer) reply.body.remove();
        }
        if (!reply || panel.hidden) notice(text, !stopped, stopped ? 4000 : 6000);
        // The question goes back into the dock so it can be sent again.
        input.value = prompt; setTyping();
      } finally {
        clearTimeout(timeout); clearTimeout(slow); if (frame !== null) cancelAnimationFrame(frame);
        await reader?.cancel().catch(() => {});
        if (active === controller && !signal.aborted) {
          if (reply) {
            delete reply.article.dataset.pending;
            if (answer) {
              markdown(reply.body, answer);
              const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'chat-copy'; copy.textContent = t('复制回答', 'Copy response');
              copy.addEventListener('click', async () => {
                try { await navigator.clipboard.writeText(answer); copy.textContent = t('已复制', 'Copied'); }
                catch { notice(t('无法自动复制，请选中文字复制。', 'Select the text to copy it manually.'), true); }
              }, { signal });
              reply.article.append(copy);
            }
          }
          active = null; setWorking(false);
          if (!coarse()) input.focus({ preventScroll: true });
        }
      }
    }
    function reset() {
      const previous = active; active = null; previous?.abort(); history = [];
      transcript.replaceChildren(); setWorking(false); notice('');
    }

    form.addEventListener('submit', submit, { signal });
    stop.addEventListener('click', () => active?.abort(), { signal });
    input.addEventListener('input', () => { setTyping(); if (!active) send.disabled = !input.value.trim() || !available; }, { signal });
    const onFocus = event => {
      setTyping();
      if (!privacyShown) { privacyShown = true; notice(reachable ? PRIVACY : errors.provider_connect_timeout, !reachable, reachable ? 4500 : 6000); }
      // Coming back to the field brings an earlier conversation back into view (not when the panel's own
      // hide or clear button just sent focus here).
      if (history.length && panel.hidden && !panel.contains(event?.relatedTarget)) setOpen(true);
    };
    input.addEventListener('focus', onFocus, { signal });
    input.addEventListener('blur', setTyping, { signal });
    find('close').addEventListener('click', () => { setOpen(false); input.focus({ preventScroll: true }); }, { signal });
    find('clear').addEventListener('click', () => { reset(); setOpen(false); input.focus({ preventScroll: true }); }, { signal });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || panel.hidden) return;
      setOpen(false); input.focus({ preventScroll: true });
    }, { signal });

    // Availability and provider reachability (cached by the server); sending stays possible either way.
    const check = new AbortController();
    const checkTimeout = setTimeout(() => check.abort(), 10000);
    signal.addEventListener('abort', () => check.abort(), { once: true });
    fetch('/api/chat?probe=1', { signal: check.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (signal.aborted) return;
      const configuredModel = typeof data.model === 'string' ? data.model.trim() : '';
      if (configuredModel) { assistantLabel = configuredModel; find('model').textContent = configuredModel; }
      available = data.available === true;
      reachable = data.reachable !== false;
      if (!available) { input.disabled = true; input.placeholder = errors.not_configured; }
      else if (!reachable && document.activeElement === input) notice(errors.provider_connect_timeout, true, 6000);
      if (!active) setWorking(false);
    }).catch(() => {}).finally(() => clearTimeout(checkTimeout));

    setWorking(false); setTyping();
    // The first focus is what loaded this script, so it has already happened.
    if (document.activeElement === input) onFocus();
    if (form.dataset.queued !== undefined) submit();
    return () => {
      reset(); check.abort(); clearTimeout(checkTimeout); clearTimeout(toastTimer); clearTimeout(hideTimer);
      panel.remove(); toast.remove(); context.remove();
      document.documentElement.classList.remove('aden-ask-has-context');
      document.documentElement.classList.remove('aden-chat-open');
      form.classList.remove('is-working', 'is-typing');
    };
  });
})();
