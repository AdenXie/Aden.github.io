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
const sizeOf = target => {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  return stat.isDirectory() ? walk(target).reduce((sum, file) => sum + fs.statSync(file).size, 0) : stat.size;
};
const remove = target => {
  const bytes = sizeOf(target);
  if (bytes) fs.rmSync(target, { recursive: true, force: true });
  return bytes;
};
function localize(url) {
  return url.replace(/^https?:\/\/[^/]+\/projects\/hexo-theme-redefine@2\.9\.0\/source\//, '/');
}
function pruneOutput(out) {
  const files = walk(out);
  const pagesAndScripts = files
    .filter(file => /\.(?:html|js)$/.test(file))
    .map(file => fs.readFileSync(file, 'utf8'))
    .join('\n');
  const references = pathname => pagesAndScripts.includes(pathname);
  let bytes = 0;

  // Hexo copies both the theme sources and its browser bundles. Production pages
  // use only the bundles, so retaining the sources doubles most JavaScript.
  for (const directory of ['libs', 'app', 'layouts', 'plugins', 'state', 'tools', 'utils']) {
    bytes += remove(path.join(out, 'js', directory));
  }
  for (const file of ['main.js', 'build.js']) bytes += remove(path.join(out, 'js', file));

  // These large optional libraries are copied into the bundle directory but are
  // not referenced by any generated page or production script.
  for (const file of ['exif-reader.js', 'mermaid.min.js', 'moment-with-locales.min.js', 'moment.min.js', 'waline.js']) {
    const pathname = `/js/build/libs/${file}`;
    if (!references(pathname)) bytes += remove(path.join(out, pathname));
  }

  // Stylesheets have already been folded into content-addressed site bundles.
  // Keep the few page-specific sheets that are still linked directly.
  for (const file of fs.readdirSync(path.join(out, 'css'))) {
    if (!file.endsWith('.css') || /^site-[a-f0-9]+\.css$/.test(file)) continue;
    const pathname = `/css/${file}`;
    if (!references(pathname)) bytes += remove(path.join(out, pathname));
  }
  if (!references('/fontawesome/')) bytes += remove(path.join(out, 'fontawesome'));

  // Only the solid, regular and brand icon styles occur in generated HTML/JS.
  // If a future page uses another style, keep all fonts so that build remains safe.
  const usesOptionalIconStyle = /(?:^|[\s"'`])(?:fad|fal|fat|fass|fa-duotone|fa-light|fa-thin|fa-sharp(?:-solid)?)(?=$|[\s"'`])/m.test(pagesAndScripts);
  if (!usesOptionalIconStyle) {
    for (const prefix of ['fa-duotone-900', 'fa-light-300', 'fa-sharp-solid-900', 'fa-thin-100', 'fa-v4compatibility']) {
      for (const file of fs.readdirSync(path.join(out, 'webfonts')).filter(name => name.startsWith(prefix))) {
        bytes += remove(path.join(out, 'webfonts', file));
      }
    }
  }

  if (!references('/images/home-hero.jpg')) bytes += remove(path.join(out, 'images', 'home-hero.jpg'));
  return bytes;
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
  for (const file of walk(out).filter(f => /[\\/]js[\\/](?:en[\\/])?(?:site-runtime|cyber-weather|cyber-exchange|world-time|theme-default|chat)\.js$/.test(f))) {
    let text = fs.readFileSync(file, 'utf8');
    text = text.replace("'/vendor/twikoo/twikoo.all.min.js'", JSON.stringify(version('/vendor/twikoo/twikoo.all.min.js')));
    fs.writeFileSync(file, (await transform(text, { minify: true, target: 'es2020', legalComments: 'inline' })).code);
  }
  const iconRange = await require('./subset-icons.cjs').subsetIcons(out, walk(out));
  const chatCSS = path.join(out, 'css/chat.css');
  if (fs.existsSync(chatCSS)) fs.writeFileSync(chatCSS, new CleanCSS({ level: 1, rebase: false }).minify(fs.readFileSync(chatCSS, 'utf8')).styles);
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
  const prunedBytes = pruneOutput(out);
  console.log(`Optimized ${directory}: ${bundles.size} stylesheet bundles; responsive hero and versioned local assets; pruned ${(prunedBytes / 1024 / 1024).toFixed(2)} MiB.`);
}
module.exports = { optimize, localize, pruneOutput };
if (require.main === module) optimize(process.argv[2]).catch(e => { console.error(e); process.exitCode = 1; });
