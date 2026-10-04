'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { prepare } = require('./prepare-site.cjs');
const { optimize } = require('./optimize-site.cjs');
const ROOT = path.resolve(__dirname, '..');
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, env: { ...process.env, TZ: 'Asia/Shanghai' }, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Build step failed: ${args.join(' ')}`);
}
async function main() {
  await prepare();
  const hexo = require.resolve('hexo/bin/hexo');
  run([hexo, 'clean']);
  run([hexo, 'generate']);
  run([hexo, 'generate', '--config', '_config.yml,_config.english.yml', '--force']);
  run([path.join(__dirname, 'build-bilingual.cjs')]);
  await optimize();
  fs.copyFileSync(path.join(ROOT, 'lib/README.main.md'), path.join(ROOT, 'public/README.md'));
  // Scheduled workflows must exist on GitHub's default (generated main) branch.
  // Initialize/update this workflow on main through an authorized GitHub user
  // before deployment: the CI token can preserve it but cannot create workflows.
  const workflows = path.join(ROOT, 'public/.github/workflows');
  fs.mkdirSync(workflows, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'lib/workflows/exchange-rates.yml'), path.join(workflows, 'exchange-rates.yml'));
  // Stylesheets request reading fonts with a ?v= content hash, so those responses never
  // change. Without this Vercel serves max-age=0 and every page view revalidates ~1 MB of fonts.
  const immutableFonts = { source: '/fonts/reading/(.*)', has: [{ type: 'query', key: 'v' }], headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] };
  // The chat page became a floating panel; old links open it on the matching home page.
  const chatRedirects = ['', '/en'].flatMap(prefix => [`${prefix}/chat`, `${prefix}/chat/`].map(source => ({ source, destination: `${prefix}/?chat=open`, permanent: false })));
  fs.writeFileSync(path.join(ROOT, 'public/vercel.json'), JSON.stringify({ git: { deploymentEnabled: { source: false, 'exchange-rates': false } }, functions: { 'api/chat.js': { maxDuration: 65 } }, headers: [immutableFonts], redirects: chatRedirects }, null, 2));
  require('./check-output.cjs').checkOutput();
}
main().catch(e => { console.error(e); process.exitCode = 1; });
