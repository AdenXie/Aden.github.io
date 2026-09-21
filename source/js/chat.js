/* Temporary chat: page memory only. No browser storage, cookies or analytics. */
(() => {
  'use strict';
  window.AdenSite.register('chat', '#aden-chat', (root, scope) => {
    const en = document.documentElement.lang.startsWith('en');
    const t = (zh, english) => en ? english : zh;
    const find = name => root.querySelector(`[data-chat="${name}"]`);
    const input = find('input'), form = find('form'), send = find('send'), stop = find('stop');
    const transcript = find('messages'), empty = find('empty'), status = find('status');
    let history = [], active = null, available = false, assistantLabel = 'AI ASSISTANT';
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
      transcript.setAttribute('aria-busy', String(!!active));
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
      input.value = ''; controls(); scroll();
      setStatus(t('正在连接模型…', 'Connecting to the model…'));
      let answer = '', complete = false, reader, frame = null;
      const update = () => {
        frame = null;
        if (active !== controller || scope.signal.aborted) return;
        const atBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 100;
        reply.body.textContent = answer;
        if (atBottom) scroll();
      };
      try {
        const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [...history, { role: 'user', content: prompt }] }), signal: controller.signal, cache: 'no-store' });
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
              setStatus(t('正在生成…', 'Writing…'));
              if (frame === null) frame = requestAnimationFrame(update);
            }
            if (data.done) {
              complete = true;
              setStatus(data.truncated ? t('回答达到长度上限，可以继续追问。', 'Response length limit reached. You can ask a follow-up.') : t('可以继续追问，或清空开始新的对话。', 'Ask a follow-up, or clear this chat to start again.'));
              break;
            }
          }
        }
        if (!complete || !answer.trim()) throw new Error('interrupted');
        history.push({ role: 'user', content: prompt }, { role: 'assistant', content: answer });
      } catch (error) {
        if (active !== controller || scope.signal.aborted) return;
        const stopped = controller.signal.aborted && !controller.timedOut;
        const text = stopped ? t('已停止。可重新发送问题。', 'Stopped. You can send your question again.') : errors[controller.timedOut ? 'timeout' : error.message] || errors.interrupted;
        setStatus(text, !stopped);
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
    form.addEventListener('submit', submit, { signal: scope.signal });
    input.addEventListener('input', controls, { signal: scope.signal });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !matchMedia('(pointer: coarse)').matches) { event.preventDefault(); form.requestSubmit(); }
    }, { signal: scope.signal });
    stop.addEventListener('click', () => active?.abort(), { signal: scope.signal });
    find('clear').addEventListener('click', () => { reset(); input.focus(); }, { signal: scope.signal });
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
      setStatus(available ? t('对话仅在当前页面保留。', 'This conversation stays only on this page.') : errors.not_configured);
    }).catch(() => {
      if (!scope.signal.aborted) { available = true; controls(); setStatus(t('服务状态暂不可用，可以尝试发送。', 'Service status unavailable. You can try sending a message.')); }
    }).finally(() => clearTimeout(checkTimeout));
    return () => { reset(); check.abort(); clearTimeout(checkTimeout); };
  });
})();
