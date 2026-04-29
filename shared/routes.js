/**
 * routes.js — Single source of truth for internal URL paths.
 *
 * Edit this file to move pages; consumers (shells, tab configs, edge function
 * email templates) automatically pick up the change. See planning doc:
 *   /Users/alpuca/.claude/plans/the-folder-names-are-zippy-graham.md
 *
 * Phase 0 values: every path matches the CURRENT live URL exactly. Subsequent
 * phases edit this file in lockstep with `git mv` of the underlying files
 * and a redirect entry in /404.html.
 *
 * MIRRORED in /supabase/functions/_shared/routes.ts (auto-generated).
 * Run `node scripts/sync-routes.js` after editing this file. CI fails if drift
 * is detected (`scripts/sync-routes.js --check`).
 */

export const SITE_ORIGIN = 'https://alpacaplayhouse.com';

export const ROUTES = {
  // Public top-nav pages
  public: {
    home:      '/',
    visiting:  '/visiting/',
    rentals:   '/rentals/',         // moved from /spaces/ in Phase 4
    events:    '/events/',
    community: '/community/',
    photos:    '/photos/',
    contact:   '/contact/',
  },

  // Devices nav tab — moved to /devices/* in Phase 2.
  devices: {
    list:       '/devices/devices.html',
    lighting:   '/devices/lighting.html',
    music:      '/devices/sonos.html',
    cameras:    '/devices/cameras.html',
    climate:    '/devices/climate.html',
    appliances: '/devices/appliances.html',
    laundry:    '/devices/laundry.html',     // legacy alias / redirect stub for appliances
    cars:       '/devices/cars.html',
    sensors:    '/devices/sensors.html',
    printer:    '/devices/3dprinter.html',
  },

  // Residents nav tab — resident-personal pages (stay in /residents/ across all phases)
  residents: {
    home:           '/residents/',
    profile:        '/residents/profile.html',
    myAccess:       '/residents/my-access.html',
    bookkeeping:    '/residents/bookkeeping.html',
    media:          '/residents/media.html',
    askPai:         '/residents/ask-pai.html',
    lifeOfPaiAdmin: '/residents/lifeofpaiadmin.html',
  },

  // Associates nav tab
  associates: {
    home:           '/associates/',
    worktracking:   '/associates/worktracking.html',
    projects:       '/associates/projects.html',
    projectInquiry: '/associates/projectinquiry.html',
  },

  // Staff nav tab — moved to /staff/* in Phase 3.
  staff: {
    base:         '/staff/',
    spaces:       '/staff/spaces.html',
    rentals:      '/staff/rentals.html',
    reservations: '/staff/reservations.html',
    events:       '/staff/events.html',
    media:        '/staff/media.html',
    sms:          '/staff/sms-messages.html',
    purchases:    '/staff/purchases.html',
    worktracking: '/staff/worktracking.html',
    payments:     '/staff/payments.html',
    faq:          '/staff/faq.html',
    voice:        '/staff/voice.html',
    phyprop:      '/staff/phyprop.html',
    inventory:    '/staff/inventory.html',
    appdev:       '/staff/appdev.html',
    manage:       '/staff/manage.html',
  },

  // Admin nav tab — moved to /admin/* in Phase 3.
  admin: {
    base:          '/admin/',
    users:         '/admin/users.html',
    passwords:     '/admin/passwords.html',
    settings:      '/admin/settings.html',
    releases:      '/admin/releases.html',
    signatures:    '/admin/signatures.html',
    templates:     '/admin/templates.html',
    brand:         '/admin/brand.html',
    accounting:    '/admin/accounting.html',
    notifications: '/admin/notifications.html',
    testdev:       '/admin/testdev.html',
    testSuite:     '/admin/test-suite.html',
    alpaclaw:      '/admin/alpaclaw.html',
  },

  // DevControl nav tab — moved to /devcontrol/ in Phase 1.
  devcontrol: {
    home: '/devcontrol/',
  },

  // Public rentals deep links — moved from /spaces/* to /rentals/* in Phase 4.
  // Keep ROUTES.public.rentals === ROUTES.rentals.home in lockstep.
  rentals: {
    home:      '/rentals/',
    apply:     '/rentals/apply/',
    hostEvent: '/rentals/hostevent/',
    book:      '/rentals/book/',
    signing:   '/rentals/signing/',
    ical:      '/rentals/ical/',
    verify:    '/rentals/verify.html',
    w9:        '/rentals/w9.html',
  },

  // Auth & callbacks (no nav tab)
  auth: {
    login:         '/login/',
    teslaCallback: '/auth/tesla/callback.html',
  },
};

/**
 * Convert a route path to a fully-qualified absolute URL.
 * Use in edge function email templates and any context where a full URL is needed.
 *
 *   absoluteUrl(ROUTES.staff.payments)
 *   // → 'https://alpacaplayhouse.com/spaces/admin/payments.html' (Phase 0)
 */
export function absoluteUrl(route) {
  return SITE_ORIGIN + route;
}
