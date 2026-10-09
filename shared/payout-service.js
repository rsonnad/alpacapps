/**
 * Payout Service
 *
 * Unified outbound payment service for paying workers/associates.
 * Supports Stripe Connect ACH (preferred) and PayPal Payouts.
 * Follows the same pattern as sms-service.js and email-service.js.
 */

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';

const PAYPAL_PAYOUT_URL = `${SUPABASE_URL}/functions/v1/paypal-payout`;
const STRIPE_PAYOUT_URL = `${SUPABASE_URL}/functions/v1/stripe-payout`;
const STRIPE_CONNECT_ONBOARD_URL = `${SUPABASE_URL}/functions/v1/stripe-connect-onboard`;

// ---- Stripe Payouts ----

/**
 * Send a Stripe ACH payout to an associate via Connect Transfer
 * @param {string} associateId - associate_profiles.id
 * @param {number} amount - Amount in dollars (e.g., 150.00)
 * @param {string[]} [timeEntryIds] - Array of time_entries.id being paid for
 * @param {string} [notes] - Optional payment note
 * @returns {Promise<{success: boolean, payout_id?: string, ledger_id?: string, transfer_id?: string, message?: string, error?: string}>}
 */
async function sendStripePayout(associateId, amount, timeEntryIds = [], notes = '') {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const response = await fetch(STRIPE_PAYOUT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        associate_id: associateId,
        amount,
        time_entry_ids: timeEntryIds,
        notes,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || `Stripe payout failed (${response.status})`,
      };
    }

    return {
      success: true,
      payout_id: data.payout_id,
      ledger_id: data.ledger_id,
      transfer_id: data.transfer_id,
      test_mode: data.test_mode || false,
      message: data.message,
      amount: data.amount,
      entries_marked_paid: data.entries_marked_paid === true,
    };
  } catch (error) {
    console.error('Stripe payout error:', error);
    return {
      success: false,
      error: error.message || 'Failed to send Stripe payout',
    };
  }
}

// ---- Stripe Connect Onboarding ----

/**
 * Create a Stripe Connect Express account for an associate
 * @param {string} associateId - associate_profiles.id
 * @returns {Promise<{success: boolean, account_id?: string, message?: string, error?: string}>}
 */
async function createStripeConnectAccount(associateId) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const response = await fetch(STRIPE_CONNECT_ONBOARD_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        action: 'create_account',
        associate_id: associateId,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, error: data.error || 'Failed to create Connect account' };
    }

    return {
      success: true,
      account_id: data.account_id,
      already_existed: data.already_existed || false,
      message: data.message,
    };
  } catch (error) {
    console.error('Stripe Connect account creation error:', error);
    return { success: false, error: error.message || 'Failed to create Connect account' };
  }
}

/**
 * Get a Stripe Connect onboarding link for an associate
 * @param {string} associateId - associate_profiles.id
 * @returns {Promise<{success: boolean, url?: string, message?: string, error?: string}>}
 */
async function getStripeConnectLink(associateId) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const response = await fetch(STRIPE_CONNECT_ONBOARD_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        action: 'create_account_link',
        associate_id: associateId,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, error: data.error || 'Failed to generate onboarding link' };
    }

    return {
      success: true,
      url: data.url,
      message: data.message,
    };
  } catch (error) {
    console.error('Stripe Connect link error:', error);
    return { success: false, error: error.message || 'Failed to generate onboarding link' };
  }
}

// ---- PayPal Payouts ----

/**
 * Send a PayPal payout to an associate
 * @param {string} associateId - associate_profiles.id
 * @param {number} amount - Amount in dollars (e.g., 150.00)
 * @param {string[]} [timeEntryIds] - Array of time_entries.id being paid for
 * @param {string} [notes] - Optional payment note
 * @param {string} [paymentHandle] - Override PayPal email (otherwise uses associate's configured email)
 * @returns {Promise<{success: boolean, payout_id?: string, ledger_id?: string, message?: string, error?: string}>}
 */
async function sendPayPalPayout(associateId, amount, timeEntryIds = [], notes = '', paymentHandle = null) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const response = await fetch(PAYPAL_PAYOUT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        associate_id: associateId,
        amount,
        time_entry_ids: timeEntryIds,
        notes,
        ...(paymentHandle ? { payment_handle: paymentHandle } : {}),
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || `Payout failed (${response.status})`,
      };
    }

    return {
      success: true,
      payout_id: data.payout_id,
      ledger_id: data.ledger_id,
      batch_id: data.batch_id,
      test_mode: data.test_mode || false,
      message: data.message,
      amount: data.amount,
      entries_marked_paid: data.entries_marked_paid === true,
    };
  } catch (error) {
    console.error('PayPal payout error:', error);
    return {
      success: false,
      error: error.message || 'Failed to send PayPal payout',
    };
  }
}

