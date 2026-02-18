/**
 * Instant Chrome - Skip loading spinner for returning users with cached auth.
 *
 * Pre-renders an empty header shell (background bar only, no logo images) so
 * content doesn't jump when the full header loads. Logo images are omitted
 * here to avoid FOUC where they briefly render at natural size.
 * The full header (logos, nav, auth, mobile nav) is injected by
 * the page's module script via injectSiteNav(), which replaces this shell.
 *
 * IMPORTANT: This must be a regular (non-module) script so it executes
 * synchronously before module scripts. Place it at the end of <body>,
 * after #appContent, before module <script> tags.
 */
(function () {
  try {
    var cached = localStorage.getItem('genalpaca-cached-auth');
    if (!cached) return;
    var data = JSON.parse(cached);
    if (!data || !data.appUser) return;

    // Show app content immediately, hide loading spinner
    var overlay = document.getElementById('loadingOverlay');
    var content = document.getElementById('appContent');
    if (overlay) overlay.style.display = 'none';
    if (content) content.classList.remove('hidden');

    // Pre-render header shell so content doesn't jump when full header loads.
    // Only renders the header container (no logo images) to avoid FOUC where
    // images briefly render at natural size before CSS constrains them.
    // The full header (logos, nav, auth) is injected by injectSiteNav() moments later.
    var header = document.getElementById('siteHeader');
    if (header && !header.children.length) {
      header.innerHTML =
        '<header class="aap-header aap-header--solid aap-header--dark" id="aap-header">' +
          '<div class="aap-header__inner">' +
            '<a href="/" class="aap-header__logo"></a>' +
            '<div id="aapHeaderAuth" class="aap-header-auth"></div>' +
          '</div>' +
        '</header>';
    }
  } catch (e) { /* silent — first-time visitors or corrupt cache just see the normal spinner */ }
})();
