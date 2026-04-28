/**
 * routes.ts — AUTO-GENERATED MIRROR of /shared/routes.js. DO NOT EDIT BY HAND.
 *
 * Edit /shared/routes.js (the source of truth), then run:
 *   node scripts/sync-routes.js
 *
 * CI runs `node scripts/sync-routes.js --check` and fails if drift is detected.
 *
 * Edge functions run on Deno and cannot import frontend ESM modules from
 * /shared/, so we maintain this mirror. The body below is byte-identical to
 * the source after stripping each file's header comment block.
 */

export const SITE_ORIGIN = 'https://alpacaplayhouse.com';

export const ROUTES = {
  // Public top-nav pages
  public: {
    home:      '/',
    visiting:  '/visiting/',
    rentals:   '/spaces/',          // Phase 4 → '/rentals/'
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

  // Public rentals deep links — Phase 4 will rename /spaces/* to /rentals/*.
  // Keep ROUTES.public.rentals === ROUTES.rentals.home in lockstep.
  rentals: {
    home:      '/spaces/',
    apply:     '/spaces/apply/',
    hostEvent: '/spaces/hostevent/',
    book:      '/spaces/book/',
    signing:   '/spaces/signing/',
    ical:      '/spaces/ical/',
    verify:    '/spaces/verify.html',
    w9:        '/spaces/w9.html',
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
export function absoluteUrl(route: string): string {
  return SITE_ORIGIN + route;
}
