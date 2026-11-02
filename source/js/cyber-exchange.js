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
        <span>BANK OF CHINA // SPOT FX</span>
      </div>
      <div class="cyber-exchange-body" aria-live="polite">
        <div class="cyber-exchange-intro">
          <span class="cyber-data-label">FOREIGN EXCHANGE TAPE</span>
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

  function renderQuote(card, payload, state = "live", error = null) {
    if (!card?.isConnected || !isValidQuote(payload)) return;
    card.querySelector('[data-exchange="buy"]').textContent = formatRate(payload.spotBuy);
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
    scope.afterPaint(() => loadQuote(card, scope.signal));
  }

  window.AdenSite?.register('exchange', '.home-content-container', mountExchangeCard);
})();
