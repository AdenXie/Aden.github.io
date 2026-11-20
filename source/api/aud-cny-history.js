"use strict";

const { loadQuote, historyOf, sendJson } = require("./aud-cny.js");

// Daily Bank of China closes for the AUD/CNY card's trend line, read from the same GitHub
// snapshot as /api/aud-cny and cached for the same window.
module.exports = async function audCnyHistory(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }
  const quote = await loadQuote();
  if (!quote) {
    console.warn("[aud-cny-history] No usable GitHub snapshot");
    sendJson(response, 502, { error: "snapshot_unavailable" });
    return;
  }
  sendJson(response, 200, {
    currency: "AUD",
    quoteCurrency: "CNY",
    officialUnit: quote.officialUnit,
    source: quote.source,
    publishedAt: quote.publishedAt,
    fetchedAt: quote.fetchedAt,
    stale: quote.stale,
    // [date (Beijing trading day), spotBuy, spotSell], oldest first.
    days: historyOf(quote)
  }, quote.stale === false);
};
