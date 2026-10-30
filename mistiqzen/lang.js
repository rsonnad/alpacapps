// Mistiq Zen language routing.
// First visit: phones set to Thai (language "th" or region "TH") go to /mistiqzen/th/,
// everyone else stays in English. An explicit choice (?lang=en|th from the flag
// picker) is remembered and always wins.
(function () {
  var KEY = 'mistiqzen-lang';
  var params = new URLSearchParams(location.search);
  var chosen = params.get('lang');
  var stored = null;
  try {
    if (chosen === 'en' || chosen === 'th') localStorage.setItem(KEY, chosen);
    stored = localStorage.getItem(KEY);
  } catch (e) {}

  var path = location.pathname;
  var onThai = path.indexOf('/mistiqzen/th/') === 0;
  var pref = chosen || stored;

  if (!pref && !onThai) {
    var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    var thai = langs.some(function (l) { return /^th(-|$)/i.test(l) || /-TH$/i.test(l); });
    if (thai) pref = 'th';
  }

  var target = null;
  if (pref === 'th' && !onThai) target = path.replace('/mistiqzen/', '/mistiqzen/th/');
  if (pref === 'en' && onThai) target = path.replace('/mistiqzen/th/', '/mistiqzen/');
  if (target && target !== path) {
    params.delete('lang');
    var query = params.toString();
    location.replace(target + (query ? '?' + query : '') + location.hash);
  }
})();
