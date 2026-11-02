'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { groupPosts, categoryCards, monthName } = require('../scripts/archive-view.js');

const post = (title, date, categories = []) => ({ title, date: new Date(date), path: `/${title}/`, categories: categories.map(name => ({ name })) });

test('archive groups newest year and month first, and keeps every post once', () => {
  const posts = [
    post('a', '2026-11-02T08:00:00+08:00'),
    post('b', '2026-11-01T23:30:00+08:00'),
    post('c', '2026-10-31T20:00:00+08:00'),
    post('d', '2024-03-02T08:00:00+08:00'),
  ];
  const groups = groupPosts(posts);
  assert.deepEqual(groups.map(group => group.year), ['2026', '2024']);
  assert.deepEqual(groups.map(group => group.count), [3, 1]);
  assert.deepEqual(groups[0].months.map(month => month.month), ['11', '10']);
  assert.deepEqual(groups[0].months[0].posts.map(p => p.title), ['a', 'b']);
  assert.equal(groups.flatMap(group => group.months.flatMap(month => month.posts)).length, posts.length);
});

test('months follow Asia/Shanghai, not the offset written in the post date', () => {
  // 2026-11-01 00:30 in +11:00 is 2026-10-31 21:30 in Shanghai.
  const groups = groupPosts([post('edge', '2026-11-01T00:30:00+11:00')]);
  assert.equal(groups[0].months[0].month, '10');
});

test('English month names and Chinese month labels', () => {
  assert.equal(monthName('11', true), 'November');
  assert.equal(monthName('08', false), '8 月');
});

test('category cards are largest first, keep three newest posts, and mark large categories', () => {
  const posts = [
    post('p1', '2026-10-01T08:00:00+08:00'),
    post('p2', '2026-10-05T08:00:00+08:00'),
    post('p3', '2026-10-03T08:00:00+08:00'),
    post('p4', '2026-10-04T08:00:00+08:00'),
  ];
  const big = { name: 'Brief', path: '/daily/', posts: { toArray: () => Array.from({ length: 12 }, (_, i) => post(`b${i}`, `2026-09-${String(i + 1).padStart(2, '0')}T08:00:00+08:00`)), length: 12 } };
  const small = { name: 'Notes', path: '/notes/', posts: { toArray: () => posts, length: 4 } };
  const empty = { name: 'Empty', path: '/empty/', posts: { toArray: () => [], length: 0 } };
  const child = { name: 'Child', path: '/child/', parent: 'x', posts: { toArray: () => [posts[0]], length: 1 } };
  const cards = categoryCards([small, empty, child, big]);
  assert.deepEqual(cards.map(card => card.name), ['Brief', 'Notes']);
  assert.equal(cards[0].major, true);
  assert.equal(cards[1].major, false);
  assert.deepEqual(cards[1].recent.map(p => p.title), ['p2', 'p4', 'p3']);
});
