'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repository = 'AdenXie/Aden.github.io';
const author = 'adenxie';
const emails = new Set(['2140700032@qq.com', '89302318+adenxie@users.noreply.github.com']);
const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' });
const dayMs = 86400000;
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function articleCommits(root, start) {
  const log = git(root, ['log', 'source', '--since-as-filter=' + start, '--format=%H%x09%aI%x09%ae%x09%s',
    '--diff-filter=A', '-M', '--no-merges', '--', ':(glob)source/_posts/**/*.md']);
  return log.trim().split(/\r?\n/).filter(Boolean).flatMap(line => {
    const [id, date, email, ...subject] = line.split('\t');
    return emails.has(email.toLowerCase()) ? [{ id, date: day.format(new Date(date)), title: subject.join(' ').slice(0, 240) }] : [];
  });
}

async function mergedPulls(token, start) {
  const entries = [];
  const signal = AbortSignal.timeout(12000);
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/repos/${repository}/pulls?state=closed&base=source&per_page=100&page=${page}`;
    const response = await fetch(url, { signal, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const pulls = await response.json();
    for (const pull of pulls) {
      if (pull.user?.login.toLowerCase() !== author || !pull.merged_at) continue;
      const date = day.format(new Date(pull.merged_at));
      if (date >= start) entries.push({ id: pull.number, date, title: pull.title.slice(0, 240) });
    }
    if (pulls.length < 100) return entries;
  }
}

async function buildBlogActivity(root) {
  const now = new Date();
  const end = day.format(now);
  const start = new Date(Date.parse(end) - 363 * dayMs).toISOString().slice(0, 10);
  const posts = articleCommits(root, new Date(Date.parse(start) - dayMs).toISOString());
  let prs = null;
  let prsAsOf = null;
  try {
    if (!process.env.BLOG_ACTIVITY_GITHUB_TOKEN) throw new Error('GitHub token absent');
    prs = await mergedPulls(process.env.BLOG_ACTIVITY_GITHUB_TOKEN, start);
    prsAsOf = now.toISOString();
  } catch (error) {
    console.warn(`Blog activity PR snapshot unavailable: ${error.message}`);
    try {
      const previous = JSON.parse(git(root, ['show', 'origin/main:about/activity.json']));
      if (Array.isArray(previous.prs) && previous.prsAsOf) {
        prs = previous.prs;
        prsAsOf = previous.prsAsOf;
      }
    } catch { /* First build without a PR snapshot. */ }
  }
  const inWindow = event => event.date >= start && event.date <= end;
  fs.writeFileSync(path.join(root, 'public/about/activity.json'),
    JSON.stringify({ start, end, posts: posts.filter(inWindow), prs: prs?.filter(inWindow) ?? null, prsAsOf }));
}

module.exports = { buildBlogActivity };
