const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
const script = fs.readFileSync(path.join(__dirname, '../source/js/terminal.js'), 'utf8');
function load(lang = 'zh-CN') {
  const window = {};
  vm.runInNewContext(script, { window, document: { documentElement: { lang } }, location: { hostname: 'localhost' }, Intl, Date, setTimeout, clearTimeout });
  return window.AdenTerminal;
}

const index = [
  { t: '跳票四个月，换来一句 "I think it worked"', u: '/2026/11/21/2026-11-21-gemini-i-think-it-worked/', d: '2026-11-21', c: ['AI 与科技'], g: ['Gemini', '大模型'], s: '前几个月，Gemini 在不少人嘴里还是北美大豆包' },
  { t: '两个检验点的答案', u: '/2026/11/21/2026-11-21-two-checkpoints/', d: '2026-11-21', c: ['经济观察'], g: ['英伟达', 'AI 资本开支'], s: '我们上篇亲手设下的两个回调条件' },
  { t: '每日简报｜2026-11-20：英伟达', u: '/2026/11/20/2026-11-20-daily-brief/', d: '2026-11-20', c: ['每日简报'], g: ['新闻'], b: true, s: '' }
];

function harness(lang) {
  const terminal = load(lang);
  const lines = [], calls = [];
  const env = { index, now: () => new Date('2026-11-21T00:00:00Z'), place: () => 'Sydney', history: () => ['ls', 'help'],
    setPrompt: p => calls.push(['prompt', p]), clear: () => calls.push(['clear']), close: () => calls.push(['close']),
    navigate: url => calls.push(['navigate', url]), setTheme: want => want || 'light', switchLanguage: want => calls.push(['lang', want]),
    weather: async () => calls.push(['weather']), fx: async (out, range) => calls.push(['fx', range]), sky: async () => calls.push(['sky']),
    ask: async (out, question) => calls.push(['ask', question]) };
  const shell = terminal.createShell(env);
  const out = { line(segments) { lines.push(segments.map(s => (typeof s === 'string' ? s : s.text)).join('')); return { remove() {} }; }, block: () => ({}), scroll() {} };
  return { shell, lines, calls, run: line => shell.run(line, out, new AbortController().signal), text: () => lines.join('\n') };
}

test('tokenizer keeps quoted words together', () => {
  same(load().tokenize(`cd "tags/AI 资本开支" -a`), ['cd', 'tags/AI 资本开支', '-a']);
});

test('ls at home lists the directories; cd and ls list the articles without briefs', async () => {
  const h = harness();
  await h.run('ls');
  assert.match(h.text(), /posts\/.*daily\/.*tags\/.*categories\/.*about.*world-time/);
  await h.run('cd posts');
  assert.deepEqual(h.calls.at(-1), ['prompt', '~/posts']);
  await h.run('ls');
  assert.match(h.text(), /1 {2}2026-11-21 {2}跳票四个月/);
  assert.doesNotMatch(h.text(), /每日简报｜/);
});

test('tags are directories, matched case-insensitively, and open goes to the tag page', async () => {
  const h = harness();
  await h.run('cd tags/gemini');
  assert.deepEqual(h.calls.at(-1), ['prompt', '~/tags/Gemini']);
  await h.run('ls');
  assert.match(h.text(), /跳票四个月/);
  await h.run('open .');
  assert.deepEqual(h.calls.at(-1), ['navigate', '/tags/Gemini/']);
  await h.run('cd "../AI 资本开支"');
  assert.deepEqual(h.calls.at(-1), ['prompt', '~/tags/AI 资本开支']);
  await h.run('open .');
  assert.deepEqual(h.calls.at(-1), ['navigate', '/tags/AI-资本开支/']);
});

test('find ranks articles before briefs; cat and open use the listing numbers', async () => {
  const h = harness();
  await h.run('find 英伟达');
  assert.match(h.text(), /找到 2 篇/);
  assert.match(h.text(), /1 {2}2026-11-21 {2}两个检验点的答案[\s\S]*2 {2}2026-11-20 {2}每日简报/);
  await h.run('cat 1');
  assert.match(h.text(), /经济观察 {2}· {2}#英伟达/);
  await h.run('open');
  assert.deepEqual(h.calls.at(-1), ['navigate', '/2026/11/21/2026-11-21-two-checkpoints/']);
});

test('unknown commands suggest the nearest one; bad paths say so', async () => {
  const h = harness();
  await h.run('lsx');
  assert.match(h.text(), /找不到命令：lsx，是不是想输入 ls？/);
  await h.run('cd nowhere');
  assert.match(h.text(), /cd: 没有这个目录：nowhere/);
});

test('ask keeps the question as typed and data commands reach the page', async () => {
  const h = harness();
  await h.run('ask 这个博客 "用什么" 搭的？');
  assert.deepEqual(h.calls.at(-1), ['ask', '这个博客 "用什么" 搭的？']);
  await h.run('ask');
  assert.match(h.text(), /ask: 写下你的问题/);
  await h.run('fx 7d');
  assert.deepEqual(h.calls.at(-1), ['fx', '7d']);
});

test('completion covers commands, directories, tags and fixed arguments', () => {
  const { shell } = harness();
  same(shell.complete('he'), ['help']);
  same(shell.complete('cd ta'), ['tags/']);
  same(shell.complete('cd tags/Ge'), ['tags/Gemini/']);
  same(shell.complete('cd tags/AI'), ['tags/"AI 资本开支"/']);
  same(shell.complete('theme d'), ['dark']);
  same(shell.complete('fx '), ['7d', '30d', '90d']);
});

test('English pages answer in English', async () => {
  const h = harness('en');
  await h.run('lsx');
  assert.match(h.text(), /command not found: lsx; did you mean ls\?/);
  await h.run('help');
  assert.doesNotMatch(h.text(), /[一-鿿]/);
});

test('sparkline spans the eight levels', () => {
  assert.equal(load().sparkline([1, 2, 3, 4, 5, 6, 7, 8], 8), '▁▂▃▄▅▆▇█');
});
