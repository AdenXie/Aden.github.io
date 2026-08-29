(() => {
  "use strict";

  const QUOTE_URL = "/api/aud-cny";
  const CACHE_KEY = "aden-aud-cny-v1";
  const CACHE_TTL = 3 * 60 * 60 * 1000;
  const FALLBACK_TTL = 30 * 24 * 60 * 60 * 1000;
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
          <span>人民币 / 1澳元</span>
        </div>
        <dl class="cyber-exchange-quotes">
          <div class="is-buy">
            <dt>现汇买入价 <span>BUY</span></dt>
            <dd data-exchange="buy">-.----</dd>
          </div>
          <div class="is-sell">
            <dt>现汇卖出价 <span>SELL</span></dt>
            <dd data-exchange="sell">-.----</dd>
          </div>
        </dl>
      </div>
      <div class="cyber-exchange-footer">
        <span data-exchange="status">正在连接中国银行牌价…</span>
        <a href="https://www.boc.cn/sourcedb/whpj/" target="_blank" rel="noopener noreferrer">数据来源于中国银行 ↗</a>
      </div>
      <p class="cyber-exchange-notice">每1澳元价格由中国银行每100澳元官方牌价换算。仅供个人非商业展示；实际交易以中国银行网上银行、手机银行、智能柜台或网点柜台价格为准。未经中国银行许可，不得用于商业转载。</p>`;
    return card;
  }

  function formatRate(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `¥${number.toFixed(4)}` : "-.----";
  }

  function formatPublishedAt(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}):\d{2}$/);
    if (!match) return String(value || "时间未知");
    return `${match[1]}-${match[2]}-${match[3]} ${match[4]}`;
  }

  function isValidQuote(payload) {
    return (
      payload?.currency === "AUD" &&
      Number.isFinite(Number(payload.spotBuy)) &&
      Number.isFinite(Number(payload.spotSell)) &&
      Boolean(payload.publishedAt)
    );
  }

  function renderQuote(card, payload, state = "live") {
    if (!card?.isConnected || !isValidQuote(payload)) return;
    card.querySelector('[data-exchange="buy"]').textContent = formatRate(payload.spotBuy);
    card.querySelector('[data-exchange="sell"]').textContent = formatRate(payload.spotSell);

    const updated = formatPublishedAt(payload.publishedAt);
    const status = card.querySelector('[data-exchange="status"]');
    if (state === "stale" || payload.stale) status.textContent = `读取失败 · 上次更新 ${updated}`;
    else if (state === "cache") status.textContent = `缓存牌价 · 中行更新 ${updated}`;
    else status.textContent = `中行更新 ${updated} · 三小时缓存`;

    card.classList.remove("is-loading", "is-offline");
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
      localStorage.removeItem(CACHE_KEY);
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

  async function fetchQuote() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(QUOTE_URL, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error(`Exchange endpoint returned ${response.status}`);
      const payload = await response.json();
      if (!isValidQuote(payload)) throw new Error("Incomplete exchange quote");
      return payload;
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

    try {
      const payload = await fetchQuote();
      cacheQuote(payload);
      renderQuote(card, payload, payload.stale ? "stale" : "live");
    } catch (error) {
      const previous = readCachedQuote(true);
      if (previous) {
        renderQuote(card, previous, "stale");
      } else if (card?.isConnected) {
        card.querySelector('[data-exchange="status"]').textContent = "牌价暂不可用 · 请稍后重试";
        card.classList.remove("is-loading");
        card.classList.add("is-offline");
      }
      console.warn("AUD/CNY exchange card:", error);
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
