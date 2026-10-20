'use strict';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ABBREVIATIONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sept?', 'oct', 'nov', 'dec'];

// English output adds thousands separators ("160000" -> "160,000") and,
// in British English, may write "40 per cent" or "40 %" for "40%".
const normalize = text => text
  .replace(/(\d),(?=\d{3}\b)/gu, '$1')
  .replace(/(\d)\s*(?:per\s?cent|percent)\b/giu, '$1%')
  .replace(/(\d)\s+%/gu, '$1%');
const anchors = text => normalize(text).match(/https?:\/\/[^\s<>()]+|\b\d+(?:[.,]\d+)*%?|\b[A-Z]{2,}\b|\b\w+\.\w{2,}\b/gu) || [];

// "9 月" is correctly rendered as "September", which drops the digit.
function monthNumbers(source) {
  return new Set([...source.matchAll(/(?<!\d)(0?[1-9]|1[0-2])\s*月/gu)].map(match => match[1]));
}

function hasMonthName(translated, month) {
  const index = Number(month) - 1;
  return new RegExp(`\\b(?:${MONTHS[index]}|${ABBREVIATIONS[index]})\\b\\.?`, 'iu').test(translated);
}

function hasSameAnchors(source, translated) {
  const actual = anchors(translated);
  const months = monthNumbers(source);
  return anchors(source).every(item => actual.includes(item) || (months.has(item) && hasMonthName(translated, item)));
}

module.exports = { hasSameAnchors };
