'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
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
  require('./check-output.cjs').checkOutput();
}
main().catch(e => { console.error(e); process.exitCode = 1; });
