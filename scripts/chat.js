'use strict';
const renderChat = require('../lib/chat-page.cjs');
hexo.extend.tag.register('temporary_chat', () => renderChat(hexo.config.language === 'en'));
