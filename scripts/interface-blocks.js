'use strict';

// Article blocks drawn as interface panels; styles live in lib/styles/cyber.css.
// Runs on the rendered post, before translation, so the English build only
// translates the text inside these blocks.
//   > [!NOTE] text      -> notes bar ([!WARNING] gives the same single style)
//   *图 1：说明*         -> subtitle-style figure caption
const ICON = '<svg class="aden-alert-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v5m0 2.5v.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function interfaceBlocks(html) {
  return html
    .replace(/<blockquote>\s*<p>\[!(WARNING|NOTE)\]\s*(?:<br\s*\/?>)?\s*([\s\S]*?)<\/blockquote>/g, (match, type, body) =>
      `<div class="aden-alert" role="note">${ICON}<div class="aden-alert-frame"><p>${body}</div><span class="aden-alert-meta" aria-hidden="true">NOTES</span></div>`)
    .replace(/<p><em>(图\s*\d+)[：:]\s*([\s\S]*?)<\/em><\/p>/g,
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
