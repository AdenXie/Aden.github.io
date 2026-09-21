'use strict';

module.exports = function renderChat(en = false) {
  const t = (zh, english) => en ? english : zh;
  return `<link rel="stylesheet" href="/css/chat.css">
<section id="aden-chat" translate="no" aria-label="${t('临时 AI 对话', 'Temporary AI chat')}">
  <header class="chat-heading"><div><span class="chat-label">ADEN'S SPACE / GLM-4.7-FLASH</span><h2>${t('想聊点什么？', 'What’s on your mind?')}</h2><p>${t('一个问题，一点灵感，或一起理清思路。', 'A question, a spark of inspiration, or room to think.')}</p></div><button type="button" data-chat="clear">${t('清空对话', 'Clear chat')}</button></header>
  <div class="chat-transcript" data-chat="messages" role="region" aria-label="${t('对话内容', 'Conversation')}" tabindex="0">
    <div class="chat-empty" data-chat="empty"><span class="chat-spark" aria-hidden="true">✳</span><p>${t('从你的第一个问题开始', 'Start with your first question')}</p><span>${t('可以连续追问。刷新或离开页面后，对话即清空。', 'Ask follow-up questions. Refreshing or leaving clears this chat.')}</span></div>
  </div>
  <form data-chat="form" class="chat-composer">
    <label for="chat-input" class="chat-input-label">${t('你的消息', 'Your message')}</label>
    <textarea id="chat-input" data-chat="input" rows="3" maxlength="4000" autocomplete="off" placeholder="${t('在这里输入问题…', 'Type your question here…')}"></textarea>
    <div class="chat-composer-footer"><span class="chat-key-hint">${t('Enter 发送 · Shift + Enter 换行', 'Enter to send · Shift + Enter for a new line')}</span><div><button type="button" data-chat="stop" hidden>${t('停止生成', 'Stop')}</button><button type="submit" data-chat="send" disabled>${t('发送', 'Send')} <span aria-hidden="true">↑</span></button></div></div>
  </form>
  <p data-chat="status" class="chat-status" role="status" aria-live="polite">${t('正在连接聊天服务…', 'Connecting to chat…')}</p>
  <p class="chat-privacy">${t('本站不保存对话。消息会发送至智谱 AI，数据处理以其政策为准。AI 回答可能有误，请核对重要信息。', 'This site does not save conversations. Messages are sent to Zhipu AI under its data policies. AI can make mistakes; check important information.')}</p>
  <noscript>${t('请启用 JavaScript 以使用聊天。', 'Enable JavaScript to use chat.')}</noscript>
</section><script src="/js/chat.js" defer data-swup-reload-script></script>`;
};
