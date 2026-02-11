/**
 * Instant Chrome - Skip loading spinner for returning users with cached auth.
 *
 * Also pre-renders the site header shell (logo + wordmark + background) so
 * there is no visual flash when switching between authenticated pages.
 * The full header (nav links, auth menu, mobile nav) is injected later by
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

    // Pre-render header shell to prevent logo/wordmark flash.
    // This renders the same structure as renderHeader({ transparent: false, light: false })
    // but without nav links, auth, or mobile nav (those are added by injectSiteNav later).
    var header = document.getElementById('siteHeader');
    if (header && !header.children.length) {
      var b = 'https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos/logos';
      header.innerHTML =
        '<header class="aap-header aap-header--solid aap-header--dark" id="aap-header">' +
          '<div class="aap-header__inner">' +
            '<a href="/" class="aap-header__logo">' +
              '<img src="' + b + '/alpaca-head-black-transparent.png" alt="Alpaca Playhouse Austin" class="aap-header__icon" ' +
                'data-light-src="' + b + '/alpaca-head-white-transparent.png" ' +
                'data-dark-src="' + b + '/alpaca-head-black-transparent.png">' +
              '<img src="' + b + '/wordmark-black-transparent.png" alt="Alpaca Playhouse Austin" class="aap-header__wordmark" ' +
                'data-light-src="' + b + '/wordmark-white-transparent.png" ' +
                'data-dark-src="' + b + '/wordmark-black-transparent.png">' +
            '</a>' +
            '<div id="aapHeaderAuth" class="aap-header-auth"></div>' +
            '<button class="aap-menu-toggle" id="aap-menu-toggle" aria-label="Toggle menu">' +
              '<span class="aap-menu-toggle__bar"></span>' +
              '<span class="aap-menu-toggle__bar"></span>' +
              '<span class="aap-menu-toggle__bar"></span>' +
            '</button>' +
          '</div>' +
        '</header>';
    }
  } catch (e) { /* silent — first-time visitors or corrupt cache just see the normal spinner */ }
})();