// ---- Payout History & Status ----

/**
 * Get payout status by ID
 */
async function getPayoutStatus(payoutId) {
  const { data, error } = await supabase
    .from('payouts')
    .select('*')
    .eq('id', payoutId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get all payouts for an associate
 */
async function getPayoutsForAssociate(associateId, { limit = 50, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('payouts')
    .select('*')
    .eq('associate_id', associateId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return data || [];
}

/**
 * Get all payouts within a date range
 */
async function getPayoutsForPeriod(dateFrom, dateTo, { paymentMethod = null } = {}) {
  let query = supabase
    .from('payouts')
    .select('*')
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo)
    .order('created_at', { ascending: false });

  if (paymentMethod) {
    query = query.eq('payment_method', paymentMethod);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Get payout summary stats for a period
 */
async function getPayoutSummary(dateFrom, dateTo) {
  const payouts = await getPayoutsForPeriod(dateFrom, dateTo);

  const summary = {
    total: 0,
    completed: 0,
    failed: 0,
    pending: 0,
    totalAmount: 0,
    completedAmount: 0,
    byMethod: {},
  };

  for (const payout of payouts) {
    summary.total++;
    const amount = parseFloat(payout.amount) || 0;
    summary.totalAmount += amount;

    if (payout.status === 'completed') {
      summary.completed++;
      summary.completedAmount += amount;
    } else if (payout.status === 'failed' || payout.status === 'returned') {
      summary.failed++;
    } else {
      summary.pending++;
    }

    if (!summary.byMethod[payout.payment_method]) {
      summary.byMethod[payout.payment_method] = { count: 0, amount: 0 };
    }
    summary.byMethod[payout.payment_method].count++;
    summary.byMethod[payout.payment_method].amount += amount;
  }

  return summary;
}

// ---- Config ----

// Non-secret columns only. Secret columns (client_secret, secret_key, webhook
// secrets, etc.) are hidden from anon/authenticated by column grants and are
// set server-side via SQL by the operator, never from the browser.
const PAYPAL_CONFIG_COLUMNS = 'id, client_id, sandbox_client_id, is_active, test_mode, last_error, created_at, updated_at';
const STRIPE_CONFIG_COLUMNS = 'id, publishable_key, sandbox_publishable_key, connect_enabled, is_active, test_mode, created_at, updated_at';

/**
 * Get PayPal config (for settings page) — non-secret columns only
 */
async function getPayPalConfig() {
  const { data, error } = await supabase
    .from('paypal_config')
    .select(PAYPAL_CONFIG_COLUMNS)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update PayPal config (non-secret columns only)
 */
async function updatePayPalConfig(updates) {
  const { data, error } = await supabase
    .from('paypal_config')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select(PAYPAL_CONFIG_COLUMNS)
    .single();

  if (error) throw error;
  return data;
}

/**
 * PayPal connection test. The client secret is server-side only, so the
 * browser can no longer authenticate against PayPal directly.
 */
async function testPayPalConnection() {
  return { success: false, unavailable: true, error: 'Connection check unavailable from browser (secrets are stored server-side)' };
}

/**
 * Get Stripe config (for settings page) — non-secret columns only
 */
async function getStripeConfig() {
  const { data, error } = await supabase
    .from('stripe_config')
    .select(STRIPE_CONFIG_COLUMNS)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update Stripe config (non-secret columns only)
 */
async function updateStripeConfig(updates) {
  const { data, error } = await supabase
    .from('stripe_config')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select(STRIPE_CONFIG_COLUMNS)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Stripe connection / balance test. The secret key is server-side only, so
 * the browser can no longer call api.stripe.com directly.
 */
async function testStripeConnection() {
  return { success: false, unavailable: true, error: 'Balance check unavailable from browser (secrets are stored server-side)' };
}

// ---- Export ----

export const payoutService = {
  // Stripe (preferred)
  sendStripePayout,
  testStripeConnection,
  createStripeConnectAccount,
  getStripeConnectLink,

  // PayPal
  sendPayPalPayout,
  testPayPalConnection,

  // Config
  getPayPalConfig,
  updatePayPalConfig,
  getStripeConfig,
  updateStripeConfig,

  // History
  getPayoutStatus,
  getPayoutsForAssociate,
  getPayoutsForPeriod,
  getPayoutSummary,
};
