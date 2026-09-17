"use strict";

const BOC_RATES_URL = "https://www.bankofchina.com/sourcedb/whpj/";
const BOC_RATES_URLS = [BOC_RATES_URL, "https://www.boc.cn/sourcedb/whpj/"];
const CACHE_SECONDS = 3 * 60 * 60;
const STALE_SECONDS = 7 * 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 12000;

let lastSuccessfulQuote = null;

function sendJson(response, statusCode, payload, cacheable = false) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (cacheable) {
    response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    response.setHeader(
      "CDN-Cache-Control",
      `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}, stale-if-error=${STALE_SECONDS}`
    );
    response.setHeader(
      "Vercel-CDN-Cache-Control",
      `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}, stale-if-error=${STALE_SECONDS}`
    );
  } else {
    response.setHeader("Cache-Control", "private, no-store, max-age=0");
  }

  response.end(JSON.stringify(payload));
}

function cleanCell(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRate(value, label) {
  const parsed = Number.parseFloat(String(value).replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 10000) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
}

function parseAustralianDollarQuote(html) {
  const row = html.match(
    /<tr[^>]*data-currency=["']澳大利亚元["'][^>]*>([\s\S]*?)<\/tr>/i
  );
  if (!row) throw new Error("AUD row was not found");

  const cells = Array.from(row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi), (match) =>
    cleanCell(match[1])
  );
  if (cells.length < 7 || cells[0] !== "澳大利亚元") {
    throw new Error("AUD row structure changed");
  }

  const spotBuyPer100 = parseRate(cells[1], "spot buy rate");
  const spotSellPer100 = parseRate(cells[3], "spot sell rate");
  const publishedAt = cells[6];

  if (!/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(publishedAt)) {
    throw new Error("Invalid publication time");
  }
  if (spotSellPer100 < spotBuyPer100) {
    throw new Error("Unexpected buy/sell relationship");
  }

  return {
    currency: "AUD",
    quoteCurrency: "CNY",
    spotBuy: spotBuyPer100,
    spotSell: spotSellPer100,
    officialUnit: "CNY per 100 AUD",
    officialSpotBuy: spotBuyPer100,
    officialSpotSell: spotSellPer100,
    publishedAt: publishedAt.replaceAll("/", "-"),
    source: {
      name: "中国银行",
      url: BOC_RATES_URL
    },
    fetchedAt: new Date().toISOString(),
    stale: false
  };
}

async function fetchOfficialRatesPage(url, signal) {
  const response = await fetch(url, {
    signal,
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Aden-Space-Exchange-Card/1.0 (+https://blog.adenxie.com.cn/)"
    }
  });
  if (!response.ok) throw new Error(`Bank of China returned ${response.status}`);
  // A successful HTTP response is not sufficient: validate before accepting a source.
  return parseAustralianDollarQuote(await response.text());
}

async function fetchOfficialRates() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // Both are official BOC hosts. One stalled route must not prevent the other
    // from serving the same per-100-AUD quote within the client's 15s budget.
    return await Promise.any(BOC_RATES_URLS.map(url => fetchOfficialRatesPage(url, controller.signal)));
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error("Source timeout"), { name: "AbortError" });
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

module.exports = async function audCnyQuote(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const quote = await fetchOfficialRates();
    lastSuccessfulQuote = quote;
    sendJson(response, 200, quote, true);
  } catch (error) {
    const code = error?.name === "AbortError" ? "source_timeout" : "source_unavailable";
    console.warn("[aud-cny] Official sources failed", { code });
    if (lastSuccessfulQuote && Date.now() - Date.parse(lastSuccessfulQuote.fetchedAt) < STALE_SECONDS * 1000) {
      sendJson(
        response,
        200,
        {
          ...lastSuccessfulQuote,
          stale: true,
          fetchError: code
        },
        false
      );
      return;
    }

    sendJson(response, 502, {
      error: code
    });
  }
};

module.exports.parseAustralianDollarQuote = parseAustralianDollarQuote;
