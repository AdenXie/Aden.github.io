(() => {
  "use strict";

  const QUOTE_URL = "/api/aud-cny?v=2";
  const CACHE_KEY = "aden-aud-cny-v2";
  const CACHE_TTL = 3 * 60 * 60 * 1000;
  const FALLBACK_TTL = 30 * 24 * 60 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 15000;
  const RETRY_DELAY_MS = 1500;
  const ERROR_MESSAGES = {
    connection_timeout: "Exchange rate service connection timeout",
    connection_failed: "Unable to connect to the exchange rate service, please check your network.",
    source_timeout: "Bank of China listing source response timeout",
    source_unavailable: "Bank of China price source reading failed",
    invalid_response: "Data exception returned by the exchange rate service",
    not_found: "The exchange rate interface does not exist (404）",
    access_denied: "Exchange rate request rejected",
    rate_limited: "Exchange rate requests are too frequent, please try again later.",
    service_unavailable: "Exchange rate interface is currently unavailable"
  };
  let swupBound = false;

  function createCard() {
    const card = document.createElement("section");
    card.className = "cyber-exchange-card is-loading";
    card.id = "aud-cny-exchange-card";
    card.setAttribute("aria-label", "Bank of China Australian dollar to Chinese yuan spot exchange rate");
    card.innerHTML = `
      <div class="cyber-exchange-header">
        <span class="cyber-exchange-pair"><i aria-hidden="true"></i> AUD / CNY</span>
        <span>BANK OF CHINA // SPOT FX</span>
      </div>
      <div class="cyber-exchange-body" aria-live="polite">
        <div class="cyber-exchange-intro">
          <span class="cyber-data-label">FOREIGN EXCHANGE TAPE</span>
          <strong>AUD spot exchange rates</strong>
          <span>CNY per 100 AUD</span>
        </div>
        <dl class="cyber-exchange-quotes">
          <div class="is-buy">
            <dt>Spot bid price<span>BUY</span></dt>
            <dd data-exchange="buy">---.--</dd>
          </div>
          <div class="is-sell">
            <dt>Spot selling price<span>SELL</span></dt>
            <dd data-exchange="sell">---.--</dd>
          </div>
        </dl>
      </div>
      <div class="cyber-exchange-footer">
        <span data-exchange="status">Currently connecting the Bank of China listing price…</span>
        <a href="https://www.bankofchina.com/sourcedb/whpj/" target="_blank" rel="noopener noreferrer">Data from Bank of China↗</a>
      </div>
      <p class="cyber-exchange-notice">Spot buying and selling rates are quoted by Bank of China in CNY per 100 AUD. For personal, non-commercial display only. Actual transaction rates are those offered through Bank of China's official banking channels. Commercial reproduction requires permission from Bank of China.</p>`;
    return card;
  }

  function formatRate(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `¥${number.toFixed(2)}` : "---.--";
  }

  function formatPublishedAt(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}):\d{2}$/);
    if (!match) return String(value || "Time unknown");
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
    if (state === "stale" || payload.stale) status.textContent = `${errorMessage(error || { code: payload.fetchError || "source_unavailable" })} · Display cache price · Bank of China update${updated}`;
    else if (state === "cache") status.textContent = `Cache List Price · Bank of China Update${updated}`;
    else status.textContent = `BOC Update${updated} · 3-hour cache`;

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
          card.querySelector('[data-exchange="status"]').textContent = `${errorMessage(error)} · Retrying (1/1）…`;
          await new Promise(resolve => window.setTimeout(resolve, RETRY_DELAY_MS));
          if (!card.isConnected) return;
          continue;
        }
        const previous = readCachedQuote(true);
        if (previous) {
          renderQuote(card, previous, "stale", error);
        } else {
          card.querySelector('[data-exchange="status"]').textContent = `${errorMessage(error)} · There is currently no cache available, please refresh later.`;
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
