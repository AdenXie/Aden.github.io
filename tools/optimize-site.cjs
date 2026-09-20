'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cheerio = require('cheerio');
const sharp = require('sharp');
const CleanCSS = require('clean-css');
const { transform } = require('esbuild');
const ROOT = path.resolve(__dirname, '..');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
function localize(url) {
  return url.replace(/^https?:\/\/[^/]+\/projects\/hexo-theme-redefine@2\.9\.0\/source\//, '/');
}
async function optimize(directory = 'public') {
  const out = path.resolve(ROOT, directory);
  for (const file of walk(out)) {
    if (file.endsWith('.map')) fs.rmSync(file);
  }
  const assetPath = url => path.join(out, decodeURI(url.split(/[?#]/)[0]));
  const version = url => {
    if (!url.startsWith('/') || url.startsWith('//')) return url;
    const file = assetPath(url);
    return fs.existsSync(file) && fs.statSync(file).isFile() ? url.split('?')[0] + '?v=' + digest(fs.readFileSync(file)) : url;
  };
  fs.mkdirSync(path.join(out, 'images'), { recursive: true });
  const original = path.join(ROOT, 'lib/images/home-hero-original.jpg');
  const metadata = await sharp(original).metadata();
  for (const width of [640, 960, 1280, 1920]) await sharp(original).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(out, `images/hero-${width}.webp`));
  fs.mkdirSync(path.join(out, 'vendor/twikoo'), { recursive: true });
  for (const name of ['twikoo.all.min.js', 'twikoo.all.min.js.LICENSE.txt']) fs.copyFileSync(path.join(ROOT, 'node_modules/twikoo/dist', name), path.join(out, 'vendor/twikoo', name));
  for (const file of walk(out).filter(f => /[\\/]js[\\/](?:en[\\/])?(?:site-runtime|cyber-weather|cyber-exchange|world-time|theme-default)\.js$/.test(f))) {
    let text = fs.readFileSync(file, 'utf8');
    text = text.replace("'/vendor/twikoo/twikoo.all.min.js'", JSON.stringify(version('/vendor/twikoo/twikoo.all.min.js')));
    fs.writeFileSync(file, (await transform(text, { minify: true, target: 'es2020', legalComments: 'inline' })).code);
  }
  const iconRange = await require('./subset-icons.cjs').subsetIcons(out, walk(out));
  const bundles = new Map();
  for (const file of walk(out).filter(f => f.endsWith('.html'))) {
    const $ = cheerio.load(fs.readFileSync(file, 'utf8'));
    // Translation snapshots can contain older asset wiring. Normalize those too.
    $('[src],link[href]').each((_, el) => {
      const attr = el.tagName === 'link' ? 'href' : 'src';
      if ($(el).attr(attr)) $(el).attr(attr, localize($(el).attr(attr)));
    });
    $('script:not([src])').each((_, el) => {
      let text = $(el).html() || '';
      if (text.includes('runTwikoo')) { $(el).remove(); return; }
      text = text.replace(/"preload":true/g, '"preload":false');
      $(el).text(text);
    });
    $('script[src*="cdnjs.cloudflare.com/ajax/libs/twikoo/"]').remove();
    const comment = $('#twikoo-comment');
    if (comment.length && !comment.attr('data-env')) {
      const themeConfig = require('js-yaml').load(fs.readFileSync(path.join(ROOT, '_config.redefine.yml'), 'utf8'));
      comment.attr('data-env', themeConfig.comment.config.twikoo.server_url).attr('style', 'min-height:220px');
    }
    $('script[src*="/js/site-runtime.js"]').remove();
    $('head').prepend('<script src="/js/site-runtime.js" defer></script>');
    if (!$('.home-content-container').length) $('script[src*="cyber-weather.js"],script[src*="cyber-exchange.js"]').remove();
    if (!$('.essay-date').length) $('script[src*="moment-with-locales.min.js"]').remove();
    if (!$('#subtitle').length) $('script[src*="Typed.min.js"]').remove();
    $('script[src*="vercount"]').attr('async', '');
    const backgrounds = $('.home-banner-background img');
    backgrounds.each((_, el) => {
      $(el).attr({ src: '/images/hero-1280.webp', srcset: [640, 960, 1280, 1920].map(w => `${version(`/images/hero-${w}.webp`)} ${w}w`).join(', '), sizes: '(max-aspect-ratio: 3/4) 83vh, 125vw', width: String(metadata.width), height: String(metadata.height), fetchpriority: 'high', decoding: 'async', loading: 'eager' });
    });
    // Both color modes use the same photo, so one element preserves their exact crop.
    if (backgrounds.length === 2) { backgrounds.first().removeClass('dark:hidden hidden').addClass('block'); backgrounds.last().remove(); }
    $('link[data-aden-hero]').remove();
    if (backgrounds.length) $('head').append($('<link rel="preload" as="image" fetchpriority="high" data-aden-hero>').attr({ imagesrcset: [640, 960, 1280, 1920].map(w => `${version(`/images/hero-${w}.webp`)} ${w}w`).join(', '), imagesizes: '(max-aspect-ratio: 3/4) 83vh, 125vw' }));
    $('img').each((_, el) => {
      if ($(el).closest('.home-banner-background').length) return;
      $(el).attr('decoding', 'async');
      if ($(el).closest('.home-article-list,.markdown-body,.article-content,.post-content').length) $(el).attr('loading', 'lazy');
      if ($(el).closest('.home-article-thumbnail').length && $(el).attr('src') && !$(el).attr('lazyload')) {
        const fallback = $.html(el);
        $(el).after(`<noscript>${fallback}</noscript>`);
        $(el).attr({ 'data-src': $(el).attr('src'), lazyload: '', src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E' });
      }
    });
    for (const el of $('img[src^="/"]').toArray()) {
      if ($(el).attr('width') && $(el).attr('height')) continue;
      const src = assetPath($(el).attr('src'));
      if (!fs.existsSync(src)) continue;
      try { const m = await sharp(src).metadata(); $(el).attr({ width: String(m.width), height: String(m.height) }); } catch { /* Non-raster images keep their existing layout. */ }
    }
    const links = $('head link[rel="stylesheet"]').toArray().filter(el => { const u = $(el).attr('href'); return u?.startsWith('/') && fs.existsSync(assetPath(u)); });
    const key = links.map(el => $(el).attr('href')).join('|');
    if (links.length) {
      let bundle = bundles.get(key);
      if (!bundle) {
        const css = links.map(el => {
          const url = $(el).attr('href').split('?')[0];
          let text = fs.readFileSync(assetPath(url), 'utf8');
          // The full font remains a fallback for icons added dynamically after the build.
          if (url.startsWith('/fontawesome/')) text = text.replace(/@font-face\{[^{}]+fa-(?:solid-900|regular-400|brands-400)\.woff2[^{}]+\}/g, face => face + face.replace(/src:[^;}]*/, src => src.replace(/fa-(solid-900|regular-400|brands-400)\.woff2/g, 'fa-$1-site.woff2')).replace(/}$/, `;unicode-range:${iconRange}}`));
          return text.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g, (match, quote, value) => {
            if (/^(?:data:|https?:|\/\/|#)/.test(value)) return match;
            const absolute = new URL(value, 'https://local.test' + url).pathname;
            return `url("${version(absolute)}")`;
          });
        }).join('\n');
        const result = new CleanCSS({ level: 1, rebase: false }).minify(css);
        if (result.errors.length) throw new Error(result.errors.join('\n'));
        bundle = `/css/site-${digest(result.styles)}.css`;
        fs.writeFileSync(assetPath(bundle), result.styles); bundles.set(key, bundle);
      }
      $(links[0]).attr('href', bundle);
      links.slice(1).forEach(el => $(el).remove());
    }
    $('script[src],link[href],img[src]').each((_, el) => { const attr = el.tagName === 'link' ? 'href' : 'src'; $(el).attr(attr, version($(el).attr(attr))); });
    fs.writeFileSync(file, $.html());
  }
  console.log(`Optimized ${directory}: ${bundles.size} stylesheet bundles; responsive hero and versioned local assets.`);
}
module.exports = { optimize, localize };
if (require.main === module) optimize(process.argv[2]).catch(e => { console.error(e); process.exitCode = 1; });
