/* Choose a language at the entry homepage; explicit page URLs remain authoritative. */
(() => {
  const key = 'aden-blog-language';
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const choice = target?.closest('.aden-language-switch a[lang]');
    if (!choice) return;
    const language = choice.lang.startsWith('zh') ? 'zh' : choice.lang === 'en' ? 'en' : null;
    if (!language) return;
    let saved = true;
    try { localStorage.setItem(key, language); } catch (_) { saved = false; }
    const destination = new URL(choice.href, location.href);
    destination.search = location.search;
    destination.hash = location.hash;
    // Keep manual switching usable even when browser storage is blocked.
    if (!saved || destination.searchParams.has('lang')) destination.searchParams.set('lang', language);
    choice.href = destination.href;
  });

  if (!['/', '/index.html'].includes(location.pathname)) return;
  let preferred = new URL(location.href).searchParams.get('lang');
  if (!['zh', 'en'].includes(preferred)) {
    try { preferred = localStorage.getItem(key); } catch (_) { /* Use browser preference. */ }
  }
  const browserLanguage = navigator.languages?.[0] || navigator.language || '';
  if (preferred !== 'en' && (preferred === 'zh' || !/^en(?:[-_]|$)/i.test(browserLanguage))) return;
  const english = document.currentScript?.dataset.englishHome;
  if (!english) return;
  const destination = new URL(english, location.href);
  destination.search = location.search;
  destination.hash = location.hash;
  location.replace(destination.href);
})();
