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
export function absoluteUrl(route) {
  return SITE_ORIGIN + route;
}
