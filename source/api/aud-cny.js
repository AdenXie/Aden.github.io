"use strict";

const BOC_RATES_URL = "https://www.bankofchina.com/sourcedb/whpj/";
const SNAPSHOT_URL = "https://raw.githubusercontent.com/AdenXie/Aden.github.io/exchange-rates/aud-cny.json";
const CACHE_SECONDS = 3 * 60 * 60;
const STALE_SECONDS = 7 * 24 * 60 * 60;

let lastSuccessfulQuote = null;

function validSnapshot(quote) {
  const age = Date.now() - Date.parse(quote?.fetchedAt);
  return quote?.currency === "AUD" && quote.quoteCurrency === "CNY" &&
    quote.officialUnit === "CNY per 100 AUD" && quote.source?.url === BOC_RATES_URL &&
    Number.isFinite(quote.spotBuy) && quote.spotBuy > 0 &&
    Number.isFinite(quote.spotSell) && quote.spotSell >= quote.spotBuy && quote.spotSell < 10000 &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(quote.publishedAt) &&
    age >= 0 && age < STALE_SECONDS * 1000 && quote.stale === false;
}

async function fetchSnapshot() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(SNAPSHOT_URL, { signal: controller.signal });
    if (!response.ok) return null;
    const quote = await response.json();
    return validSnapshot(quote) ? quote : null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function sendJson(response, statusCode, payload, cacheable = false) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (cacheable) {
    const freshSeconds = Math.max(0, Math.min(CACHE_SECONDS,
      Math.floor((Date.parse(payload.fetchedAt) + CACHE_SECONDS * 1000 - Date.now()) / 1000)));
    response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    response.setHeader(
      "CDN-Cache-Control",
      `public, s-maxage=${freshSeconds}, stale-while-revalidate=60`
    );
    response.setHeader(
      "Vercel-CDN-Cache-Control",
      `public, s-maxage=${freshSeconds}, stale-while-revalidate=60`
    );
  } else {
    response.setHeader("Cache-Control", "private, no-store, max-age=0");
  }

  response.end(JSON.stringify(payload));
}

module.exports = async function audCnyQuote(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  // Vercel only reads the snapshot; bank access belongs to GitHub Actions.
  const snapshot = await fetchSnapshot();
  if (snapshot) lastSuccessfulQuote = snapshot;
  const quote = snapshot || lastSuccessfulQuote;
  if (quote && validSnapshot(quote)) {
    const fresh = Boolean(snapshot) &&
      Date.now() - Date.parse(quote.fetchedAt) < CACHE_SECONDS * 1000;
    sendJson(response, 200, fresh ? quote : {
      ...quote,
      stale: true,
      fetchError: snapshot ? "snapshot_stale" : "snapshot_unavailable"
    }, fresh);
    return;
  }
  console.warn("[aud-cny] No usable GitHub snapshot");
  sendJson(response, 502, { error: "snapshot_unavailable" });
};

module.exports.validSnapshot = validSnapshot;
