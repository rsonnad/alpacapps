/**
 * Instant Chrome - Skip loading spinner for returning users with cached auth.
 *
 * Pre-renders a header shell with properly-sized logo images so content
 * doesn't jump when the full header loads. Logo images include explicit
 * width/height attributes to prevent FOUC (flash of unstyled content).
 * The full header (nav, auth, mobile nav) is injected by
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

    // Pre-render header shell with sized logo images.
    // Explicit width/height attributes prevent the images from ever rendering
    // at their natural size (319x453 / 512x512) during the brief window before
    // CSS applies .aap-header__icon { height: 30px }.
    var header = document.getElementById('siteHeader');
    if (header && !header.children.length) {
      var logoBase = 'https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos/logos';
      header.innerHTML =
        '<header class="aap-header aap-header--solid aap-header--dark" id="aap-header">' +
          '<div class="aap-header__inner">' +
            '<a href="/" class="aap-header__logo">' +
              '<img src="' + logoBase + '/alpaca-head-black-transparent.png" alt="" class="aap-header__icon" width="21" height="30">' +
              '<img src="' + logoBase + '/wordmark-black-transparent.png" alt="Alpaca Playhouse" class="aap-header__wordmark" width="22" height="22">' +
            '</a>' +
            '<div id="aapHeaderAuth" class="aap-header-auth"></div>' +
          '</div>' +
        '</header>';
    }
  } catch (e) { /* silent — first-time visitors or corrupt cache just see the normal spinner */ }
})();
