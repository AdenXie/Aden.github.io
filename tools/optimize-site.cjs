'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cheerio = require('cheerio');
const { splitBriefPrefix } = require('./lib/brief-prefix.cjs');
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
  for (const family of ['Geist', 'GeistMono']) {
    if (!references(`/fonts/${family}/`)) bytes += remove(path.join(out, 'fonts', family));
  }

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
    // Cached English pages can still reference the retired theme typefaces.
    $('link[href*="/fonts/Geist/"], link[href*="/fonts/GeistMono/"]').remove();
    $('link[data-aden-font-connect]').remove();
    $('head').append('<link rel="preconnect" href="https://cdn-file.hyperos.mi.com" crossorigin data-aden-font-connect>');
    $('.aden-font-credit').remove();
    const fontCredit = $('html').attr('lang')?.startsWith('en') ? 'Typeface' : '字体';
    $('footer .info-container').append(`<div class="aden-font-credit text-sm my-1">${fontCredit}: <a href="https://hyperos.mi.com/font/zh/download/" target="_blank" rel="noopener">MiSans</a></div>`);
    // Set the current policy after translation, including older English snapshots.
    {
      const english = $('html').attr('lang')?.startsWith('en');
      const contentLicense = '<a rel="license" href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>';
      const codeLicense = '<a href="https://github.com/AdenXie/Aden.github.io/blob/main/LICENSE" target="_blank" rel="noopener">GPL-3.0</a>';
      const scope = '<a href="https://github.com/AdenXie/Aden.github.io/blob/main/LICENSE-CONTENT.md" target="_blank" rel="noopener">' + (english ? 'Scope &amp; exceptions' : '范围与例外') + '</a>';
      $('.aden-license-notice').remove();
      $('footer .info-container').append(`<div class="aden-license-notice text-sm my-1">${english ? 'Original text &amp; images' : '原创文字与图片'}: ${contentLicense} · ${english ? 'Code' : '代码'}: ${codeLicense} · ${scope}</div>`);
      $('.article-copyright-info-container').each((_, el) => {
        if ($(el).is('[data-aden-custom-license]')) return;
        const item = $(el).find('li').last();
        const siteDefault = item.find('a.license[href^="https://creativecommons.org/licenses/by-nc-sa/4.0"]').length || /版权所有 © AdenXie，禁止转载。|All Rights Reserved © AdenXie/.test(item.text());
        // Preserve explicit per-article custom licences instead of relabelling them.
        if (!siteDefault) return;
        item.attr('data-aden-content-license', '').html(english
          ? `<strong>License:</strong> Unless otherwise noted, original text and images by AdenXie: ${contentLicense}; original code: ${codeLicense}. Third-party material retains its original rights and licenses. ${scope}.`
          : `<strong>版权声明:</strong> 除另有标注外，AdenXie 的原创文字与原创图片采用 ${contentLicense}，原创代码采用 ${codeLicense}。引用及第三方素材保留原有权利与许可。${scope}。`);
      });
    }
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
    // Run before rendering; normalize cached English snapshots as well.
    $('script[src*="/js/language-preference.js"]').remove();
    const languageScript = $('<script src="/js/language-preference.js"></script>');
    if (fs.existsSync(path.join(out, 'en/index.html'))) languageScript.attr('data-english-home', '/en/');
    $('head').prepend(languageScript);
    // Chat is a floating launcher on every page; its panel, script and styles load on first use.
    // Added after translation, and cached English snapshots may still list the retired chat page.
    $('.navbar-list a, .drawer-navbar-list a').filter((_, el) => /^\/(?:en\/)?chat\/$/.test($(el).attr('href') || '')).closest('li').remove();
    // Ask AI lives in the bottom dock as a real text field (lib/styles/dock.css). The chat script and its
    // styles load on first use (data-script / data-style, site-runtime.js); until then the field is a plain
    // form. Phones show a compact button that opens the field over the dock.
    $('#aden-chat-launcher, #aden-ask, .aden-ask-open').remove();
    {
      const english = $('html').attr('lang')?.startsWith('en');
      const label = english ? 'Ask AI' : '问 AI';
      $('body').append($(`<form id="aden-ask" class="aden-ask" novalidate>
  <span class="aden-ask-mark" aria-hidden="true">✳</span>
  <label class="aden-sr-only" for="aden-ask-input">${label}</label>
  <input id="aden-ask-input" class="aden-ask-input" type="text" maxlength="4000" autocomplete="off" enterkeyhint="send" placeholder="${english ? 'Ask AI…' : '问 AI…'}">
  <span class="aden-ask-thinking" role="status" hidden><span class="aden-ask-dots" aria-hidden="true">${'<i></i>'.repeat(9)}</span><span class="aden-ask-thinking-label"></span></span>
  <button type="submit" class="aden-ask-send" aria-label="${english ? 'Send' : '发送'}" disabled><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
  <button type="button" class="aden-ask-stop" aria-label="${english ? 'Stop' : '停止生成'}" hidden><i class="fa-solid fa-stop" aria-hidden="true"></i></button>
</form>`).attr({ 'aria-label': label, 'data-script': version('/js/chat.js'), 'data-style': version('/css/chat.css') }));
      $('body').append(`<button type="button" class="aden-ask-open" aria-controls="aden-ask" aria-expanded="false"><span aria-hidden="true">✳</span><span>${label}</span></button>`);
    }
    // Bottom dock (lib/styles/dock.css): the launcher and a phone menu button join the theme's tools in one
    // container. The theme's tool items are <li>s with click handlers; give them button semantics and names
    // so keyboards and screen readers can use them (site-runtime.js maps Enter and Space to click).
    {
      const english = $('html').attr('lang')?.startsWith('en');
      const dock = $('.right-side-tools-container').first();
      if (dock.length) {
        dock.attr({ role: 'toolbar', 'aria-label': english ? 'Quick tools' : '快捷工具' });
        dock.append($('#aden-ask'), $('.aden-ask-open'));
        dock.find('.aden-dock-menu, .aden-dock-toc, .aden-dock-music').remove();
        // Phones and tablets hide the article's side contents; a dock button opens them as a sheet.
        if ($('.post-toc ol.nav').length) dock.append(`<button type="button" class="aden-dock-toc" aria-haspopup="dialog" aria-expanded="false" aria-label="${english ? 'Contents' : '目录'}"><i class="fa-solid fa-list-ul" aria-hidden="true"></i></button>`);
        // Phones hide the music player; the settings popover offers play and pause for it.
        if ($('#aplayer').length) dock.find('.hidden-tools-list').append(`<li class="right-bottom-tools aden-dock-music" role="button" tabindex="0" aria-pressed="false" aria-label="${english ? 'Play music' : '播放音乐'}"><i class="fa-solid fa-play" aria-hidden="true"></i></li>`);
        if ($('#navbar-drawer').length) dock.append(`<button type="button" class="aden-dock-menu" aria-controls="navbar-drawer" aria-expanded="false" aria-label="${english ? 'Menu' : '菜单'}"><span class="aden-dock-bars" aria-hidden="true"></span></button>`);
        const names = {
          'toggle-tools-list': ['更多设置', 'More settings'],
          'tool-scroll-to-top': ['回到顶部', 'Back to top'],
          'tool-font-adjust-plus': ['放大字号', 'Larger text'],
          'tool-font-adjust-minus': ['缩小字号', 'Smaller text'],
          'tool-dark-light-toggle': ['切换深浅色', 'Toggle dark mode'],
          'tool-scroll-to-bottom': ['到页面底部', 'Go to bottom'],
          'tool-expand-width': ['切换页面宽度', 'Toggle page width'],
          'tool-aplayer': ['音乐播放器', 'Music player']
        };
        dock.find('li.right-bottom-tools').each((_, el) => {
          const item = $(el), key = Object.keys(names).find(name => item.hasClass(name));
          item.attr({ role: 'button', tabindex: '0' });
          item.find('i').attr('aria-hidden', 'true');
          if (key) item.attr('aria-label', names[key][english ? 1 : 0]);
        });
        dock.find('.toggle-tools-list').attr({ 'aria-expanded': 'false', 'aria-haspopup': 'true' });
      }
    }
    // Web Analytics is enabled on Vercel. Load it only on the public blog domain
    // so local previews and alternate deployment URLs do not count as visitors.
    $('script[data-aden-analytics]').remove();
    $('head').append(`<script data-aden-analytics>
      if (location.hostname === 'blog.adenxie.com.cn' && !window.__adenAnalyticsLoaded) {
        window.__adenAnalyticsLoaded = true;
        window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
        const script = document.createElement('script');
        script.defer = true;
        script.src = '/_vercel/insights/script.js';
        document.head.append(script);
      }
    </script>`);
    // Weather and exchange widgets live on the home page only; /daily/ reuses its card list.
    if (!$('.home-content-container').not('.aden-daily .home-content-container').length) $('script[src*="cyber-weather.js"],script[src*="cyber-exchange.js"]').remove();
    // Brief category links go straight to the /daily/ section (the category pages redirect there).
    $('a[href$="/categories/daily/"]').each((_, el) => { $(el).attr('href', $(el).attr('href').replace(/categories\/daily\/$/, 'daily/')); });
    if (!$('.essay-date').length) $('script[src*="moment-with-locales.min.js"]').remove();
    if (!$('#subtitle').length) $('script[src*="Typed.min.js"]').remove();
    // Apply after translation so cached English pages receive the same pager semantics.
    $('.paginator:has(a)').attr({ role: 'navigation', 'aria-label': $('html').attr('lang')?.startsWith('en') ? 'Pagination' : '分页' });
    $('.paginator .page-number.current').attr('aria-current', 'page');
    // A notice in the fixed navbar overlaps the first controls on narrow translated pages.
    $('.main-content').first().prepend($('.main-content-header > .aden-translation-notice'));
    // Normalize both new output and cached English snapshots.
    {
      const english = $('html').attr('lang')?.startsWith('en');
      const search = $('.search-pop-overlay');
      if (search.length) {
        const title = english ? 'Search the blog' : '站内搜索';
        search.attr('inert', '');
        search.find('.search-popup').attr({ id: 'aden-search-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'aden-search-title' });
        search.find('.search-header').before('<div class="aden-search-heading"><h2 id="aden-search-title"></h2></div>');
        search.find('#aden-search-title').text(title);
        search.find('.popup-btn-close').replaceWith($('<button type="button" class="popup-btn-close"><i class="fa-solid fa-times" aria-hidden="true"></i></button>').attr('aria-label', english ? 'Close search' : '关闭搜索'));
        search.find('.aden-search-heading').append(search.find('.popup-btn-close'));
        search.find('.search-input-field-pre').replaceWith('<i class="fa-solid fa-magnifying-glass aden-search-icon" aria-hidden="true"></i>');
        search.find('.search-input').attr({ 'aria-label': title, placeholder: english ? 'Search titles and text' : '搜索文章标题和正文' });
        search.find('.search-header').append($('<button type="button" class="search-input-field-pre" hidden><i class="fa-solid fa-times" aria-hidden="true"></i></button>').attr('aria-label', english ? 'Clear search' : '清空搜索'));
        search.find('#no-result').attr('role', 'status').text(english ? 'Search article titles and text.' : '输入关键词，搜索文章标题和正文。');
        $('.search-popup-trigger').attr({ 'aria-haspopup': 'dialog', 'aria-controls': 'aden-search-dialog', 'aria-expanded': 'false' });
      }
      $('.drawer-navbar-list > li > a').each((_, el) => {
        const link = $(el);
        link.removeClass('py-1.5 px-2 text-2xl font-semibold border-b border-border-color hover:border-primary hover:!text-primary active:!text-primary').addClass('aden-drawer-link');
      });
      const pathname = '/' + path.relative(out, file).split(path.sep).join('/').replace(/index\.html$/, '');
      $('.navbar-list > .navbar-item > a, .aden-drawer-link').each((_, el) => {
        const link = $(el);
        if (link.attr('href') === pathname) link.attr('aria-current', 'page');
      });
    }
    // 404 panel (lib/styles/cyber.css) shows just the code and a standard-size primary button. Older
    // English snapshots may still carry the cut-corner frame layer; it is no longer drawn.
    $('.nf-text h1').text('404');
    // Copyright labels come from the theme as "创建于 :" or "标题:"; give each one a single colon in the
    // page language so the label column reads evenly.
    $('.article-copyright-info-container li > strong').each((_, el) => {
      const label = $(el);
      label.text(label.text().replace(/\s*[:：]\s*$/, $('html').attr('lang')?.startsWith('en') ? ':' : '：'));
    });
    $('.nf-button a.button').removeClass('large center');
    $('.aden-nf-frame').remove();
    // Point visitors who hit errors to the status page (footer on every page, plus the 404 panel).
    // Added after translation, so cached English pages are replaced rather than duplicated.
    {
      const english = $('html').attr('lang')?.startsWith('en');
      const link = '<a href="https://status.adenxie.com.cn/" target="_blank" rel="noopener">status.adenxie.com.cn</a>';
      $('.aden-status-hint').remove();
      $('footer .customize-info').not('.aden-status-hint').after(`<div class="customize-info my-1 aden-status-hint">${english ? `Something not working? Check service status at ${link}` : `页面打不开或功能出错？可在 ${link} 查看服务状态`}</div>`);
      $('.nf-container').after(`<p class="aden-status-hint aden-nf-status">${english ? `If other pages fail too, check ${link}` : `其他页面也打不开？可在 ${link} 查看服务状态`}</p>`);
    }
    // Wide article tables scroll inside their own frame instead of overflowing the article panel.
    // The frame is a focusable region, so keyboard users can scroll a wide table too.
    {
      const english = $('html').attr('lang')?.startsWith('en');
      $('.markdown-body > table:not(.not-markdown)').wrap(`<div class="aden-table-scroll" role="region" tabindex="0" aria-label="${english ? 'Scrollable table' : '可横向滚动的表格'}"></div>`);
    }
    // Archive, category and tag lines: a brief's "每日简报｜日期：" prefix repeats the date column, so it
    // moves out of the visible line. A small tag marks the brief; the prefix stays in a screen-reader span
    // and the title attribute keeps the full title. Runs after translation, so no title segment changes.
    if (/^(?:en\/)?(?:archives|categories|tags)\//.test(path.relative(out, file).split(path.sep).join('/'))) {
      const english = $('html').attr('lang')?.startsWith('en');
      $('a.aden-archive-link, .aden-category-recent a').each((_, link) => {
        const line = $(link);
        if (line.find('.aden-entry-brief').length) return;
        const split = splitBriefPrefix(line.text(), english);
        if (!split) return;
        line.empty()
          .append($('<span class="aden-entry-brief"></span>').text(english ? 'Brief' : '简报'))
          .append($('<span class="aden-sr-only"></span>').text(split.prefix))
          .append($('<span class="aden-entry-title"></span>').text(split.rest));
      });
    }
    // Home card list: headings inside an excerpt step below the card title (h3), so the title leads.
    // Only the excerpt copy changes; post pages keep their headings. Daily cards keep their markup.
    const homeList = $('.home-article-list').not('.aden-daily .home-article-list').addClass('aden-home-list');
    homeList.find('.home-article-content h1, .home-article-content h2, .home-article-content h3, .home-article-content h4, .home-article-content h5, .home-article-content h6').each((_, el) => {
      const level = Math.min(6, Math.max(4, Number(el.name.slice(1)) + 2));
      el.name = `h${level}`;
    });
    $('script[src*="vercount"]').attr('async', '');
    const routeLink = $('.home-banner-container .aden-read-route');
    if (routeLink.length) {
      if (!$('.home-banner-actions').length) {
        routeLink.parent().addClass('home-banner-footer');
        routeLink.wrap('<div class="home-banner-actions flex items-center gap-3"></div>');
      }
      // Replace cached buttons too: these links are added after translation.
      const actions = routeLink.closest('.home-banner-actions');
      actions.find('.home-project-link').remove();
      const template = $('html').attr('lang')?.startsWith('en') ? 'home-project-links-en.ejs' : 'home-project-links.ejs';
      actions.append(fs.readFileSync(path.join(ROOT, 'lib/theme', template), 'utf8'));
    }
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
