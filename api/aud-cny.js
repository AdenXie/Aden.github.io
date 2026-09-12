"use strict";

const BOC_RATES_URL = "https://www.bankofchina.com/sourcedb/whpj/";
const CACHE_SECONDS = 3 * 60 * 60;
const STALE_SECONDS = 7 * 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 7000;

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

async function fetchOfficialRatesPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Aden-Space-Exchange-Card/1.0 (+https://blog.adenxie.com.cn/)"
      }
    });
    if (!response.ok) throw new Error(`Bank of China returned ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOfficialRates() {
  return fetchOfficialRatesPage(BOC_RATES_URL);
}

module.exports = async function audCnyQuote(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const quote = parseAustralianDollarQuote(await fetchOfficialRates());
    lastSuccessfulQuote = quote;
    sendJson(response, 200, quote, true);
  } catch (error) {
    if (lastSuccessfulQuote) {
      sendJson(
        response,
        200,
        {
          ...lastSuccessfulQuote,
          stale: true,
          fetchError: error?.name === "AbortError" ? "source_timeout" : "source_unavailable"
        },
        true
      );
      return;
    }

    sendJson(response, 502, {
      error: error?.name === "AbortError" ? "source_timeout" : "source_unavailable"
    });
  }
};

module.exports.parseAustralianDollarQuote = parseAustralianDollarQuote;
