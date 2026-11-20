"use strict";

// Daily AUD/CNY closes kept inside the aud-cny.json snapshot as [date, spotBuy, spotSell].
// The collector merges the previous snapshot's history with each new quote; the card and
// /api/aud-cny-history read it back. Shared by tools/ and source/api/, so no dependencies.
const MAX_DAYS = 400;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// BOC keeps publishing past midnight Beijing time, so a quote before 06:00 still closes the
// previous trading day. A Sunday key (a Monday small-hours quote) belongs to Monday.
function tradingDay(publishedAt) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(publishedAt || ""));
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s) - 6 * 3600 * 1000);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function validDay(entry) {
  return Array.isArray(entry) && entry.length === 3 && DAY.test(entry[0]) &&
    Number.isFinite(entry[1]) && Number.isFinite(entry[2]) &&
    entry[1] > 0 && entry[2] >= entry[1] && entry[2] < 10000;
}

// Oldest first, one entry per day, the latest source winning for a day.
function mergeHistory(...sources) {
  const days = new Map();
  for (const list of sources) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) if (validDay(entry)) days.set(entry[0], [entry[0], entry[1], entry[2]]);
  }
  return [...days.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-MAX_DAYS);
}

function quoteDay(quote) {
  const day = tradingDay(quote?.publishedAt);
  return day ? [day, quote.spotBuy, quote.spotSell] : null;
}

module.exports = { MAX_DAYS, tradingDay, validDay, mergeHistory, quoteDay };
