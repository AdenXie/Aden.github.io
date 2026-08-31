const cities = require('../lib/world-time-cities.json');
const map = require('../lib/world-time-map.json');

// Search is preloaded site-wide. Keep this page searchable without shipping SVG
// geometry or executable markup in the global search index.
hexo.extend.filter.register('after_init', function () {
  const searchPath = this.config.search?.path;
  if (!searchPath?.endsWith('.xml')) return;
  const generate = this.extend.generator.get('xml');
  if (!generate) return;
  const summary = `世界时间：查看${cities.map(city => city.name).join('、')}的当地日期、时间，以及与你的本地时区的时差。`;
  this.extend.generator.register('xml', async function (locals) {
    const result = await generate.call(this, locals);
    result.data = result.data.replace(/<entry>[\s\S]*?<\/entry>/g, entry => {
      if (/<url>[^<]*\/(?:css\/world-time\.css|js\/world-time\.js)<\/url>/.test(entry)) return '';
      if (!/<url>[^<]*\/world-time\/(?:index\.html)?<\/url>/.test(entry)) return entry;
      return entry.replace(/<content><!\[CDATA\[[\s\S]*?\]\]><\/content>/, `<content><![CDATA[${summary}]]></content>`);
    });
    return result;
  });
});

hexo.extend.tag.register('world_time', () => {
  const points = cities.map(city => {
    const x = ((city.lon + 180) * 1000 / 360).toFixed(1);
    const y = ((85 - city.lat) * 460 / 145).toFixed(1);
    const [lx, ly, anchor] = city.label;
    return `<g class="wt-marker" data-city="${city.id}" role="button" tabindex="0" aria-label="查看${city.name}时间" aria-pressed="false">
      <title>${city.name}</title>
      <path class="wt-leader" d="M${x},${y}L${lx},${ly - 4}"/>
      <circle class="wt-hit" cx="${x}" cy="${y}" r="9"/>
      <circle class="wt-dot" cx="${x}" cy="${y}" r="3"/>
      <text x="${lx}" y="${ly}" text-anchor="${anchor}">${city.name}</text>
    </g>`;
  }).join('');
  const groups = [...new Set(cities.map(city => city.group))].map(group => `<div class="wt-city-group"><span class="wt-group-label">${group}</span><div class="wt-city-buttons">${cities.filter(city => city.group === group).map(city => `<button type="button" data-city="${city.id}" data-zone="${city.zone}" data-name="${city.name}" aria-pressed="false">${city.name}</button>`).join('')}</div></div>`).join('');
  const clock = (kind, label) => `<section class="wt-clock-panel wt-${kind}" aria-label="${label}">
    <span class="wt-eyebrow">${kind === 'local' ? 'YOUR LOCAL TIME' : 'SELECTED CITY'}</span>
    <h2 data-wt="${kind}-name">${label}</h2>
    <time class="wt-time" data-wt="${kind}-time">--:--:--</time>
    <span class="wt-date" data-wt="${kind}-date">正在读取设备时间…</span>
    <span class="wt-zone" data-wt="${kind}-zone">—</span>
  </section>`;
  return `<link rel="stylesheet" href="/css/world-time.css">
  <section id="world-time" class="wt" aria-label="世界时间交互地图">
    <p class="wt-intro">同一刻，世界各地的日常。悬停或点选城市，对照你的本地时间。</p>
    <div class="wt-map-frame">
      <div class="wt-map-caption"><span>WORLD TIME / ${cities.length} CITIES</span><span>悬停 · 点选</span></div>
      <svg class="wt-map" viewBox="${map.viewBox}" aria-label="${cities.length}个城市的世界时间地图">
        <path class="wt-land" d="${map.path}"/>
        <path class="wt-equator" d="M0,269.7H1000"/>
        ${points}
      </svg>
    </div>
    <div class="wt-comparison" id="wt-comparison">${clock('local', '你的本地时间')}${clock('remote', '选择一个城市')}</div>
    <div class="wt-difference" aria-live="polite" aria-atomic="true"><span data-wt="difference">选择城市后，这里会显示与你的时差。</span><span data-wt="day-difference"></span></div>
    <div class="wt-cities" aria-label="选择城市">${groups}</div>
    <p class="wt-note">本地时区读取自你的设备，不使用 IP 定位。时间与夏令时规则由浏览器计算，请保持设备时间准确。</p>
    <p class="wt-credit">地图仅展示简化陆地轮廓，不表示行政边界。<a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noopener noreferrer">Natural Earth · 公共领域数据</a></p>
    <noscript>请启用 JavaScript 以查看实时日期、时间和时差。</noscript>
  </section>
  <script src="/js/world-time.js" defer data-swup-reload-script></script>`;
});
