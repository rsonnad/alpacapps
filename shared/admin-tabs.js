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
  { id: 'spaces',       label: 'Spaces',      href: ROUTES.staff.spaces,       permission: 'view_spaces',     section: 'staff', description: 'Browse and manage rentable rooms, dwellings, and event spaces.' },
  { id: 'rentals',      label: 'Rentals',     href: ROUTES.staff.rentals,      permission: 'view_rentals',    section: 'staff', feature: 'rentals', description: 'Active leases, tenant info, and rental agreements.' },
  { id: 'reservations', label: 'Reservations', href: ROUTES.staff.reservations, permission: 'view_rentals',   section: 'staff', feature: 'rentals', description: 'Upcoming bookings and short-term stay reservations.' },
  { id: 'events',       label: 'Events',      href: ROUTES.staff.events,       permission: 'view_events',     section: 'staff', feature: 'events', description: 'Scheduled events, agreements, and event-space bookings.' },
  { id: 'media',        label: 'Media',       href: ROUTES.staff.media,        permission: 'view_media',      section: 'staff', description: 'Photo and video library across all spaces.' },
  { id: 'sms',          label: 'SMS',         href: ROUTES.staff.sms,          permission: 'view_sms',        section: 'staff', feature: 'sms', description: 'Outbound and inbound text-message threads with residents and guests.' },
  { id: 'purchases',    label: 'Purchases',   href: ROUTES.staff.purchases,    permission: 'view_purchases',  section: 'staff', description: 'Receipts, vendor bills, and reimbursable purchases.' },
  { id: 'hours',        label: 'Workstuff',   href: ROUTES.staff.worktracking, permission: 'view_hours',      section: 'staff', feature: 'associates', description: 'Associate time clock, schedules, and work photo log.' },
  { id: 'payments',     label: 'Payments',    href: ROUTES.staff.payments,     permission: 'view_hours',      section: 'staff', feature: 'associates', description: 'Associate payouts, invoices, and payment history.' },
  { id: 'faq',          label: 'FAQ/AI',      href: ROUTES.staff.faq,          permission: 'view_faq',        section: 'staff', feature: 'pai', description: 'AI knowledge base, FAQ entries, and PAI training data.' },
  { id: 'voice',        label: 'Concierge',   href: ROUTES.staff.voice,        permission: 'view_voice',      section: 'staff', feature: 'voice', description: 'Voice concierge call logs and AI phone responses.' },
  { id: 'todo',         label: 'Todo',        href: ROUTES.devcontrol.home + '#planlist', permission: 'view_todo', section: 'staff', description: 'Shared plan list — what we are working on and what is next.' },
  { id: 'phyprop',      label: 'PhyProp',     href: ROUTES.staff.phyprop,      permission: 'view_spaces',     section: 'staff', description: 'Physical property: buildings, lots, and on-site assets.' },
  { id: 'inventory',    label: 'Inventory',   href: ROUTES.staff.inventory,    permission: 'view_inventory',  section: 'staff', description: 'Supplies, tools, and stock counts across the property.' },
  { id: 'appdev',       label: 'App Dev',     href: ROUTES.staff.appdev,       permission: 'view_appdev',     section: 'staff', description: 'Feature flags, app builds, and developer-facing controls.' },
  // Admin section
  { id: 'users',         label: 'Users',         href: ROUTES.admin.users,         permission: 'view_users',         section: 'admin', description: 'All people in the system — roles, contact info, account status.' },
  { id: 'passwords',     label: 'Passwords',     href: ROUTES.admin.passwords,     permission: 'view_passwords',     section: 'admin', description: 'Shared credentials and password reset tools.' },
  { id: 'settings',      label: 'Settings',      href: ROUTES.admin.settings,      permission: 'view_settings',      section: 'admin', description: 'Site-wide configuration and admin preferences.' },
  { id: 'releases',      label: 'Releases',      href: ROUTES.admin.releases,      permission: 'view_settings',      section: 'admin', description: 'Recent app deployments and version history.' },
  { id: 'applications',  label: 'Rental Apps',   href: ROUTES.admin.applications,  permission: 'view_rentals',       section: 'admin', description: 'Triage rental applications: notes, request more info, decline, approve.' },
  { id: 'signatures',    label: 'Signatures',    href: ROUTES.admin.signatures,    permission: 'view_rentals',       section: 'admin', description: 'E-signature requests and signed-document audit.' },
  { id: 'templates',     label: 'Templates',     href: ROUTES.admin.templates,     permission: 'view_templates',     section: 'admin', feature: 'documents', description: 'Editable templates for emails, leases, and event agreements.' },
  { id: 'brand',         label: 'Brand',         href: ROUTES.admin.brand,         permission: 'view_settings',      section: 'admin', description: 'Brand tokens, logos, and visual identity controls.' },
  { id: 'accounting',    label: 'Accounting',    href: ROUTES.admin.accounting,    permission: 'view_accounting',    section: 'admin', description: 'Ledger, payouts, and financial reporting.' },
  { id: 'aiCosts',       label: 'AI Costs',      href: ROUTES.admin.aiCosts,       permission: 'view_accounting',    section: 'admin', description: 'Gemini API token usage and estimated spend by model and project.' },
  { id: 'notifications', label: 'Notifications', href: ROUTES.admin.notifications, permission: 'view_settings',      section: 'admin', description: 'System notifications, alerts, and delivery channels.' },
  { id: 'testdev',       label: 'Test Dev',      href: ROUTES.admin.testdev,       permission: 'view_settings',      section: 'admin', description: 'Developer testing scratchpad.' },
  { id: 'testsuite',     label: 'Test Suite',    href: ROUTES.admin.testSuite,     permission: 'view_settings',      section: 'admin', description: 'Automated test suite results and runs.' },
  { id: 'lifeofpai',     label: 'Life of PAI',   href: ROUTES.residents.lifeOfPaiAdmin, permission: 'admin_pai_settings', section: 'admin', feature: 'pai', description: 'PAI assistant settings, memory, and lifecycle.' },
  { id: 'openclaw',      label: 'AlpaClaw',      href: ROUTES.admin.alpaclaw,      permission: 'view_openclaw',      section: 'admin', feature: 'pai', description: 'AlpaClaw agent controls and run history.' },
  // DevControl is a top-level nav item (in context switcher), not an admin sub-tab — but listed here for permission sync
  { id: 'devcontrol',    label: 'DevControl',    href: ROUTES.devcontrol.home,     permission: 'view_devcontrol',    section: 'admin', description: 'Engineering control panel: schema, todos, deploys, and infra.' },
];
