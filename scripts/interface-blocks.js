'use strict';

// Style italic figure captions before translation. Styles live in lib/styles/cyber.css.
function interfaceBlocks(html) {
  return html.replace(/<p><em>(图\s*\d+)[：:]\s*([\s\S]*?)<\/em><\/p>/g,
    '<p class="aden-caption"><span class="aden-caption-label">$1</span><span class="aden-caption-text">$2</span></p>');
}

if (typeof hexo !== 'undefined') {
  // Priority 5: before Hexo's own excerpt filter (10), so home-page excerpts match.
  hexo.extend.filter.register('after_post_render', data => {
    data.content = interfaceBlocks(data.content);
    return data;
  }, 5);
}

module.exports = { interfaceBlocks };
