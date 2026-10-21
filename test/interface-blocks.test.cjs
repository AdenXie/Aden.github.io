const { test } = require('node:test');
const assert = require('node:assert/strict');
const { interfaceBlocks } = require('../scripts/interface-blocks.js');

test('[!WARNING] and [!NOTE] quotes become the same notes bar; plain quotes stay quotes', () => {
  const warning = interfaceBlocks('<blockquote>\n<p>[!WARNING] 不构成投资建议。</p>\n</blockquote>');
  assert.match(warning, /^<div class="aden-alert" role="note"><svg[^]*<div class="aden-alert-frame"><p>不构成投资建议。<\/p>\n<\/div><span class="aden-alert-meta" aria-hidden="true">NOTES<\/span><\/div>$/);
  const note = interfaceBlocks('<blockquote><p>[!NOTE]<br>数据截至 10 月 20 日。</p><p>第二段</p></blockquote>');
  assert.match(note, /^<div class="aden-alert" role="note">[^]*<p>数据截至 10 月 20 日。<\/p><p>第二段<\/p><\/div>[^]*NOTES/);
  assert.equal(interfaceBlocks('<blockquote><p>普通引用</p></blockquote>'), '<blockquote><p>普通引用</p></blockquote>');
});

test('italic figure captions become subtitle captions; other italics are untouched', () => {
  assert.equal(interfaceBlocks('<p><em>图 2：核心通胀仅 2.6%。</em></p>'), '<p class="aden-caption"><span class="aden-caption-label">图 2</span><span class="aden-caption-text">核心通胀仅 2.6%。</span></p>');
  assert.equal(interfaceBlocks('<p><em>注：仅供参考</em></p>'), '<p><em>注：仅供参考</em></p>');
});
