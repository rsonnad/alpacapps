/**
 * Admin Tab Definitions - Shared tab config for staff/admin sections.
 * Extracted to avoid circular dependencies between admin-shell.js and context-switcher.js.
 *
 * All hrefs are absolute paths sourced from ./routes.js. To move a page,
 * edit /shared/routes.js — every tab here picks up the change.
 */

import { ROUTES } from './routes.js';

export const ALL_ADMIN_TABS = [
  // Staff section
  { id: 'spaces',       label: 'Spaces',      href: ROUTES.staff.spaces,       permission: 'view_spaces',     section: 'staff' },
  { id: 'rentals',      label: 'Rentals',     href: ROUTES.staff.rentals,      permission: 'view_rentals',    section: 'staff', feature: 'rentals' },
  { id: 'reservations', label: 'Reservations', href: ROUTES.staff.reservations, permission: 'view_rentals',   section: 'staff', feature: 'rentals' },
  { id: 'events',       label: 'Events',      href: ROUTES.staff.events,       permission: 'view_events',     section: 'staff', feature: 'events' },
  { id: 'media',        label: 'Media',       href: ROUTES.staff.media,        permission: 'view_media',      section: 'staff' },
  { id: 'sms',          label: 'SMS',         href: ROUTES.staff.sms,          permission: 'view_sms',        section: 'staff', feature: 'sms' },
  { id: 'purchases',    label: 'Purchases',   href: ROUTES.staff.purchases,    permission: 'view_purchases',  section: 'staff' },
  { id: 'hours',        label: 'Workstuff',   href: ROUTES.staff.worktracking, permission: 'view_hours',      section: 'staff', feature: 'associates' },
  { id: 'payments',     label: 'Payments',    href: ROUTES.staff.payments,     permission: 'view_hours',      section: 'staff', feature: 'associates' },
  { id: 'faq',          label: 'FAQ/AI',      href: ROUTES.staff.faq,          permission: 'view_faq',        section: 'staff', feature: 'pai' },
  { id: 'voice',        label: 'Concierge',   href: ROUTES.staff.voice,        permission: 'view_voice',      section: 'staff', feature: 'voice' },
  { id: 'todo',         label: 'Todo',        href: ROUTES.devcontrol.home + '#planlist', permission: 'view_todo', section: 'staff' },
  { id: 'phyprop',      label: 'PhyProp',     href: ROUTES.staff.phyprop,      permission: 'view_spaces',     section: 'staff' },
  { id: 'inventory',    label: 'Inventory',   href: ROUTES.staff.inventory,    permission: 'view_inventory',  section: 'staff' },
  { id: 'appdev',       label: 'App Dev',     href: ROUTES.staff.appdev,       permission: 'view_appdev',     section: 'staff' },
  // Admin section
  { id: 'users',         label: 'Users',         href: ROUTES.admin.users,         permission: 'view_users',         section: 'admin' },
  { id: 'passwords',     label: 'Passwords',     href: ROUTES.admin.passwords,     permission: 'view_passwords',     section: 'admin' },
  { id: 'settings',      label: 'Settings',      href: ROUTES.admin.settings,      permission: 'view_settings',      section: 'admin' },
  { id: 'releases',      label: 'Releases',      href: ROUTES.admin.releases,      permission: 'view_settings',      section: 'admin' },
  { id: 'signatures',    label: 'Signatures',    href: ROUTES.admin.signatures,    permission: 'view_rentals',       section: 'admin' },
  { id: 'templates',     label: 'Templates',     href: ROUTES.admin.templates,     permission: 'view_templates',     section: 'admin', feature: 'documents' },
  { id: 'brand',         label: 'Brand',         href: ROUTES.admin.brand,         permission: 'view_settings',      section: 'admin' },
  { id: 'accounting',    label: 'Accounting',    href: ROUTES.admin.accounting,    permission: 'view_accounting',    section: 'admin' },
  { id: 'notifications', label: 'Notifications', href: ROUTES.admin.notifications, permission: 'view_settings',      section: 'admin' },
  { id: 'testdev',       label: 'Test Dev',      href: ROUTES.admin.testdev,       permission: 'view_settings',      section: 'admin' },
  { id: 'testsuite',     label: 'Test Suite',    href: ROUTES.admin.testSuite,     permission: 'view_settings',      section: 'admin' },
  { id: 'lifeofpai',     label: 'Life of PAI',   href: ROUTES.residents.lifeOfPaiAdmin, permission: 'admin_pai_settings', section: 'admin', feature: 'pai' },
  { id: 'openclaw',      label: 'AlpaClaw',      href: ROUTES.admin.alpaclaw,      permission: 'view_openclaw',      section: 'admin', feature: 'pai' },
  // DevControl is a top-level nav item (in context switcher), not an admin sub-tab — but listed here for permission sync
  { id: 'devcontrol',    label: 'DevControl',    href: ROUTES.devcontrol.home,     permission: 'view_devcontrol',    section: 'admin' },
];
