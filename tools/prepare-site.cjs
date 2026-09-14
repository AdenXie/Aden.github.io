'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('esbuild');
const ROOT = path.resolve(__dirname, '..');
const upstream = path.join(ROOT, 'node_modules/hexo-theme-redefine');
const target = path.join(ROOT, 'themes/redefine');
function replace(file, before, after) {
  const dest = path.join(target, file), text = fs.readFileSync(dest, 'utf8');
  if (!text.includes(before)) throw new Error(`Theme adapter no longer matches ${file}`);
  fs.writeFileSync(dest, text.replace(before, after));
}
async function prepare() {
  if (require(path.join(upstream, 'package.json')).version !== '2.9.0') throw new Error('Review the theme adapter before upgrading Redefine');
  const manifest = require('../lib/theme-adapter-checksums.json');
  for (const [file, expected] of Object.entries(manifest)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(upstream, file))).digest('hex');
    if (actual !== expected) throw new Error(`Unexpected upstream change: ${file}`);
  }
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(upstream, target, { recursive: true, filter: source => !source.split(path.sep).includes('.git') });
  const sharp = require('sharp');
  fs.mkdirSync(path.join(target, 'source/images'), { recursive: true });
  await sharp(path.join(ROOT, 'lib/images/home-hero-original.jpg')).rotate().resize({ width: 1280 }).webp({ quality: 80 }).toFile(path.join(target, 'source/images/hero-1280.webp'));
  const search = 'source/js/tools/localSearch.js';
  replace(search, 'let isFetched = false;', 'let isFetched = false;\nlet pendingFetch = null;');
  replace(search, 'if (isFetched || !cachedPath)', 'if (isFetched || pendingFetch || !cachedPath)');
  replace(search, '  fetch(config.root + cachedPath)', `  const status = document.querySelector('#no-result');
  if (status) status.textContent = document.documentElement.lang.startsWith('en') ? 'Loading search…' : '正在加载搜索…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  pendingFetch = fetch(config.root + cachedPath, { signal: controller.signal })`);
  replace(search, '.then((response) => response.text())', '.then((response) => { if (!response.ok) throw new Error("Search unavailable"); return response.text(); })');
  replace(search, '      isFetched = true;', '      // Mark ready only after parsing succeeds.');
  replace(search, '      cachedData = normalizeData(cachedData);', '      cachedData = normalizeData(cachedData);\n      isFetched = true;');
  replace(search, '    })\n    .catch((error) => {', '      renderSearchResult(document.querySelector(".search-input"));\n    })\n    .catch((error) => {');
  replace(search, '      console.error("Failed to load search data:", error);', `      console.error("Failed to load search data:", error);
      if (status) status.textContent = document.documentElement.lang.startsWith('en') ? 'Search unavailable. Close and reopen to retry.' : '搜索暂不可用，请关闭后重新打开重试。';`);
  replace(search, '    });\n};\n\nconst getSearchDom', '    }).finally(() => { clearTimeout(timeout); pendingFetch = null; });\n};\n\nconst getSearchDom');
  // APlayer defaults to preload:auto; preserve its UI but never download audio before play.
  for (const marker of ['      mini: true,', '      fixed: true,']) replace('source/js/plugins/aplayer.js', marker, marker + '\n      preload: "none",');
  replace('source/js/plugins/aplayer.js', '      lrcType: 3,', '      lrcType: audioList.some(audio => audio.lrc) ? 3 : 0,');
  replace('source/js/plugins/aplayer.js', 'document.querySelector(".aplayer-icon-lrc").click();', 'document.querySelector(".aplayer-icon-lrc")?.click();');
  replace('source/js/plugins/typed.js', '    fetch(usrHitokotoAPI)', `    createTyped(id, normalizeSubtitleText(subtitleConfig.text), options);
    const quoteRequest = new AbortController();
    const quoteTimeout = setTimeout(() => quoteRequest.abort(), 8000);
    fetch(usrHitokotoAPI, { signal: quoteRequest.signal })`);
  replace('source/js/plugins/typed.js', 'console.error("Failed to fetch hitokoto:", error);\n      });', 'console.error("Failed to fetch hitokoto:", error);\n      }).finally(() => clearTimeout(quoteTimeout));');
  replace('source/js/plugins/typed.js', 'export default function initTyped(id) {', 'export default function initTyped(id) {\n  if (!document.getElementById(id)) return;');
  replace('source/js/tools/runtime.js', '  const startDate = new Date(startTime);', '  if (document.hidden) return;\n  const startDate = new Date(startTime);');
  fs.copyFileSync(path.join(ROOT, 'lib/theme/twikoo.ejs'), path.join(target, 'layout/components/comments/twikoo.ejs'));
  // Keep the complete upstream source in the generated theme; bundle only its entry graph.
  await build({ entryPoints: [path.join(target, 'source/js/main.js')], outfile: path.join(target, 'source/js/build/main.js'), bundle: true, minify: true, format: 'esm', target: 'es2020' });
  await build({ entryPoints: [path.join(target, 'source/js/plugins/aplayer.js')], outfile: path.join(target, 'source/js/build/plugins/aplayer.js'), minify: true, target: 'es2020' });
  const css = require('clean-css');
  const parts = ['base', 'home-cards', 'pages'];
  const result = new css({ level: 1 }).minify(parts.map(name => fs.readFileSync(path.join(ROOT, `lib/styles/${name}.css`), 'utf8')).join('\n'));
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  fs.mkdirSync(path.join(target, 'source/css'), { recursive: true });
  fs.writeFileSync(path.join(target, 'source/css/custom.css'), result.styles);
}
module.exports = { prepare };
if (require.main === module) prepare().catch(e => { console.error(e); process.exitCode = 1; });
