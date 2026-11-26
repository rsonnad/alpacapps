import assert from 'node:assert/strict';
import test from 'node:test';
import { nextAutomaticPayment, reimbursementStatusLabel } from './reimbursement-timing.js';

const ready = { is_active: true, payment_method: 'stripe', stripe_connect_account_id: 'acct_1',
  identity_verification_status: 'verified', w9_status: 'submitted' };
const instant = { ...ready, instant_payout: true };
const daily = { ...ready, instant_payout: false, payout_frequency: 'daily' };
const claim = (created, emailed = created) => ({
  status: 'pending', automatic_payment: true, payment_held: false,
  created_at: created, review_email_sent_at: emailed
});
const iso = date => date?.toISOString();

test('Amber\'s claim (instant payout) pays at the 8pm Central run the next evening', () => {
  const request = claim('2026-11-25T00:52:00Z', '2026-11-25T00:53:00Z');
  const now = Date.parse('2026-11-25T01:00:00Z');
  assert.equal(iso(nextAutomaticPayment(request, instant, now)), '2026-11-26T02:00:00.000Z');
  assert.equal(reimbursementStatusLabel(request, instant, now), 'Pays automatically on Wed, Nov 25 unless an admin holds it');
});

test('daily associates are paid by the nightly 02:30 UTC run', () => {
  const request = claim('2026-11-25T00:52:00Z');
  assert.equal(iso(nextAutomaticPayment(request, daily, Date.parse('2026-11-25T01:00:00Z'))), '2026-11-26T02:30:00.000Z');
});

test('a claim due just after 8pm rolls to the nightly run, then to the next evening', () => {
  const now = Date.parse('2026-11-25T03:00:00Z');
  assert.equal(iso(nextAutomaticPayment(claim('2026-11-25T02:05:00Z'), instant, now)), '2026-11-26T02:30:00.000Z');
  assert.equal(iso(nextAutomaticPayment(claim('2026-11-25T02:35:00Z'), instant, now)), '2026-11-27T02:00:00.000Z');
});

test('weekly associates wait for their payout day (Saturday by default)', () => {
  const now = Date.parse('2026-11-25T01:00:00Z');
  const weekly = { ...ready, payout_frequency: 'weekly' };
  assert.equal(iso(nextAutomaticPayment(claim('2026-11-25T00:52:00Z'), weekly, now)), '2026-11-29T02:30:00.000Z');
  assert.equal(iso(nextAutomaticPayment(claim('2026-11-25T00:52:00Z'), { ...weekly, payout_day_of_week: 1 }, now)),
    '2026-12-01T02:30:00.000Z');
});

test('8pm Central is 01:00 UTC during daylight saving time', () => {
  const request = claim('2026-07-01T00:00:00Z');
  assert.equal(iso(nextAutomaticPayment(request, instant, Date.parse('2026-07-01T00:05:00Z'))), '2026-07-02T01:00:00.000Z');
});

test('an overdue claim shows the next run, not a past date', () => {
  const request = claim('2026-11-20T00:00:00Z');
  assert.equal(iso(nextAutomaticPayment(request, instant, Date.parse('2026-11-25T03:00:00Z'))), '2026-11-26T02:00:00.000Z');
});

test('status labels', () => {
  const request = claim('2026-11-25T00:52:00Z');
  assert.equal(reimbursementStatusLabel({ ...request, automatic_payment: false }, instant), 'Pending review');
  assert.equal(reimbursementStatusLabel({ ...request, payment_held: true }, instant), 'Payment on hold');
  assert.equal(reimbursementStatusLabel({ ...request, transfer_started_at: '2026-11-26T02:00:00Z' }, instant), 'Payment in progress');
  assert.equal(reimbursementStatusLabel({ ...request, review_email_sent_at: null }, instant), 'Pays automatically unless an admin holds it');
  assert.equal(reimbursementStatusLabel(request, { ...instant, w9_status: null }),
    'Pays automatically once Stripe payout setup is complete, unless an admin holds it');
  assert.equal(reimbursementStatusLabel({ ...request, status: 'paid' }, instant), 'Paid');
  assert.equal(reimbursementStatusLabel({ ...request, status: 'declined' }, instant), 'Declined');
});
