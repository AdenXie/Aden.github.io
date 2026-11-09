const { test } = require('node:test');
const assert = require('node:assert/strict');
const { interfaceBlocks } = require('../scripts/interface-blocks.js');

test('italic figure captions become subtitle captions; other italics are untouched', () => {
  assert.equal(interfaceBlocks('<p><em>图 2：核心通胀仅 2.6%。</em></p>'), '<p class="aden-caption"><span class="aden-caption-label">图 2</span><span class="aden-caption-text">核心通胀仅 2.6%。</span></p>');
  assert.equal(interfaceBlocks('<p><em>注：仅供参考</em></p>'), '<p><em>注：仅供参考</em></p>');
});
