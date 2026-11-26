// When an automatic associate reimbursement will be paid, mirroring
// claim_reimbursement_transfer and associate-reimbursement-worker:
// - a claim is due 24 hours after both created_at and review_email_sent_at;
// - the regular run fires at 02:30 UTC (Chicago evening) and pays daily-cadence
//   associates, instant-payout associates, and weekly associates on their
//   payout_day_of_week (Saturday by default);
// - the instant run fires at 8pm America/Chicago for instant-payout associates.
// No imports, so `node --test` can load it.

const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_ZONE = 'America/Chicago';

const chicagoParts = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23', weekday: 'short'
});
const payDateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric'
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parts(time) {
  const out = {};
  for (const { type, value } of chicagoParts.formatToParts(new Date(time))) out[type] = value;
  return { year: +out.year, month: +out.month, day: +out.day, hour: +out.hour, weekday: WEEKDAYS.indexOf(out.weekday) };
}

export function stripePayoutReady(profile) {
  return Boolean(profile?.is_active && profile.payment_method === 'stripe' && profile.stripe_connect_account_id
    && profile.identity_verification_status === 'verified' && profile.w9_status === 'submitted');
}

// The first payroll run at or after both the 24-hour wait and `now`, or null.
export function nextAutomaticPayment(request, profile, now = Date.now()) {
  if (!request.review_email_sent_at) return null;
  const earliest = Math.max(
    Date.parse(request.created_at) + DAY_MS,
    Date.parse(request.review_email_sent_at) + DAY_MS,
    request.transfer_retry_after ? Date.parse(request.transfer_retry_after) : 0,
    now
  );
  if (!Number.isFinite(earliest)) return null;

  const instant = Boolean(profile.instant_payout);
  const daily = String(profile.payout_frequency ?? 'daily').toLowerCase() === 'daily';
  const payoutDay = profile.payout_day_of_week ?? 6;
  const start = parts(earliest);

  for (let offset = 0; offset < 15; offset++) {
    // Chicago evening of calendar day D is early UTC on day D + 1.
    const next = (hour, minute) => Date.UTC(start.year, start.month - 1, start.day + offset + 1, hour, minute);
    const runs = [];
    if (instant) runs.push([next(1, 0), next(2, 0)].find(time => parts(time).hour === 20));
    const regular = next(2, 30);
    if (instant || daily || parts(regular).weekday === payoutDay) runs.push(regular);
    const run = runs.filter(time => time >= earliest).sort((a, b) => a - b)[0];
    if (run) return new Date(run);
  }
  return null;
}

export function reimbursementStatusLabel(request, profile, now = Date.now()) {
  if (request.status === 'paid') return 'Paid';
  if (request.status === 'declined') return 'Declined';
  if (request.payment_held) return 'Payment on hold';
  if (!request.automatic_payment) return 'Pending review';
  if (request.transfer_started_at) return 'Payment in progress';

  const hold = ' unless an admin holds it';
  if (profile && !stripePayoutReady(profile)) return 'Pays automatically once Stripe payout setup is complete,' + hold;
  const payDate = profile && nextAutomaticPayment(request, profile, now);
  return payDate ? 'Pays automatically on ' + payDateFormat.format(payDate) + hold : 'Pays automatically' + hold;
}
