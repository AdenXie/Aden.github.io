(() => {
  "use strict";

  const QUOTE_URL = "/api/aud-cny?v=2";
  const CACHE_KEY = "aden-aud-cny-v2";
  const CACHE_TTL = 3 * 60 * 60 * 1000;
  const FALLBACK_TTL = 30 * 24 * 60 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 15000;
  const RETRY_DELAY_MS = 1500;
  const ERROR_MESSAGES = {
    connection_timeout: "连接汇率服务超时",
    connection_failed: "无法连接汇率服务，请检查网络",
    source_timeout: "中行牌价源响应超时",
    source_unavailable: "中行牌价源读取失败",
    invalid_response: "汇率服务返回的数据异常",
    not_found: "汇率接口不存在（404）",
    access_denied: "汇率请求被拒绝",
    rate_limited: "汇率请求过于频繁，请稍后再试",
    service_unavailable: "汇率接口暂不可用"
  };
  let swupBound = false;

  function createCard() {
    const card = document.createElement("section");
    card.className = "cyber-exchange-card is-loading";
    card.id = "aud-cny-exchange-card";
    card.setAttribute("aria-label", "中国银行澳大利亚元兑人民币现汇牌价");
    card.innerHTML = `
      <div class="cyber-exchange-header">
        <span class="cyber-exchange-pair"><i aria-hidden="true"></i> AUD / CNY</span>
        <span>BANK OF CHINA // SPOT FX</span>
      </div>
      <div class="cyber-exchange-body" aria-live="polite">
        <div class="cyber-exchange-intro">
          <span class="cyber-data-label">FOREIGN EXCHANGE TAPE</span>
          <strong>澳元现汇牌价</strong>
          <span>人民币 / 100澳元</span>
        </div>
        <dl class="cyber-exchange-quotes">
          <div class="is-buy">
            <dt>现汇买入价 <span>BUY</span></dt>
            <dd data-exchange="buy">---.--</dd>
          </div>
          <div class="is-sell">
            <dt>现汇卖出价 <span>SELL</span></dt>
            <dd data-exchange="sell">---.--</dd>
          </div>
        </dl>
      </div>
      <div class="cyber-exchange-footer">
        <span data-exchange="status">正在连接中国银行牌价…</span>
        <a href="https://www.bankofchina.com/sourcedb/whpj/" target="_blank" rel="noopener noreferrer">数据来源于中国银行 ↗</a>
      </div>
      <p class="cyber-exchange-notice">现汇买入价与现汇卖出价均为中国银行每100澳元折合人民币的官方牌价。仅供个人非商业展示；实际交易以中国银行网上银行、手机银行、智能柜台或网点柜台价格为准。未经中国银行许可，不得用于商业转载。</p>`;
    return card;
  }

  function formatRate(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `¥${number.toFixed(2)}` : "---.--";
  }

  function formatPublishedAt(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}):\d{2}$/);
    if (!match) return String(value || "时间未知");
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

    const updated = formatPublishedAt(payload.publishedAt);
    const status = card.querySelector('[data-exchange="status"]');
    if (state === "stale" || payload.stale) status.textContent = `${errorMessage(error || { code: payload.fetchError || "source_unavailable" })} · 显示缓存牌价 · 中行更新 ${updated}`;
    else if (state === "cache") status.textContent = `缓存牌价 · 中行更新 ${updated}`;
    else status.textContent = `中行更新 ${updated} · 三小时缓存`;

    card.classList.remove("is-loading", "is-offline", "is-stale", "is-online");
    card.classList.add(state === "stale" || payload.stale ? "is-stale" : "is-online");
  }

  function readCachedQuote(allowExpired = false) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (!cached || !isValidQuote(cached.payload)) return null;
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
    return ERROR_MESSAGES[error?.code] || ERROR_MESSAGES.service_unavailable;
  }

  function canRetry(error) {
    return ["connection_timeout", "connection_failed", "source_timeout", "source_unavailable", "service_unavailable"].includes(error?.code);
  }

  async function fetchQuote() {
    const controller = new AbortController();
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
        const sourceCode = ["source_timeout", "source_unavailable"].includes(payload?.error) ? payload.error : null;
        throw quoteError(statusCode || sourceCode || "service_unavailable");
      }
      if (!isValidQuote(payload)) throw quoteError("invalid_response");
      return payload;
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") throw quoteError("connection_timeout");
      throw error?.code ? error : quoteError("connection_failed");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function loadQuote(card) {
    const fresh = readCachedQuote(false);
    if (fresh) {
      renderQuote(card, fresh, "cache");
      return;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const payload = await fetchQuote();
        cacheQuote(payload);
        renderQuote(card, payload, payload.stale ? "stale" : "live");
        return;
      } catch (error) {
        if (!card?.isConnected) return;
        if (attempt === 0 && canRetry(error)) {
          card.querySelector('[data-exchange="status"]').textContent = `${errorMessage(error)} · 正在重试（1/1）…`;
          await new Promise(resolve => window.setTimeout(resolve, RETRY_DELAY_MS));
          if (!card.isConnected) return;
          continue;
        }
        const previous = readCachedQuote(true);
        if (previous) {
          renderQuote(card, previous, "stale", error);
        } else {
          card.querySelector('[data-exchange="status"]').textContent = `${errorMessage(error)} · 暂无可用缓存，请稍后刷新`;
          card.classList.remove("is-loading", "is-online", "is-stale");
          card.classList.add("is-offline");
        }
        return;
      }
    }
  }

  function mountExchangeCard() {
    const homeContent = document.querySelector(".home-content-container");
    if (!homeContent) return;

    let card = document.getElementById("aud-cny-exchange-card");
    if (!card) {
      card = createCard();
      const weatherCard = document.getElementById("visitor-status-hud");
      if (weatherCard) weatherCard.insertAdjacentElement("afterend", card);
      else homeContent.prepend(card);
    }
    loadQuote(card);
  }

  function bindSwup(swup) {
    if (swupBound || !swup?.hooks) return;
    swupBound = true;
    swup.hooks.on("page:view", mountExchangeCard);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountExchangeCard, { once: true });
  } else {
    mountExchangeCard();
  }

  if (window.swup?.hooks) {
    bindSwup(window.swup);
  } else {
    window.addEventListener(
      "redefine:swup:ready",
      (event) => bindSwup(event.detail?.swup || window.swup),
      { once: true }
    );
  }
})();
