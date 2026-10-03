// Mistiq jobs — first-visit language auto-selection.
//
// Loaded synchronously in <head> of every /mistiq/{xx/}jobs/ page so the
// redirect happens before the English page paints (no flash) and before its
// pageview is tracked (no double-count).
//
// Only the English page (/mistiq/jobs/) redirects; a localized URL is always
// treated as an explicit choice (e.g. a shared Thai link) and left alone.
//
// Decision order on /mistiq/jobs/:
//   1. ?lang=xx in the URL           → use it and remember it
//   2. Remembered choice (flag click) → use it
//   3. Browser language, if we have a non-English page for it (ja, zh, de…)
//   4. Device time zone is Thailand   → Thai
//   5. Otherwise stay on English
//
// Country is inferred from the device time zone, not IP geolocation: it is
// instant (no network call, so no flash or added latency), works on static
// GitHub Pages, sends nothing to a third party, and isn't fooled by VPNs.
// See mistiq/README.md → "Language auto-selection".
(function () {
  var STORE_KEY = 'mistiq-lang';
  var REF_KEY = 'mistiq-orig-referrer';
  var SUPPORTED = ['en', 'th', 'es', 'de', 'pl', 'ru', 'zh', 'ja'];
  // Thailand has a single IANA zone. Neighbours (Laos, Cambodia, Vietnam)
  // share UTC+7 but report their own zone IDs, so they stay on English.
  var THAI_TZ = ['Asia/Bangkok'];
  var JOBS_PATH = /^\/mistiq\/(?:([a-z]{2})\/)?jobs\/?(?:index\.html)?$/;

  function store(k, v, session) {
    try { (session ? sessionStorage : localStorage).setItem(k, v); } catch (e) {}
  }
  function load(k, session) {
    try { return (session ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; }
  }
  function isSupported(l) { return SUPPORTED.indexOf(l) !== -1; }
  function jobsUrl(l) { return l === 'en' ? '/mistiq/jobs/' : '/mistiq/' + l + '/jobs/'; }

  // The redirect turns document.referrer into our own English URL, so the
  // target page's tracking reads the original referrer ('' = direct visit)
  // from window.mistiqReferrer instead.
  var origRef = load(REF_KEY, true);
  if (origRef !== null) {
    try { sessionStorage.removeItem(REF_KEY); } catch (e) {}
    window.mistiqReferrer = origRef;
  }

  // Remember explicit picks from any language-picker flag.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.mistiq-lang-picker__dropdown a, .mistiq-mobile-nav__lang a');
    if (!a) return;
    var m = JOBS_PATH.exec(a.pathname);
    if (m) store(STORE_KEY, m[1] || 'en');
  }, true);

  var here = JOBS_PATH.exec(location.pathname);
  if (!here || here[1]) return; // only the English jobs page redirects
  if (/bot|crawl|spider|slurp|facebookexternalhit|preview/i.test(navigator.userAgent)) return;

  var params = new URLSearchParams(location.search);
  var target = null;

  var forced = (params.get('lang') || '').toLowerCase();
  if (isSupported(forced)) {
    store(STORE_KEY, forced);
    target = forced;
  }

  if (!target) {
    var saved = load(STORE_KEY);
    if (isSupported(saved)) target = saved;
  }

  if (!target) {
    var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < langs.length; i++) {
      var primary = String(langs[i]).toLowerCase().split('-')[0];
      if (isSupported(primary)) {
        // English browser UI is common in Thailand, so English falls through
        // to the time-zone check rather than locking in English.
        if (primary !== 'en') target = primary;
        break;
      }
    }
  }

  if (!target) {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    if (THAI_TZ.indexOf(tz) !== -1) target = 'th';
  }

  if (!target || target === 'en') return;

  params.delete('lang');
  var qs = params.toString();
  store(REF_KEY, document.referrer || '', true);
  location.replace(jobsUrl(target) + (qs ? '?' + qs : '') + location.hash);
})();
