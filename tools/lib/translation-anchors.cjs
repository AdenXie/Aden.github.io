'use strict';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ABBREVIATIONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sept?', 'oct', 'nov', 'dec'];
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

// English output adds thousands separators ("160000" -> "160,000") and,
// in British English, may write "40 per cent" or "40 %" for "40%".
const normalize = text => text
  .replace(/(\d),(?=\d{3}\b)/gu, '$1')
  .replace(/(\d)\s*(?:per\s?cent|percent)\b/giu, '$1%')
  .replace(/(\d)\s+%/gu, '$1%');
// "09" and "9" are the same day or month once a date is reworded.
const canonical = token => (/^\d+$/u.test(token) ? String(Number(token)) : token);
const anchors = text => (normalize(text).match(/https?:\/\/[^\s<>()]+|\b\d+(?:[.,]\d+)*%?|\b[A-Z]{2,}\b|\b\w+\.\w{2,}\b/gu) || []).map(canonical);

// "9 月" and "2026-09-17" are correctly rendered with English month names, which drops the digit.
function monthNumbers(source) {
  const months = [...source.matchAll(/(?<!\d)(0?[1-9]|1[0-2])\s*月/gu), ...source.matchAll(/\b\d{4}-(0?[1-9]|1[0-2])-\d{1,2}\b/gu)];
  return new Set(months.map(match => canonical(match[1])));
}

function hasMonthName(translated, month) {
  const index = Number(month) - 1;
  return new RegExp(`\\b(?:${MONTHS[index]}|${ABBREVIATIONS[index]})\\b\\.?`, 'iu').test(translated);
}

// Small counts such as "1 年期" are naturally written as words ("one-year").
const hasNumberWord = (translated, item) => Number(item) <= 10 && new RegExp(`\\b${NUMBER_WORDS[Number(item)]}\\b`, 'iu').test(translated);

function hasSameAnchors(source, translated) {
  const actual = anchors(translated);
  const months = monthNumbers(source);
  return anchors(source).every(item => actual.includes(item)
    || (months.has(item) && hasMonthName(translated, item))
    || (/^\d+$/u.test(item) && hasNumberWord(translated, item)));
}

module.exports = { hasSameAnchors };
