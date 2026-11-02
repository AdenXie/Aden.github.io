'use strict';
// Daily brief titles open with the day, which the archive and category lists already show in their
// date column. Used after translation (tools/optimize-site.cjs), so the title segments stay as they are.
// Forms seen in the translation cache: "每日简报｜2026-11-02：", "Daily Briefing | 2026-08-24:",
// "Daily Briefing | August 24, 2026:" and "Daily Briefing | 1 November 2026:". Anything else is left alone.
const ZH = /^每日简报\s*[|｜]\s*\d{4}-\d{2}-\d{2}\s*[:：]\s*/;
const EN = /^Daily Brief(?:ing)?\s*[|｜]\s*(?:\d{4}-\d{2}-\d{2}|[A-Za-z]+ \d{1,2}, \d{4}|\d{1,2} [A-Za-z]+ \d{4})\s*[:：]\s*/i;

// { prefix, rest } for a brief title, or null when the title has no prefix or nothing would be left.
function splitBriefPrefix(title, english) {
  const text = String(title || '');
  const match = (english ? EN : ZH).exec(text);
  if (!match || match[0].length >= text.length) return null;
  return { prefix: match[0], rest: text.slice(match[0].length) };
}

module.exports = { splitBriefPrefix };
