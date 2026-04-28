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

  // Devices nav tab — Phase 2 will move these from /residents/* to /devices/*
  devices: {
    list:       '/residents/devices.html',
    lighting:   '/residents/lighting.html',
    music:      '/residents/sonos.html',
    cameras:    '/residents/cameras.html',
    climate:    '/residents/climate.html',
    appliances: '/residents/appliances.html',
    laundry:    '/residents/laundry.html',     // legacy alias / redirect stub for appliances
    cars:       '/residents/cars.html',
    sensors:    '/residents/sensors.html',
    printer:    '/residents/3dprinter.html',
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

  // Staff nav tab — Phase 3 will move these from /spaces/admin/* to /staff/*
  staff: {
    base:         '/spaces/admin/',
    spaces:       '/spaces/admin/spaces.html',
    rentals:      '/spaces/admin/rentals.html',
    reservations: '/spaces/admin/reservations.html',
    events:       '/spaces/admin/events.html',
    media:        '/spaces/admin/media.html',
    sms:          '/spaces/admin/sms-messages.html',
    purchases:    '/spaces/admin/purchases.html',
    worktracking: '/spaces/admin/worktracking.html',
    payments:     '/spaces/admin/payments.html',
    faq:          '/spaces/admin/faq.html',
    voice:        '/spaces/admin/voice.html',
    phyprop:      '/spaces/admin/phyprop.html',
    inventory:    '/spaces/admin/inventory.html',
    appdev:       '/spaces/admin/appdev.html',
    manage:       '/spaces/admin/manage.html',
  },

  // Admin nav tab — Phase 3 will move these from /spaces/admin/* to /admin/*
  admin: {
    base:          '/spaces/admin/',
    users:         '/spaces/admin/users.html',
    passwords:     '/spaces/admin/passwords.html',
    settings:      '/spaces/admin/settings.html',
    releases:      '/spaces/admin/releases.html',
    signatures:    '/spaces/admin/signatures.html',
    templates:     '/spaces/admin/templates.html',
    brand:         '/spaces/admin/brand.html',
    accounting:    '/spaces/admin/accounting.html',
    notifications: '/spaces/admin/notifications.html',
    testdev:       '/spaces/admin/testdev.html',
    testSuite:     '/spaces/admin/test-suite.html',
    alpaclaw:      '/spaces/admin/alpaclaw.html',
  },

  // DevControl nav tab — Phase 1 will move this from /spaces/admin/devcontrol/ to /devcontrol/
  devcontrol: {
    home: '/spaces/admin/devcontrol/',
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
