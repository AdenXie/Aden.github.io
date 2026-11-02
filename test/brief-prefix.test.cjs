'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitBriefPrefix } = require('../tools/lib/brief-prefix.cjs');

test('Chinese brief titles give up the date prefix and keep the headline', () => {
  assert.deepEqual(splitBriefPrefix('每日简报｜2026-11-02：三部门今日开会研究稳市工具', false), {
    prefix: '每日简报｜2026-11-02：',
    rest: '三部门今日开会研究稳市工具',
  });
});

test('English brief titles in each form seen in the translation cache', () => {
  assert.equal(splitBriefPrefix('Daily Briefing | 2026-08-24: AI Race Heats Up', true).rest, 'AI Race Heats Up');
  assert.equal(splitBriefPrefix('Daily Briefing | August 24, 2026: AI Competition', true).rest, 'AI Competition');
  assert.equal(splitBriefPrefix('Daily Briefing | 1 November 2026: China’s PMI falls back', true).rest, 'China’s PMI falls back');
});

test('titles that do not match keep their text (null means no change)', () => {
  assert.equal(splitBriefPrefix('同一周内，宏观和微观对 AI 资本开支给出了相反的判决', false), null);
  assert.equal(splitBriefPrefix('Anthropic 正式公开 S-1 招股书', true), null);
  // A Chinese prefix is not a match on an English page, and the reverse.
  assert.equal(splitBriefPrefix('每日简报｜2026-11-02：三部门', true), null);
  assert.equal(splitBriefPrefix('Daily Briefing | 2026-08-24: AI', false), null);
});

test('a title that is only the prefix is left alone, and an empty title is safe', () => {
  assert.equal(splitBriefPrefix('每日简报｜2026-11-02：', false), null);
  assert.equal(splitBriefPrefix('', false), null);
  assert.equal(splitBriefPrefix(undefined, true), null);
});

test('applying the split again changes nothing (the rest does not start with a prefix)', () => {
  const once = splitBriefPrefix('每日简报｜2026-11-02：三部门今日开会', false).rest;
  assert.equal(splitBriefPrefix(once, false), null);
});
