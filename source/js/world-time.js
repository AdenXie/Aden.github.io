(() => {
  'use strict';

  const formatters = new Map();
  function formatter(zone, kind) {
    const key = `${zone}/${kind}`;
    if (!formatters.has(key)) {
      const options = kind === 'parts'
        ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }
        : kind === 'time'
          ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }
          : { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
      formatters.set(key, new Intl.DateTimeFormat(kind === 'date' ? 'zh-CN' : 'en-GB', { ...options, timeZone: zone }));
    }
    return formatters.get(key);
  }

  function snapshot(now, zone) {
    const p = Object.fromEntries(formatter(zone, 'parts').formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    const midnight = Date.UTC(p.year, p.month - 1, p.day);
    const wallTime = midnight + ((p.hour * 60 + p.minute) * 60 + p.second) * 1000;
    const offset = Math.round((wallTime - Math.floor(now.getTime() / 1000) * 1000) / 60000);
    return { time: formatter(zone, 'time').format(now), date: formatter(zone, 'date').format(now), day: midnight / 86400000, offset };
  }

  function offsetLabel(minutes) {
    if (!minutes) return 'UTC+00:00';
    const value = Math.abs(minutes);
    return `UTC${minutes < 0 ? '−' : '+'}${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }

  function compare(local, remote) {
    const delta = remote.offset - local.offset;
    const minutes = Math.abs(delta);
    const duration = [Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} 小时` : '', minutes % 60 ? `${minutes % 60} 分钟` : ''].filter(Boolean).join(' ');
    const days = remote.day - local.day;
    return {
      difference: delta === 0 ? '与你的本地时间相同' : `比你${delta > 0 ? '快' : '慢'} ${duration}`,
      dayDifference: days === 0 ? '与你处于同一天' : `当地日期比你${days > 0 ? '晚' : '早'} ${Math.abs(days)} 天`
    };
  }

  // Day and night: a low-precision solar position (well under 0.1° for this map),
  // recomputed once a minute. Same projection as the land path: 85°N..60°S on 0..460.
  const RAD = Math.PI / 180;
  const project = (lon, lat) => [(lon + 180) * 1000 / 360, (85 - lat) * 460 / 145];
  function subsolar(date) {
    const d = date.getTime() / 86400000 - 10957.5;
    const g = (357.529 + 0.98560028 * d) * RAD;
    const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
    const e = (23.439 - 0.00000036 * d) * RAD;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
    const gmst = 280.46061837 + 360.98564736629 * d;
    return { lat: Math.asin(Math.sin(e) * Math.sin(L)) / RAD, lon: ((ra - gmst) % 360 + 540) % 360 - 180 };
  }
  // Sun altitude in degrees at a place.
  function altitude(sun, lat, lon) {
    const h = Math.sin(lat * RAD) * Math.sin(sun.lat * RAD) + Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos((lon - sun.lon) * RAD);
    return Math.asin(Math.max(-1, Math.min(1, h))) / RAD;
  }
  // Region where the sun is below `degrees`. It always reaches the pole facing away
  // from the sun, so each meridian has one crossing, found by bisection.
  function shade(sun, degrees) {
    const at = { lat: Math.abs(sun.lat) < 0.01 ? 0.01 : sun.lat, lon: sun.lon };
    const pole = at.lat > 0 ? -90 : 90;
    const edge = [];
    for (let lon = -180; lon <= 180; lon += 2) {
      let dark = pole, light = -pole;
      if (altitude(at, pole, lon) < degrees) {
        for (let i = 0; i < 16; i++) {
          const mid = (dark + light) / 2;
          if (altitude(at, mid, lon) < degrees) dark = mid; else light = mid;
        }
      } else light = pole;
      edge.push(project(lon, light).map(v => Math.round(v * 10) / 10).join(','));
    }
    const line = 'M' + edge.join('L');
    const beyond = pole < 0 ? 600 : -140;
    return { line, fill: `${line}L1000,${beyond}L0,${beyond}Z` };
  }
  // Sun altitudes of the stacked night layers: each step darkens a little more.
  const TWILIGHT = [0, -3, -6, -9, -12, -15, -18];
  function phase(height) {
    return height > -0.83 ? 'day' : height > -12 ? 'twilight' : 'night';
  }

  // Pure helpers are exported only for Node regression tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { snapshot, offsetLabel, compare, subsolar, altitude, shade, phase };
    return;
  }
  // Swup may execute the page script again. Reuse a single lifecycle controller.
  if (window.AdenWorldTime) return;

  let active = null;
  function destroy() {
    if (!active) return;
    clearInterval(active.timer);
    active.listeners.abort();
    active = null;
  }

  // The flat SVG and clocks remain independent. The GPU scene and its textures
  // load only on an explicit globe request, and are released on return to flat.
  let globeImport;
  function createGlobe(root, markers, onPick, signal, onFailure) {
    let canvas = root.querySelector('.wt-globe');
    if (!canvas) return null;
    const english = document.documentElement.lang.startsWith('en');
    const pick = (zh, en) => english ? en : zh;
    let stage = canvas.closest('.wt-globe-stage');
    if (!stage) {
      stage = document.createElement('div'); stage.className = 'wt-globe-stage';
      canvas.before(stage); stage.append(canvas);
      const labels = document.createElement('div'); labels.className = 'wt-globe-labels';
      labels.setAttribute('aria-hidden', 'true'); stage.append(labels);
    }
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', pick('交互地球。拖动或用方向键旋转，加减号缩放，空格暂停。也可使用下方城市按钮。', 'Interactive globe. Drag or use arrow keys to rotate, plus/minus to zoom, space to pause. City buttons are also available below.'));
    let status = root.querySelector('.wt-globe-status');
    if (!status) {
      status = document.createElement('p'); status.className = 'wt-globe-status';
      status.setAttribute('role', 'status'); stage.before(status);
    }
    let toolbar = root.querySelector('.wt-globe-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div'); toolbar.className = 'wt-globe-toolbar';
      const zoom = root.querySelector('.wt-zoom'); zoom.before(toolbar); toolbar.append(zoom);
      const pause = document.createElement('button'); pause.type = 'button'; pause.dataset.globePause = '';
      pause.textContent = pick('暂停旋转', 'Pause rotation'); pause.disabled = true; toolbar.append(pause);
      const hint = document.createElement('p'); hint.className = 'wt-globe-hint';
      hint.textContent = pick('拖动旋转 · 方向键调整 · + / − 缩放 · 空格暂停', 'Drag or arrow keys to rotate · + / − to zoom · Space to pause');
      toolbar.after(hint);
    }
    if (!root.querySelector('.wt-globe-credit')) {
      const credit = document.createElement('span'); credit.className = 'wt-globe-credit';
      credit.innerHTML = pick(' 地球影像：', ' Globe imagery: ') + '<a href="https://svs.gsfc.nasa.gov/2915/" target="_blank" rel="noopener noreferrer">NASA Blue Marble</a> / <a href="https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/" target="_blank" rel="noopener noreferrer">Black Marble 2016</a>.' + pick(' 云层与灯光为历史合成影像；昼夜按当前时间计算。', ' Clouds and night lights are historical composites; daylight follows the current time.');
      root.querySelector('.wt-credit').append(credit);
    }
    const message = text => { status.textContent = text; status.hidden = !text; };
    let instance = null, request = null, generation = 0, timeout = null, visible = false, sunState = null, selectedId = null;
    function stop() {
      generation++; clearTimeout(timeout); timeout = null;
      request?.abort(); request = null; instance?.dispose(); instance = null;
      stage.removeAttribute('aria-busy');
      root.querySelector('[data-globe-pause]').disabled = true;
    }
    function fail() {
      onFailure();
      message(pick('三维地球暂不可用，已切回平面地图。可再次点击“地球”重试。', 'The 3D globe is unavailable. The flat map is still usable; choose Globe to retry.'));
    }
    async function show(next) {
      if (visible === next && (instance || request)) return;
      visible = next;
      if (!next) { stop(); message(''); return; }
      stop();
      const current = generation, loading = new AbortController(); request = loading;
      message(pick('正在加载地球…', 'Loading globe…')); stage.setAttribute('aria-busy', 'true');
      timeout = setTimeout(() => { if (current === generation) fail(); }, 15000);
      try {
        globeImport ||= import('/js/scenes/world-globe.js').catch(error => { globeImport = null; throw error; });
        const module = await globeImport;
        if (loading.signal.aborted || signal.aborted || current !== generation) return;
        const scene = await module.mount(root, markers, onPick, loading.signal);
        if (loading.signal.aborted || signal.aborted || current !== generation) { scene.dispose(); return; }
        instance = scene;
        if (sunState) instance.sun(sunState);
        if (selectedId) instance.focus(selectedId, true);
        clearTimeout(timeout); timeout = null;
        stage.removeAttribute('aria-busy'); message('');
      } catch (_) {
        if (!loading.signal.aborted && !signal.aborted && current === generation) fail();
      }
    }
    root.addEventListener('aden:globe-error', fail, { signal });
    signal.addEventListener('abort', stop, { once: true });
    message('');
    return {
      show,
      palette() { instance?.palette(); },
      sun(next) { sunState = next; instance?.sun(next); },
      focus(id, instant) { selectedId = id; instance?.focus(id, instant); }
    };
  }

  function mount(_root, scope) {
    const root = document.getElementById('world-time');
    if (active?.root === root && root?.isConnected) return;
    destroy();
    if (!root) return;

    const cities = Array.from(root.querySelectorAll('button[data-zone]')).map(button => ({ id: button.dataset.city, name: button.dataset.name, zone: button.dataset.zone }));
    let localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    let selected = cities.find(city => city.zone === localZone) || cities.find(city => city.id === 'sydney') || cities[0];
    const nodes = Object.fromEntries(Array.from(root.querySelectorAll('[data-wt]')).map(node => [node.dataset.wt, node]));
    const listeners = new AbortController();
    active = { root, listeners, timer: null };

    function set(name, text) {
      if (nodes[name].textContent !== text) nodes[name].textContent = text;
    }
    function renderClock(kind, state, zone, now) {
      set(`${kind}-time`, state.time);
      nodes[`${kind}-time`].dateTime = now.toISOString();
      set(`${kind}-date`, state.date);
      set(`${kind}-zone`, `${zone} · ${offsetLabel(state.offset)}`);
    }
    const markers = Array.from(root.querySelectorAll('.wt-marker')).map(node => ({ node, id: node.dataset.city, lon: Number(node.dataset.lon), lat: Number(node.dataset.lat) }));
    const nights = root.querySelectorAll('.wt-night');
    const terminator = root.querySelector('.wt-terminator');
    const sunMark = root.querySelector('#wt-sun');
    const phaseText = { day: '☀ 白天', twilight: '◐ 晨昏', night: '☾ 夜晚' };
    let sun = null, minute = -1;
    const globe = createGlobe(root, markers, id => select(id), listeners.signal, () => setView('flat'));
    function setView(name) {
      const flat = name === 'flat' || !globe;
      root.classList.toggle('wt-globe-on', !flat);
      globe?.show(!flat);
      for (const button of root.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String((button.dataset.view === 'flat') === flat));
    }
    root.addEventListener('click', event => {
      const button = event.target.closest?.('[data-view]');
      if (button) setView(button.dataset.view);
    }, { signal: listeners.signal });
    setView('flat');
    function renderDaylight(now) {
      const current = Math.floor(now.getTime() / 60000);
      if (current !== minute) {
        minute = current;
        sun = subsolar(now);
        globe?.sun(sun);
        TWILIGHT.forEach((degrees, i) => {
          const region = shade(sun, degrees);
          nights[i].setAttribute('d', region.fill);
          if (i === 0) terminator.setAttribute('d', region.line);
        });
        const [x, y] = project(sun.lon, sun.lat);
        sunMark.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
        sunMark.setAttribute('visibility', 'visible');
        for (const marker of markers) marker.node.dataset.phase = phase(altitude(sun, marker.lat, marker.lon));
        const deg = (value, plus, minus) => `${Math.abs(value).toFixed(1)}°${value < 0 ? minus : plus}`;
        set('sun', `SUBSOLAR ${deg(sun.lat, 'N', 'S')} ${deg(sun.lon, 'E', 'W')}`);
      }
      const marker = markers.find(item => item.id === selected.id);
      set('remote-phase', marker ? phaseText[marker.node.dataset.phase] : '');
    }
    function render() {
      if (!root.isConnected || document.hidden) return;
      const now = new Date();
      renderDaylight(now);
      globe?.palette();
      localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      try {
        const local = snapshot(now, localZone);
        renderClock('local', local, localZone, now);
        const remote = snapshot(now, selected.zone);
        renderClock('remote', remote, selected.zone, now);
        const comparison = compare(local, remote);
        set('difference', `${selected.name} · ${comparison.difference}`);
        set('day-difference', comparison.dayDifference);
      } catch (_) {
        set('remote-time', '--:--:--');
        set('remote-date', '浏览器暂不支持这个时区');
        set('remote-zone', selected.zone);
        set('difference', '请更新浏览器后重试');
        set('day-difference', '');
      }
    }
    function select(id) {
      const city = cities.find(item => item.id === id);
      if (!city) return;
      selected = city;
      set('remote-name', city.name);
      globe?.focus(city.id, !sun);
      for (const marker of root.querySelectorAll('[data-city]')) {
        marker.setAttribute('aria-pressed', String(marker.dataset.city === city.id));
      }
      render();
    }
    function selectTarget(event) {
      const target = event.target.closest?.('[data-city]');
      if (target && root.contains(target)) select(target.dataset.city);
    }
    root.addEventListener('click', selectTarget, { signal: listeners.signal });
    root.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.wt-marker')) {
        event.preventDefault();
        selectTarget(event);
      }
    }, { signal: listeners.signal });
    select(selected.id);
    scope.clock(render);
    return destroy;
  }

  window.AdenWorldTime = { destroy };
  window.AdenSite.register('world-time', '#world-time', mount);
})();
