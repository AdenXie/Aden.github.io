(() => {
  "use strict";

  // Interface copy is written in both languages here; the English page reads the English branch.
  const english = () => document.documentElement.lang.startsWith("en");
  const pick = (zh, en) => (english() ? en : zh);

  const QUOTE_URL = "/api/aud-cny?v=4";
  const CACHE_KEY = "aden-aud-cny-v2";
  const CACHE_TTL = 3 * 60 * 60 * 1000;
  const FALLBACK_TTL = 30 * 24 * 60 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 15000;
  const RETRY_DELAY_MS = 1500;
  const ERROR_MESSAGES = {
    connection_timeout: ["连接汇率服务超时", "Exchange service connection timed out"],
    connection_failed: ["无法连接汇率服务，请检查网络", "Cannot reach the exchange service. Check your network"],
    source_timeout: ["中行牌价源响应超时", "BOC rate source timed out"],
    source_unavailable: ["中行牌价源读取失败", "Could not read the BOC rate source"],
    snapshot_unavailable: ["汇率快照暂时无法读取", "The rate snapshot is unavailable for now"],
    snapshot_stale: ["汇率快照暂未更新", "The rate snapshot has not been updated yet"],
    invalid_response: ["汇率服务返回的数据异常", "Exchange service returned invalid data"],
    not_found: ["汇率接口不存在（404）", "Exchange endpoint not found (404)"],
    access_denied: ["汇率请求被拒绝", "Exchange request was refused"],
    rate_limited: ["汇率请求过于频繁，请稍后再试", "Too many exchange requests. Try again later"],
    service_unavailable: ["汇率接口暂不可用", "Exchange service is unavailable"]
  };

  function createCard() {
    const card = document.createElement("section");
    card.className = "cyber-exchange-card is-loading";
    card.id = "aud-cny-exchange-card";
    card.setAttribute("aria-label", pick("中国银行澳大利亚元兑人民币现汇牌价", "Bank of China AUD to CNY spot rates"));
    card.innerHTML = `
      <div class="cyber-exchange-header">
        <span class="cyber-exchange-pair"><i aria-hidden="true"></i> AUD / CNY</span>
        <span>${pick("中国银行现汇", "Bank of China spot rates")}</span>
      </div>
      <div class="cyber-exchange-body" aria-live="polite">
        <div class="cyber-exchange-intro">
          <strong>${pick("澳元现汇牌价", "AUD spot rates")}</strong>
          <span>${pick("人民币 / 100澳元", "CNY per 100 AUD")}</span>
        </div>
        <dl class="cyber-exchange-quotes">
          <div class="is-buy">
            <dt>${pick("现汇买入价", "Spot buy")} <span>BUY</span></dt>
            <dd data-exchange="buy">---.--</dd>
          </div>
          <div class="is-sell">
            <dt>${pick("现汇卖出价", "Spot sell")} <span>SELL</span></dt>
            <dd data-exchange="sell">---.--</dd>
          </div>
        </dl>
      </div>
      ${trendMarkup()}
      <div class="cyber-exchange-footer">
        <span data-exchange="status">${pick("正在连接中国银行牌价…", "Connecting to Bank of China rates…")}</span>
        <a href="https://www.bankofchina.com/sourcedb/whpj/" target="_blank" rel="noopener noreferrer">${pick("数据来源于中国银行 ↗", "Source: Bank of China ↗")}</a>
        <button type="button" class="aden-widget-toggle" aria-controls="aud-cny-exchange-card" aria-expanded="false"></button>
      </div>
      <p class="cyber-exchange-notice">${pick("现汇买入价与现汇卖出价均为中国银行每100澳元折合人民币的官方牌价。仅供个人非商业展示；实际交易以中国银行网上银行、手机银行、智能柜台或网点柜台价格为准。未经中国银行许可，不得用于商业转载。", "Both the spot buy and spot sell prices are Bank of China's official rates for 100 Australian dollars in Chinese yuan. For personal, non-commercial display only. Actual transactions follow the prices in Bank of China's online banking, mobile banking, smart counters or branch counters. Commercial reproduction is not permitted without Bank of China's permission.")}</p>`;
    return card;
  }

  // Phones show the rates and freshness; the notice opens on demand. Desktop always shows it.
  function setDetails(card, expanded) {
    const toggle = card.querySelector(".aden-widget-toggle");
    card.classList.toggle("is-expanded", expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = pick(expanded ? "收起详情" : "展开详情", expanded ? "Hide details" : "Show details");
  }

  function formatRate(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `¥${number.toFixed(2)}` : "---.--";
  }

  // Weekends usually bring no new quote, so an older Beijing-time quote is the expected snapshot.
  function isBeijingWeekend() {
    const day = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(new Date());
    return day === "Sat" || day === "Sun";
  }

  function formatPublishedAt(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}):\d{2}$/);
    if (!match) return String(value || pick("时间未知", "Time unknown"));
    return `${match[1]}-${match[2]}-${match[3]} ${match[4]}`;
  }

  function isValidQuote(payload) {
    return (
      payload?.currency === "AUD" &&
      payload?.officialUnit === "CNY per 100 AUD" &&
      Number.isFinite(Number(payload.spotBuy)) &&
      Number.isFinite(Number(payload.spotSell)) &&
      Number(payload.spotBuy) >= 100 &&
      Number(payload.spotSell) >= 100 &&
      Boolean(payload.publishedAt)
    );
  }

  // Same rule as tools/lib/boc-history.cjs: a quote before 06:00 Beijing time closes the previous
  // trading day, and a Sunday key belongs to Monday.
  function tradingDay(publishedAt) {
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(publishedAt || ""));
    if (!match) return null;
    const [, y, mo, d, h, mi, s] = match.map(Number);
    const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s) - 6 * 3600 * 1000);
    if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  function renderQuote(card, payload, state = "live", error = null) {
    if (!card?.isConnected || !isValidQuote(payload)) return;
    card.querySelector('[data-exchange="buy"]').textContent = formatRate(payload.spotBuy);
    if (card.dataset) card.dataset.quoteDay = tradingDay(payload.publishedAt) || "";
    card.querySelector('[data-exchange="sell"]').textContent = formatRate(payload.spotSell);

    const updated = `${formatPublishedAt(payload.publishedAt)} ${pick("北京时间", "Beijing time")}`;
    const status = card.querySelector('[data-exchange="status"]');
    const code = error?.code || payload.fetchError || "source_unavailable";
    if (state === "syncing") status.textContent = pick(`正在同步最新快照 · 暂显示缓存牌价 · 中行更新 ${updated}`, `Syncing the latest quote · showing the cached rate · BOC updated ${updated}`);
    else if (state === "stale" || payload.stale) {
      // An older quote is not a failure: say what is shown and when BOC last published it.
      if (code === "snapshot_stale" && isBeijingWeekend()) status.textContent = pick(`周末暂无新牌价 · 显示最近一次牌价 · 中行更新 ${updated}`, `No new rate on weekends · showing the latest rate · BOC updated ${updated}`);
      else if (code === "snapshot_stale") status.textContent = pick(`暂未收到新牌价 · 显示最近一次牌价 · 中行更新 ${updated}`, `No new rate yet · showing the latest rate · BOC updated ${updated}`);
      else status.textContent = `${errorMessage({ code })} · ${pick("显示缓存牌价", "showing the cached rate")} · ${pick("中行更新", "BOC updated")} ${updated}`;
    }
    else if (state === "cache") status.textContent = pick(`缓存牌价 · 中行更新 ${updated}`, `Cached rate · BOC updated ${updated}`);
    else status.textContent = pick(`中行更新 ${updated} · 三小时缓存`, `BOC updated ${updated} · cached for 3 hours`);

    card.classList.remove("is-loading", "is-offline", "is-stale", "is-online");
    card.classList.add(state === "syncing" ? "is-loading" : state === "stale" || payload.stale ? "is-stale" : "is-online");
  }

  function readCachedQuote(allowExpired = false) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (!cached || !isValidQuote(cached.payload)) return null;
      if (!allowExpired && cached.payload.stale) return null;
      if (!allowExpired && cached.payload.fetchedAt && Date.now() - Date.parse(cached.payload.fetchedAt) >= CACHE_TTL) return null;
      const age = Date.now() - Number(cached.savedAt || 0);
      const limit = allowExpired ? FALLBACK_TTL : CACHE_TTL;
      return age >= 0 && age < limit ? cached.payload : null;
    } catch (_) {
      try { localStorage.removeItem(CACHE_KEY); } catch (_) { /* Storage is optional. */ }
      return null;
    }
  }

  function cacheQuote(payload) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), payload }));
    } catch (_) {
      // The live card still works when local storage is unavailable.
    }
  }

  function quoteError(code) {
    return Object.assign(new Error(code), { code });
  }

  function errorMessage(error) {
    const [zh, en] = ERROR_MESSAGES[error?.code] || ERROR_MESSAGES.service_unavailable;
    return pick(zh, en);
  }

  function canRetry(error) {
    return ["connection_timeout", "connection_failed", "source_timeout", "source_unavailable", "snapshot_unavailable", "service_unavailable"].includes(error?.code);
  }

  async function fetchQuote(signal) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) { const error = new Error('Cancelled'); error.name = 'AbortError'; throw error; }
    signal?.addEventListener('abort', cancel, { once: true });
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(QUOTE_URL, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        if (response.ok) throw quoteError("invalid_response");
      }
      if (!response.ok) {
        const statusCode = { 404: "not_found", 401: "access_denied", 403: "access_denied", 429: "rate_limited" }[response.status];
        const sourceCode = ["source_timeout", "source_unavailable", "snapshot_unavailable"].includes(payload?.error) ? payload.error : null;
        throw quoteError(statusCode || sourceCode || "service_unavailable");
      }
      if (!isValidQuote(payload)) throw quoteError("invalid_response");
      if (payload.fetchedAt && Date.now() - Date.parse(payload.fetchedAt) >= CACHE_TTL) payload.stale = true;
      return payload;
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") throw quoteError("connection_timeout");
      throw error?.code ? error : quoteError("connection_failed");
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    }
  }

  async function loadQuote(card, signal) {
    const fresh = readCachedQuote(false);
    if (fresh) {
      renderQuote(card, fresh, "cache");
      return;
    }
    const previous = readCachedQuote(true);
    if (previous) renderQuote(card, previous, "syncing");

    if (signal?.aborted) return;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const payload = await fetchQuote(signal);
        if (signal?.aborted || !card.isConnected) return;
        // Stale server fallbacks must not restart the browser's freshness clock.
        if (!payload.stale) cacheQuote(payload);
        renderQuote(card, payload, payload.stale ? "stale" : "live");
        return;
      } catch (error) {
        if (signal?.aborted || !card?.isConnected) return;
        if (attempt === 0 && canRetry(error)) {
          card.querySelector('[data-exchange="status"]').textContent = `${errorMessage(error)} · ${pick("正在重试（1/1）…", "retrying (1/1)…")}`;
          await (window.AdenSite?.delay(RETRY_DELAY_MS, signal) || new Promise(resolve => window.setTimeout(resolve, RETRY_DELAY_MS)));
          if (signal?.aborted || !card.isConnected) return;
          continue;
        }
        if (previous) {
          renderQuote(card, previous, "stale", error);
        } else {
          card.querySelector('[data-exchange="status"]').textContent = `${errorMessage(error)} · ${pick("暂无可用缓存，请稍后刷新", "no cached rate yet, refresh later")}`;
          card.classList.remove("is-loading", "is-online", "is-stale");
          card.classList.add("is-offline");
        }
        return;
      }
    }
  }

  // ---- Trend line: daily Bank of China closes from /api/aud-cny-history ----
  // One line for the selected price (sell by default; tap the buy or sell figure to switch),
  // over 7, 30 or 90 calendar days. Scrubbing the line shows that day in the big figure.
  const HISTORY_URL = "/api/aud-cny-history?v=1";
  const HISTORY_KEY = "aden-aud-cny-history-v1";
  const SERIES_KEY = "aden-aud-cny-series";
  const RANGES = [7, 30, 90];
  const DAY_MS = 24 * 60 * 60 * 1000;

  function trendMarkup() {
    const ranges = RANGES.map(days => `<button type="button" data-range="${days}" aria-pressed="false">${pick(`${days}天`, `${days}D`)}</button>`).join("");
    return `
      <div class="fx-trend" hidden>
        <div class="fx-trend-meta">
          <p class="fx-trend-readout" aria-live="polite">
            <span data-trend="label"></span>
            <strong data-trend="change"></strong>
            <span data-trend="span"></span>
          </p>
          <div class="fx-trend-ranges" role="group" aria-label="${pick("走势时间范围", "Trend range")}">${ranges}</div>
        </div>
        <div class="fx-trend-plot" tabindex="0" role="img">
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <defs><linearGradient id="fx-trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="currentColor" stop-opacity=".2"></stop>
              <stop offset="1" stop-color="currentColor" stop-opacity="0"></stop>
            </linearGradient></defs>
            <path class="fx-trend-area" fill="url(#fx-trend-fill)"></path>
            <line class="fx-trend-base" x1="0" x2="1000"></line>
            <path class="fx-trend-line"></path>
          </svg>
          <i class="fx-trend-cursor" aria-hidden="true"></i>
          <i class="fx-trend-dot" aria-hidden="true"></i>
          <div class="fx-trend-axis" aria-hidden="true"><span data-trend="start"></span><span data-trend="end"></span></div>
        </div>
      </div>`;
  }

  function validDays(days) {
    return Array.isArray(days) ? days.filter(day => Array.isArray(day) && /^\d{4}-\d{2}-\d{2}$/.test(day[0]) &&
      Number.isFinite(day[1]) && Number.isFinite(day[2]) && day[1] >= 100 && day[2] >= day[1]) : [];
  }

  function readHistory(allowExpired) {
    try {
      const cached = JSON.parse(localStorage.getItem(HISTORY_KEY));
      const age = Date.now() - Number(cached?.savedAt || 0);
      if (age < 0 || age >= (allowExpired ? FALLBACK_TTL : CACHE_TTL)) return null;
      const days = validDays(cached.days);
      return days.length ? days : null;
    } catch (_) {
      return null;
    }
  }

  async function fetchHistory(signal) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const timeout = window.setTimeout(cancel, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(HISTORY_URL, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!response.ok) return null;
      const payload = await response.json();
      if (payload?.officialUnit !== "CNY per 100 AUD") return null;
      const days = validDays(payload.days);
      if (!days.length) return null;
      if (!payload.stale) {
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify({ savedAt: Date.now(), days })); } catch (_) { /* optional */ }
      }
      return days;
    } catch (_) {
      return null;
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }

  const dateOf = day => new Date(`${day}T00:00:00Z`);
  function formatDay(day) {
    const date = dateOf(day);
    return english()
      ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date)
      : `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
  }
  const money = value => `¥${value.toFixed(2)}`;
  // Direction is carried by the sign and a drawn triangle, never by colour alone.
  function changeMarkup(from, to) {
    const delta = to - from;
    const pct = from ? (delta / from) * 100 : 0;
    const dir = delta > 0.004 ? "up" : delta < -0.004 ? "down" : "flat";
    const sign = dir === "up" ? "+" : dir === "down" ? "−" : "";
    const arrow = dir === "flat" ? "" : `<svg class="fx-trend-arrow" viewBox="0 0 10 10" aria-hidden="true"><path d="${dir === "up" ? "M5 1.5 9 8.5H1z" : "M5 8.5 9 1.5H1z"}"/></svg>`;
    return { dir, html: `${arrow}${sign}${Math.abs(delta).toFixed(2)}<small>${sign}${Math.abs(pct).toFixed(2)}%</small>` };
  }

  function mountTrend(card, signal) {
    const trend = card.querySelector(".fx-trend");
    const plot = trend.querySelector(".fx-trend-plot");
    const line = trend.querySelector(".fx-trend-line");
    const area = trend.querySelector(".fx-trend-area");
    const base = trend.querySelector(".fx-trend-base");
    const cursor = trend.querySelector(".fx-trend-cursor");
    const dot = trend.querySelector(".fx-trend-dot");
    const field = name => trend.querySelector(`[data-trend="${name}"]`);
    const cells = { buy: card.querySelector(".cyber-exchange-quotes .is-buy"), sell: card.querySelector(".cyber-exchange-quotes .is-sell") };
    const figures = { buy: card.querySelector('[data-exchange="buy"]'), sell: card.querySelector('[data-exchange="sell"]') };
    let series = "sell";
    try { if (localStorage.getItem(SERIES_KEY) === "buy") series = "buy"; } catch (_) { /* optional */ }
    let range = 30, all = [], shown = [], ys = [], active = -1, drawn = false;

    const value = day => day[series === "buy" ? 1 : 2];
    const seriesName = () => series === "buy" ? pick("买入价", "Spot buy") : pick("卖出价", "Spot sell");

    // The latest quote may be newer than the cached history: it closes today's point.
    function withQuote(days) {
      const live = node => Number.parseFloat(String(node.dataset.live || node.textContent).replace(/[^\d.]/g, ""));
      const buy = live(figures.buy), sell = live(figures.sell);
      const day = card.dataset.quoteDay;
      if (!day || !(buy >= 100) || !(sell >= buy) || !days.length || day < days[days.length - 1][0]) return days;
      return [...days.filter(entry => entry[0] !== day), [day, buy, sell]];
    }

    function select(nextRange) {
      const end = dateOf(all[all.length - 1][0]).getTime();
      // A range shows only when history reaches past the next shorter one, so no two buttons draw
      // the same line; the longest is labelled "all" while history is shorter than it. A chosen
      // range that is not shown falls back to the longest one shown.
      const span = (end - dateOf(all[0][0]).getTime()) / DAY_MS;
      const buttons = [...trend.querySelectorAll("[data-range]")];
      const shownRanges = RANGES.filter((days, i) => i === 0 || span > RANGES[i - 1]);
      if (!shownRanges.includes(nextRange)) nextRange = shownRanges[shownRanges.length - 1];
      buttons.forEach(button => {
        const days = Number(button.dataset.range);
        button.hidden = !shownRanges.includes(days);
        if (days === RANGES[RANGES.length - 1]) button.textContent = span < days - 5 ? pick("全部", "All") : pick(`${days}天`, `${days}D`);
        button.setAttribute("aria-pressed", String(days === nextRange));
      });
      // One range is no choice: the control goes away.
      trend.querySelector(".fx-trend-ranges").hidden = shownRanges.length < 2;
      shown = all.filter(day => end - dateOf(day[0]).getTime() <= nextRange * DAY_MS);
      range = nextRange;
    }

    function rangeLabel() {
      const longest = range === RANGES[RANGES.length - 1];
      const span = (dateOf(all[all.length - 1][0]) - dateOf(all[0][0])) / DAY_MS;
      if (longest && span < range - 5) return pick("全部", "all days");
      return pick(`近${range}天`, `${range} days`);
    }

    function draw() {
      const values = shown.map(value);
      const low = Math.min(...values), high = Math.max(...values);
      const pad = Math.max((high - low) * 0.14, 0.25);
      const y = v => 100 - ((v - (low - pad)) / (high - low + pad * 2)) * 100;
      const x = i => (shown.length === 1 ? 500 : (i / (shown.length - 1)) * 1000);
      const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(2)}`);
      line.setAttribute("d", `M${points.join("L")}`);
      area.setAttribute("d", `M${points.join("L")}L1000,100L0,100Z`);
      base.setAttribute("y1", y(values[0]).toFixed(2));
      base.setAttribute("y2", y(values[0]).toFixed(2));
      trend.dataset.series = series;
      ys = values.map(y);
      field("start").textContent = formatDay(shown[0][0]);
      field("end").textContent = formatDay(shown[shown.length - 1][0]);
      field("span").textContent = `${pick("最高", "High")} ${money(high)} · ${pick("最低", "Low")} ${money(low)}`;
      Object.entries(cells).forEach(([name, cell]) => {
        cell.classList.toggle("is-plotted", name === series);
        cell.setAttribute("aria-pressed", String(name === series));
      });
      plot.setAttribute("aria-label", pick(
        `${seriesName()}${rangeLabel()}走势：${formatDay(shown[0][0])} ${money(values[0])}，${formatDay(shown[shown.length - 1][0])} ${money(values[values.length - 1])}。用左右方向键逐日查看。`,
        `${seriesName()}, ${rangeLabel()}: ${money(values[0])} on ${formatDay(shown[0][0])}, ${money(values[values.length - 1])} on ${formatDay(shown[shown.length - 1][0])}. Use the arrow keys to read each day.`));
      readout();
    }

    function readout() {
      const values = shown.map(value);
      const scrubbing = active >= 0;
      const index = scrubbing ? active : values.length - 1;
      const change = changeMarkup(values[0], values[index]);
      field("label").textContent = scrubbing
        ? `${formatDay(shown[index][0])} · ${seriesName()}`
        : `${seriesName()} · ${rangeLabel()}`;
      field("change").innerHTML = change.html;
      field("change").dataset.dir = change.dir;
      trend.classList.toggle("is-scrubbing", scrubbing);
      // The big figure follows the cursor, then returns to the live quote.
      Object.entries(figures).forEach(([name, node]) => {
        if (scrubbing && name === series) {
          if (!node.dataset.live) node.dataset.live = node.textContent;
          node.textContent = money(values[index]);
        } else if (node.dataset.live) {
          node.textContent = node.dataset.live;
          delete node.dataset.live;
        }
        cells[name].classList.toggle("is-scrubbed", scrubbing && name === series);
      });
      if (scrubbing) {
        const left = shown.length === 1 ? 50 : (index / (shown.length - 1)) * 100;
        cursor.style.left = dot.style.left = `${left}%`;
        dot.style.top = `${ys[index]}%`;
      }
    }

    function setActive(index) {
      const next = index < 0 || !shown.length ? -1 : Math.max(0, Math.min(shown.length - 1, index));
      if (next === active) return;
      active = next;
      readout();
    }

    function render(days) {
      all = withQuote(days);
      if (all.length < 2) { trend.hidden = true; return; }
      trend.hidden = false;
      select(range);
      if (shown.length < 2) select(RANGES[RANGES.length - 1]);
      active = -1;
      draw();
      if (drawn) return;
      drawn = true;
      // One authored moment: the line draws in once, the first time it scrolls into view.
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
      trend.classList.add("is-drawing");
      const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        trend.classList.add("is-drawn");
      }, { threshold: 0.4 });
      observer.observe(plot);
      signal.addEventListener("abort", () => observer.disconnect(), { once: true });
    }

    const indexAt = clientX => {
      const box = plot.getBoundingClientRect();
      return Math.round(((clientX - box.left) / box.width) * (shown.length - 1));
    };
    plot.addEventListener("pointermove", event => setActive(indexAt(event.clientX)), { signal });
    plot.addEventListener("pointerdown", event => setActive(indexAt(event.clientX)), { signal });
    for (const type of ["pointerleave", "pointercancel"]) plot.addEventListener(type, () => setActive(-1), { signal });
    plot.addEventListener("pointerup", event => { if (event.pointerType !== "mouse") setActive(-1); }, { signal });
    plot.addEventListener("keydown", event => {
      const last = shown.length - 1;
      const from = active >= 0 ? active : last + 1;
      const moves = { ArrowLeft: from - 1, ArrowRight: Math.min(from + 1, last), Home: 0, End: last };
      if (event.key === "Escape" && active >= 0) { setActive(-1); return; }
      if (!(event.key in moves) || !shown.length) return;
      event.preventDefault();
      setActive(moves[event.key]);
    }, { signal });
    plot.addEventListener("blur", () => setActive(-1), { signal });

    trend.querySelector(".fx-trend-ranges").addEventListener("click", event => {
      const button = event.target.closest("[data-range]");
      if (!button || !all.length) return;
      setActive(-1);
      select(Number(button.dataset.range));
      draw();
    }, { signal });

    // The buy and sell figures double as the series switch.
    Object.entries(cells).forEach(([name, cell]) => {
      const choose = () => {
        if (!all.length || series === name) return;
        setActive(-1);
        series = name;
        try { localStorage.setItem(SERIES_KEY, name); } catch (_) { /* optional */ }
        draw();
      };
      cell.addEventListener("click", choose, { signal });
      cell.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        choose();
      }, { signal });
    });
    signal.addEventListener("abort", () => setActive(-1), { once: true });

    function enableSwitch() {
      Object.values(cells).forEach(cell => {
        cell.setAttribute("role", "button");
        cell.setAttribute("tabindex", "0");
        cell.setAttribute("aria-label", cell === cells.buy ? pick("在走势线中显示现汇买入价", "Show spot buy on the trend line") : pick("在走势线中显示现汇卖出价", "Show spot sell on the trend line"));
      });
    }

    return {
      async load() {
        const fresh = readHistory(false);
        const previous = fresh || readHistory(true);
        if (previous) { render(previous); enableSwitch(); }
        if (fresh) return;
        const days = await fetchHistory(signal);
        if (signal.aborted || !card.isConnected) return;
        if (days) { render(days); enableSwitch(); }
      },
      refresh() { if (all.length) render(all); }
    };
  }

  function mountExchangeCard(_root, scope) {
    const homeContent = document.querySelector(".home-content-container");
    // /daily/ reuses the home card list; after a Swup visit from home this script is
    // still loaded there, so skip that page.
    if (!homeContent || homeContent.closest(".aden-daily")) return;

    let card = document.getElementById("aud-cny-exchange-card");
    if (!card) {
      card = createCard();
      const weatherCard = document.getElementById("visitor-status-hud");
      if (weatherCard) weatherCard.insertAdjacentElement("afterend", card);
      else homeContent.prepend(card);
    }
    setDetails(card, card.classList.contains("is-expanded"));
    card.querySelector(".aden-widget-toggle").addEventListener("click", () => setDetails(card, !card.classList.contains("is-expanded")), { signal: scope.signal });
    const fresh = readCachedQuote(false);
    const cached = fresh || readCachedQuote(true);
    if (cached) renderQuote(card, cached, fresh ? "cache" : "syncing");
    const trend = mountTrend(card, scope.signal);
    scope.afterPaint(async () => {
      await loadQuote(card, scope.signal);
      if (scope.signal.aborted || !card.isConnected) return;
      // A newer quote than the history's last day extends the line to today.
      trend.refresh();
      await trend.load();
    });
  }

  window.AdenSite?.register('exchange', '.home-content-container', mountExchangeCard);
})();
