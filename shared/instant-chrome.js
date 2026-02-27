/**
 * Instant Chrome - Pre-render header shell for returning users with cached auth.
 *
 * NOTE: Overlay hiding and content visibility are now handled by inline
 * <script>+<style> in each page's <head> (runs before first paint).
 * This script's main job is pre-rendering the header shell with logo images.
 * The overlay.style.display='none' and content.classList.remove('hidden')
 * calls below are redundant but kept for backwards compatibility.
 *
 * IMPORTANT: This must be a regular (non-module) script so it executes
 * synchronously before module scripts. Place it at the end of <body>,
 * after #appContent, before module <script> tags.
 */
(function () {
  try {
    var fallbackIcon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 30"><path d="M10.5 1.5C8.3 1.5 6.5 3.3 6.5 5.5v4.1L3.8 13c-1 1.3-1.5 2.8-1.5 4.4 0 4.6 3.7 8.3 8.2 8.3s8.2-3.7 8.2-8.3c0-1.6-.5-3.2-1.5-4.4l-2.7-3.4V5.5c0-2.2-1.8-4-4-4z" fill="#1f1720"/><ellipse cx="10.5" cy="18.6" rx="3.1" ry="4.7" fill="#f6f5f0"/></svg>');
    var fallbackWordmark = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 28"><text x="0" y="20" font-size="16" font-family="Arial,sans-serif" fill="#1f1720">Alpaca</text></svg>');
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
              '<img src="' + logoBase + '/alpaca-head-black-transparent.png" alt="" class="aap-header__icon" width="21" height="30" style="height:30px;width:auto;max-width:none" onerror="this.onerror=null;this.src=\'' + fallbackIcon + '\'">' +
              '<img src="' + logoBase + '/wordmark-black-transparent.png" alt="Alpaca Playhouse" class="aap-header__wordmark" width="22" height="22" style="height:22px;width:auto;max-width:none" onerror="this.onerror=null;this.src=\'' + fallbackWordmark + '\'">' +
            '</a>' +
            '<div id="aapHeaderAuth" class="aap-header-auth"></div>' +
          '</div>' +
        '</header>';
    }
  } catch (e) { /* silent — first-time visitors or corrupt cache just see the normal spinner */ }
})();
