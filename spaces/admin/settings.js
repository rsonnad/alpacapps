/**
 * Settings - Payment Methods, Fee Settings, SMS Configuration
 */

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';

// =============================================
// STATE
// =============================================

let authState = null;
let allPaymentMethods = [];
let bulkSmsRecipients = [];
let editingFeeCodeId = null;
let editingPaymentMethodId = null;
let editingForwardingRuleId = null;
let allForwardingRules = [];

const SEND_SMS_URL = `${SUPABASE_URL}/functions/v1/send-sms`;

const FEE_TYPE_LABELS = {
  'rental_application': 'Rental Application Fee',
  'event_rental_fee': 'Event Rental Fee',
  'event_cleaning_deposit': 'Event Cleaning Deposit',
  'event_reservation_deposit': 'Event Reservation Deposit'
};

// =============================================
// INITIALIZATION
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize auth and admin page
  authState = await initAdminPage({
    activeTab: 'settings',
    requiredRole: 'admin', // Settings require admin access
    onReady: async (state) => {
      // Load settings data
      await loadSettingsPanel();

      // Set up event listeners
      setupEventListeners();
    }
  });
});

// =============================================
// DATA LOADING
// =============================================

async function loadSettingsPanel() {
  await Promise.all([
    loadPaymentMethods(),
    loadFeeSettings(),
    loadFeeCodes(),
    loadSquareConfig(),
    loadTelnyxConfig(),
    loadInboundSms(),
    loadForwardingRules()
  ]);
}

// =============================================
// PAYMENT METHODS
// =============================================

async function loadPaymentMethods() {
  const container = document.getElementById('paymentMethodsList');
  if (!container) return;

  try {
    const { data, error } = await supabase
      .from('payment_methods')
      .select('*')
      .order('display_order', { ascending: true });

    if (error) throw error;
    allPaymentMethods = data || [];

    if (allPaymentMethods.length === 0) {
      container.innerHTML = '<p class="text-muted">No payment methods configured.</p>';
      return;
    }

    container.innerHTML = allPaymentMethods.map(pm => `
      <div class="payment-method-card ${pm.is_active ? '' : 'inactive'}" data-id="${pm.id}">
        <div class="payment-method-info">
          <h4>${pm.name}</h4>
          <p class="text-muted">${pm.instructions || 'No instructions'}</p>
        </div>
        <div class="payment-method-actions">
          ${pm.is_active ? '<span class="status-badge active">Active</span>' : '<span class="status-badge inactive">Inactive</span>'}
          <button class="btn-small" data-action="edit-payment-method" data-id="${pm.id}">Edit</button>
        </div>
      </div>
    `).join('');

    // Add click handlers
    container.querySelectorAll('[data-action="edit-payment-method"]').forEach(btn => {
      btn.addEventListener('click', () => openPaymentMethodModal(btn.dataset.id));
    });
  } catch (error) {
    console.error('Error loading payment methods:', error);
    container.innerHTML = '<p class="text-muted" style="color: red;">Error loading payment methods.</p>';
  }
}

function openPaymentMethodModal(methodId = null) {
  editingPaymentMethodId = methodId;
  const modal = document.getElementById('paymentMethodModal');
  const form = document.getElementById('paymentMethodForm');
  const title = document.getElementById('paymentMethodModalTitle');
  const deleteBtn = document.getElementById('deletePaymentMethodBtn');

  if (methodId) {
    title.textContent = 'Edit Payment Method';
    deleteBtn.style.display = 'block';
    const method = allPaymentMethods.find(m => m.id === methodId);
    if (method) {
      document.getElementById('paymentMethodId').value = method.id;
      document.getElementById('paymentMethodName').value = method.name;
      document.getElementById('paymentMethodInstructions').value = method.instructions || '';
      document.getElementById('paymentMethodActive').checked = method.is_active;
    }
  } else {
    title.textContent = 'Add Payment Method';
    deleteBtn.style.display = 'none';
    form.reset();
    document.getElementById('paymentMethodId').value = '';
    document.getElementById('paymentMethodActive').checked = true;
  }

  modal.classList.remove('hidden');
}

function closePaymentMethodModal() {
  document.getElementById('paymentMethodModal').classList.add('hidden');
  editingPaymentMethodId = null;
}

async function savePaymentMethod() {
  const methodId = document.getElementById('paymentMethodId').value;
  const data = {
    name: document.getElementById('paymentMethodName').value.trim(),
    instructions: document.getElementById('paymentMethodInstructions').value.trim() || null,
    is_active: document.getElementById('paymentMethodActive').checked,
    updated_at: new Date().toISOString()
  };

  if (!data.name) {
    showToast('Please enter a name', 'warning');
    return;
  }

  try {
    if (methodId) {
      const { error } = await supabase
        .from('payment_methods')
        .update(data)
        .eq('id', methodId);
      if (error) throw error;
      showToast('Payment method updated', 'success');
    } else {
      data.display_order = allPaymentMethods.length;
      const { error } = await supabase
        .from('payment_methods')
        .insert(data);
      if (error) throw error;
      showToast('Payment method created', 'success');
    }

    closePaymentMethodModal();
    await loadPaymentMethods();
  } catch (error) {
    console.error('Error saving payment method:', error);
    showToast('Failed to save payment method', 'error');
  }
}

async function deletePaymentMethod() {
  if (!editingPaymentMethodId) return;
  if (!confirm('Delete this payment method?')) return;

  try {
    const { error } = await supabase
      .from('payment_methods')
      .delete()
      .eq('id', editingPaymentMethodId);

    if (error) throw error;

    showToast('Payment method deleted', 'success');
    closePaymentMethodModal();
    await loadPaymentMethods();
  } catch (error) {
    console.error('Error deleting payment method:', error);
    showToast('Failed to delete payment method', 'error');
  }
}

// =============================================
// FEE SETTINGS
// =============================================

async function loadFeeSettings() {
  const grid = document.getElementById('feeSettingsGrid');
  if (!grid) return;

  try {
    const { data: settings, error } = await supabase
      .from('fee_settings')
      .select('*')
      .eq('is_active', true)
      .order('fee_type');

    if (error) throw error;

    if (!settings || settings.length === 0) {
      grid.innerHTML = '<p class="text-muted">No fee settings configured.</p>';
      return;
    }

    grid.innerHTML = settings.map(setting => `
      <div class="fee-setting-card" data-fee-type="${setting.fee_type}">
        <div class="fee-setting-info">
          <h4>${FEE_TYPE_LABELS[setting.fee_type] || setting.fee_type}</h4>
          <p>${setting.description || ''}</p>
        </div>
        <div class="fee-setting-amount">
          <span>$</span>
          <input type="number"
                 min="0"
                 step="0.01"
                 value="${setting.default_amount}"
                 data-fee-id="${setting.id}"
                 class="fee-amount-input">
        </div>
      </div>
    `).join('');

    // Add change listeners
    grid.querySelectorAll('.fee-amount-input').forEach(input => {
      input.addEventListener('change', handleFeeAmountChange);
    });

  } catch (error) {
    console.error('Error loading fee settings:', error);
    grid.innerHTML = '<p class="text-muted">Error loading fee settings.</p>';
  }
}

async function handleFeeAmountChange(e) {
  const input = e.target;
  const feeId = input.dataset.feeId;
  const newAmount = parseFloat(input.value) || 0;

  try {
    const { error } = await supabase
      .from('fee_settings')
      .update({
        default_amount: newAmount,
        updated_at: new Date().toISOString()
      })
      .eq('id', feeId);

    if (error) throw error;
    showToast('Fee amount updated', 'success');
  } catch (error) {
    console.error('Error updating fee:', error);
    showToast('Failed to update fee amount', 'error');
  }
}

// =============================================
// FEE CODES
// =============================================

async function loadFeeCodes() {
  const grid = document.getElementById('feeCodesGrid');
  if (!grid) return;

  try {
    const { data: codes, error } = await supabase
      .from('fee_codes')
      .select('*')
      .order('fee_type')
      .order('code');

    if (error) throw error;

    if (!codes || codes.length === 0) {
      grid.innerHTML = '<div class="fee-codes-empty">No fee codes configured. Click "Add Code" to create one.</div>';
      return;
    }

    grid.innerHTML = `<div class="fee-codes-header"><span>Code</span><span>Fee Type</span><span>Price</span><span>Description</span><span>Usage</span><span></span></div>` + codes.map(code => {
      const usageText = code.usage_limit
        ? `${code.times_used}/${code.usage_limit}`
        : `${code.times_used}`;
      const expiredClass = code.expires_at && new Date(code.expires_at) < new Date() ? 'expired' : '';
      const inactiveClass = !code.is_active ? 'inactive' : '';

      return `
        <div class="fee-code-row ${expiredClass} ${inactiveClass}">
          <span class="code-name">${code.code}</span>
          <span class="code-type">${FEE_TYPE_LABELS[code.fee_type] || code.fee_type}</span>
          <span class="code-price ${code.price === 0 ? 'free' : ''}">
            ${code.price === 0 ? 'FREE' : '$' + code.price.toFixed(2)}
          </span>
          ${code.description ? `<span class="code-desc">${code.description}</span>` : '<span class="code-desc"></span>'}
          <span class="code-usage">${usageText} used</span>
          <span class="code-actions">
            <button class="btn-small btn-secondary" data-action="edit-fee-code" data-id="${code.id}">Edit</button>
            <button class="btn-small btn-danger" data-action="delete-fee-code" data-id="${code.id}" data-code="${code.code}">Delete</button>
          </span>
        </div>
      `;
    }).join('');

    // Add click handlers
    grid.querySelectorAll('[data-action="edit-fee-code"]').forEach(btn => {
      btn.addEventListener('click', () => openFeeCodeModal(btn.dataset.id));
    });
    grid.querySelectorAll('[data-action="delete-fee-code"]').forEach(btn => {
      btn.addEventListener('click', () => deleteFeeCode(btn.dataset.id, btn.dataset.code));
    });

  } catch (error) {
    console.error('Error loading fee codes:', error);
    grid.innerHTML = '<div class="fee-codes-empty">Error loading fee codes.</div>';
  }
}

function openFeeCodeModal(codeId = null) {
  editingFeeCodeId = codeId;
  const modal = document.getElementById('feeCodeModal');
  const form = document.getElementById('feeCodeForm');
  const title = document.getElementById('feeCodeModalTitle');

  if (codeId) {
    title.textContent = 'Edit Fee Code';
    loadFeeCodeForEdit(codeId);
  } else {
    title.textContent = 'Add Fee Code';
    form.reset();
    document.getElementById('feeCodeId').value = '';
    document.getElementById('feeCodeActive').checked = true;
  }

  modal.classList.remove('hidden');
}

async function loadFeeCodeForEdit(codeId) {
  try {
    const { data: code, error } = await supabase
      .from('fee_codes')
      .select('*')
      .eq('id', codeId)
      .single();

    if (error) throw error;

    document.getElementById('feeCodeId').value = code.id;
    document.getElementById('feeCodeCode').value = code.code;
    document.getElementById('feeCodeType').value = code.fee_type;
    document.getElementById('feeCodePrice').value = code.price;
    document.getElementById('feeCodeDescription').value = code.description || '';
    document.getElementById('feeCodeUsageLimit').value = code.usage_limit || '';
    document.getElementById('feeCodeExpires').value = code.expires_at ? code.expires_at.split('T')[0] : '';
    document.getElementById('feeCodeActive').checked = code.is_active;

  } catch (error) {
    console.error('Error loading fee code:', error);
    showToast('Failed to load fee code', 'error');
  }
}

function closeFeeCodeModal() {
  document.getElementById('feeCodeModal').classList.add('hidden');
  editingFeeCodeId = null;
}

async function saveFeeCode() {
  const codeId = document.getElementById('feeCodeId').value;
  const codeData = {
    code: document.getElementById('feeCodeCode').value.toUpperCase().trim(),
    fee_type: document.getElementById('feeCodeType').value,
    price: parseFloat(document.getElementById('feeCodePrice').value) || 0,
    description: document.getElementById('feeCodeDescription').value.trim() || null,
    usage_limit: parseInt(document.getElementById('feeCodeUsageLimit').value) || null,
    expires_at: document.getElementById('feeCodeExpires').value || null,
    is_active: document.getElementById('feeCodeActive').checked,
    updated_at: new Date().toISOString()
  };

  try {
    if (codeId) {
      const { error } = await supabase
        .from('fee_codes')
        .update(codeData)
        .eq('id', codeId);
      if (error) throw error;
      showToast('Fee code updated', 'success');
    } else {
      const { error } = await supabase
        .from('fee_codes')
        .insert(codeData);
      if (error) throw error;
      showToast('Fee code created', 'success');
    }

    closeFeeCodeModal();
    await loadFeeCodes();

  } catch (error) {
    console.error('Error saving fee code:', error);
    if (error.message?.includes('duplicate')) {
      showToast('This code already exists for this fee type', 'error');
    } else {
      showToast('Failed to save fee code', 'error');
    }
  }
}

async function deleteFeeCode(codeId, codeName) {
  if (!confirm(`Delete code "${codeName}"? This cannot be undone.`)) return;

  try {
    const { error } = await supabase
      .from('fee_codes')
      .delete()
      .eq('id', codeId);

    if (error) throw error;
    showToast('Fee code deleted', 'success');
    await loadFeeCodes();
  } catch (error) {
    console.error('Error deleting fee code:', error);
    showToast('Failed to delete fee code', 'error');
  }
}

// =============================================
// SQUARE CONFIG
// =============================================

async function loadSquareConfig() {
  try {
    const { data: config, error } = await supabase
      .from('square_config')
      .select('test_mode')
      .single();

    if (error) throw error;

    const checkbox = document.getElementById('squareTestMode');
    const badge = document.getElementById('squareModeBadge');

    if (checkbox) checkbox.checked = config.test_mode;
    if (badge) {
      badge.textContent = config.test_mode ? 'Test Mode' : 'Live';
      badge.classList.toggle('live', !config.test_mode);
    }

  } catch (error) {
    console.error('Error loading Square config:', error);
  }
}

async function toggleSquareTestMode(testMode) {
  try {
    const { error } = await supabase
      .from('square_config')
      .update({
        test_mode: testMode,
        updated_at: new Date().toISOString()
      })
      .eq('id', (await supabase.from('square_config').select('id').single()).data.id);

    if (error) throw error;

    const badge = document.getElementById('squareModeBadge');
    if (badge) {
      badge.textContent = testMode ? 'Test Mode' : 'Live';
      badge.classList.toggle('live', !testMode);
    }

    showToast(`Square ${testMode ? 'test' : 'live'} mode enabled`, 'success');
  } catch (error) {
    console.error('Error updating Square mode:', error);
    showToast('Failed to update Square mode', 'error');
    document.getElementById('squareTestMode').checked = !testMode; // Revert
  }
}

// =============================================
// TELNYX SMS
// =============================================

function formatPhoneE164(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (phone.startsWith('+') && digits.length >= 10) return `+${digits}`;
  return null;
}

async function loadTelnyxConfig() {
  try {
    const { data: config, error } = await supabase
      .from('telnyx_config')
      .select('phone_number, test_mode, is_active')
      .single();

    if (error) throw error;

    const checkbox = document.getElementById('telnyxTestMode');
    const badge = document.getElementById('telnyxModeBadge');
    const phoneDisplay = document.getElementById('telnyxPhoneDisplay');

    if (checkbox) checkbox.checked = config.test_mode || false;
    if (phoneDisplay) phoneDisplay.textContent = config.phone_number || 'Not configured';
    if (badge) {
      badge.textContent = config.test_mode ? 'Test Mode' : 'Live';
      badge.classList.toggle('live', !config.test_mode);
    }
  } catch (error) {
    console.error('Error loading Telnyx config:', error);
  }
}

async function loadInboundSms() {
  const container = document.getElementById('inboundSmsList');
  if (!container) return;

  try {
    const { data: messages, error } = await supabase
      .from('sms_messages')
      .select(`*, person:person_id(id, first_name, last_name, phone)`)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) throw error;

    if (!messages || messages.length === 0) {
      container.innerHTML = '<p class="text-muted" style="font-size: 0.85rem;">No inbound messages yet.</p>';
      return;
    }

    container.innerHTML = messages.map(msg => {
      const senderName = msg.person
        ? `${msg.person.first_name || ''} ${msg.person.last_name || ''}`.trim()
        : msg.from_number;
      const time = new Date(msg.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      return `
        <div data-action="open-sms" data-person-id="${msg.person_id || ''}" data-from-number="${msg.from_number}">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="font-size: 0.85rem;">${senderName}</strong>
            <span class="text-muted" style="font-size: 0.75rem;">${time}</span>
          </div>
          <p style="margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${msg.body}</p>
        </div>
      `;
    }).join('');

    // Add click handlers
    container.querySelectorAll('[data-action="open-sms"]').forEach(item => {
      item.addEventListener('click', () => {
        const personId = item.dataset.personId;
        const fromNumber = item.dataset.fromNumber;
        if (personId) {
          openComposeSmsModal(personId);
        } else {
          showToast(`Unknown sender: ${fromNumber}`, 'info');
        }
      });
    });
  } catch (error) {
    console.error('Error loading inbound SMS:', error);
    container.innerHTML = '<p class="text-muted" style="font-size: 0.85rem; color: red;">Failed to load messages.</p>';
  }
}

async function getActiveTenants() {
  const { data: assignments, error } = await supabase
    .from('assignments')
    .select(`
      id,
      person:person_id(id, first_name, last_name, phone, email)
    `)
    .eq('status', 'active')
    .eq('type', 'dwelling');

  if (error) {
    console.error('Error loading active tenants:', error);
    return [];
  }

  // Deduplicate by person_id
  const seen = new Set();
  return (assignments || [])
    .filter(a => a.person && !seen.has(a.person.id) && seen.add(a.person.id))
    .map(a => a.person);
}

async function openComposeSmsModal(presetPersonId = null) {
  const modal = document.getElementById('composeSmsModal');
  const select = document.getElementById('smsRecipientSelect');
  const bodyInput = document.getElementById('smsComposeBody');

  // Reset
  bodyInput.value = '';
  document.getElementById('smsCharCount').textContent = '0';
  document.getElementById('smsSegmentCount').textContent = '0';
  document.getElementById('smsConversationSection').classList.add('hidden');

  // Populate recipients
  const tenants = await getActiveTenants();
  select.innerHTML = '<option value="">Select a tenant...</option>' +
    tenants.map(t => {
      const phone = t.phone ? ` (${t.phone})` : ' (no phone)';
      return `<option value="${t.id}" ${!t.phone ? 'disabled' : ''} ${t.id === presetPersonId ? 'selected' : ''}>${t.first_name || ''} ${t.last_name || ''}${phone}</option>`;
    }).join('');

  modal.classList.remove('hidden');

  // If preset, load conversation
  if (presetPersonId) {
    await loadSmsConversation(presetPersonId);
  }
}

async function loadSmsConversation(personId) {
  const section = document.getElementById('smsConversationSection');
  const thread = document.getElementById('smsConversationThread');

  const { data: messages, error } = await supabase
    .from('sms_messages')
    .select('*')
    .eq('person_id', personId)
    .order('created_at', { ascending: true });

  if (error || !messages || messages.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  thread.innerHTML = messages.map(msg => {
    const isOutbound = msg.direction === 'outbound';
    const time = new Date(msg.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const statusBadge = msg.status === 'test' ? ' <span style="color: #f59e0b; font-size: 0.7rem;">[TEST]</span>' : '';
    return `
      <div style="margin-bottom: 0.5rem; text-align: ${isOutbound ? 'right' : 'left'};">
        <div style="display: inline-block; max-width: 80%; padding: 0.5rem 0.75rem; border-radius: 12px; font-size: 0.85rem; background: ${isOutbound ? '#dcf8c6' : '#f0f0f0'}; text-align: left;">
          ${msg.body}
        </div>
        <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">${time}${statusBadge}</div>
      </div>
    `;
  }).join('');

  // Scroll to bottom
  thread.scrollTop = thread.scrollHeight;
}

async function handleSendSms() {
  const select = document.getElementById('smsRecipientSelect');
  const bodyInput = document.getElementById('smsComposeBody');
  const sendBtn = document.getElementById('sendSmsBtn');
  const personId = select.value;
  const messageBody = bodyInput.value.trim();

  if (!personId) return showToast('Select a recipient', 'error');
  if (!messageBody) return showToast('Enter a message', 'error');

  // Get person phone
  const { data: person, error: personError } = await supabase
    .from('people')
    .select('id, first_name, last_name, phone')
    .eq('id', personId)
    .single();

  if (personError || !person?.phone) {
    return showToast('Recipient has no phone number', 'error');
  }

  const formattedPhone = formatPhoneE164(person.phone);
  if (!formattedPhone) return showToast('Invalid phone number format', 'error');

  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(SEND_SMS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        type: 'general',
        to: formattedPhone,
        data: { message: messageBody },
        person_id: personId,
      }),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to send SMS');

    showToast(`SMS sent to ${person.first_name}${result.test_mode ? ' (test mode)' : ''}`, 'success');
    bodyInput.value = '';
    document.getElementById('smsCharCount').textContent = '0';
    document.getElementById('smsSegmentCount').textContent = '0';

    // Refresh conversation
    await loadSmsConversation(personId);
  } catch (error) {
    console.error('Error sending SMS:', error);
    showToast(`Failed to send SMS: ${error.message}`, 'error');
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send SMS';
  }
}

async function openBulkSmsModal() {
  const modal = document.getElementById('bulkSmsModal');
  const bodyInput = document.getElementById('bulkSmsBody');
  const countEl = document.getElementById('bulkSmsRecipientCount');
  const listEl = document.getElementById('bulkSmsRecipientList');

  bodyInput.value = '';
  document.getElementById('bulkSmsCharCount').textContent = '0';

  const tenants = await getActiveTenants();
  bulkSmsRecipients = tenants.filter(t => t.phone && formatPhoneE164(t.phone));

  countEl.textContent = bulkSmsRecipients.length;
  listEl.innerHTML = bulkSmsRecipients.map(t =>
    `<div style="padding: 0.25rem 0; border-bottom: 1px solid #f0f0f0;">${t.first_name || ''} ${t.last_name || ''} <span class="text-muted">${t.phone}</span></div>`
  ).join('') || '<p class="text-muted">No tenants with phone numbers found.</p>';

  modal.classList.remove('hidden');
}

async function handleSendBulkSms() {
  const bodyInput = document.getElementById('bulkSmsBody');
  const sendBtn = document.getElementById('sendBulkSmsBtn');
  const messageBody = bodyInput.value.trim();

  if (!messageBody) return showToast('Enter a message', 'error');
  if (bulkSmsRecipients.length === 0) return showToast('No recipients with phone numbers', 'error');

  sendBtn.disabled = true;
  sendBtn.textContent = `Sending (0/${bulkSmsRecipients.length})...`;

  const { data: { session } } = await supabase.auth.getSession();
  let sent = 0, failed = 0;

  for (let i = 0; i < bulkSmsRecipients.length; i++) {
    const tenant = bulkSmsRecipients[i];
    const formattedPhone = formatPhoneE164(tenant.phone);
    if (!formattedPhone) { failed++; continue; }

    try {
      const response = await fetch(SEND_SMS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          type: 'bulk_announcement',
          to: formattedPhone,
          data: { message: messageBody, first_name: tenant.first_name },
          person_id: tenant.id,
        }),
      });

      if (response.ok) { sent++; } else { failed++; }
    } catch (e) { failed++; }

    sendBtn.textContent = `Sending (${i + 1}/${bulkSmsRecipients.length})...`;

    // Rate limit between messages
    if (i < bulkSmsRecipients.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  showToast(`Sent: ${sent}, Failed: ${failed}`, sent > 0 ? 'success' : 'error');
  sendBtn.disabled = false;
  sendBtn.textContent = 'Send to All';
  document.getElementById('bulkSmsModal').classList.add('hidden');
}

// =============================================
// EMAIL FORWARDING RULES
// =============================================

async function loadForwardingRules() {
  const container = document.getElementById('forwardingRulesList');
  if (!container) return;

  try {
    const { data, error } = await supabase
      .from('email_forwarding_config')
      .select('*')
      .order('address_prefix')
      .order('forward_to');

    if (error) throw error;
    allForwardingRules = data || [];

    if (allForwardingRules.length === 0) {
      container.innerHTML = '<p class="text-muted">No forwarding rules configured.</p>';
      return;
    }

    // Group by prefix
    const grouped = {};
    for (const rule of allForwardingRules) {
      if (!grouped[rule.address_prefix]) grouped[rule.address_prefix] = [];
      grouped[rule.address_prefix].push(rule);
    }

    container.innerHTML = Object.entries(grouped).map(([prefix, rules]) => `
      <div style="margin-bottom: 1rem;">
        <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 0.5rem; color: var(--text-primary);">
          ${prefix}@alpacaplayhouse.com
        </div>
        ${rules.map(r => `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.75rem; background: ${r.is_active ? '#f8faf8' : '#fafafa'}; border-radius: 6px; margin-bottom: 0.25rem; border: 1px solid ${r.is_active ? '#e0e8e0' : '#eee'};">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 0.85rem;">${r.forward_to}</span>
              ${r.label ? `<span class="text-muted" style="font-size: 0.75rem;">(${r.label})</span>` : ''}
              ${!r.is_active ? '<span style="font-size: 0.7rem; color: #999; background: #eee; padding: 1px 6px; border-radius: 3px;">Inactive</span>' : ''}
            </div>
            <button class="btn-small" data-action="edit-forwarding" data-id="${r.id}" style="font-size: 0.75rem; padding: 2px 8px;">Edit</button>
          </div>
        `).join('')}
      </div>
    `).join('');

    container.querySelectorAll('[data-action="edit-forwarding"]').forEach(btn => {
      btn.addEventListener('click', () => openForwardingRuleModal(btn.dataset.id));
    });
  } catch (error) {
    console.error('Error loading forwarding rules:', error);
    container.innerHTML = '<p class="text-muted" style="color: red;">Error loading forwarding rules.</p>';
  }
}

function openForwardingRuleModal(ruleId = null) {
  editingForwardingRuleId = ruleId;
  const modal = document.getElementById('forwardingRuleModal');
  const title = document.getElementById('forwardingRuleModalTitle');
  const deleteBtn = document.getElementById('deleteForwardingRuleBtn');

  if (ruleId) {
    title.textContent = 'Edit Forwarding Rule';
    deleteBtn.style.display = 'block';
    const rule = allForwardingRules.find(r => r.id === ruleId);
    if (rule) {
      document.getElementById('forwardingRuleId').value = rule.id;
      document.getElementById('forwardingPrefix').value = rule.address_prefix;
      document.getElementById('forwardingTo').value = rule.forward_to;
      document.getElementById('forwardingLabel').value = rule.label || '';
      document.getElementById('forwardingActive').checked = rule.is_active;
    }
  } else {
    title.textContent = 'Add Forwarding Rule';
    deleteBtn.style.display = 'none';
    document.getElementById('forwardingRuleForm').reset();
    document.getElementById('forwardingRuleId').value = '';
    document.getElementById('forwardingActive').checked = true;
  }

  modal.classList.remove('hidden');
}

function closeForwardingRuleModal() {
  document.getElementById('forwardingRuleModal').classList.add('hidden');
  editingForwardingRuleId = null;
}

async function saveForwardingRule() {
  const ruleId = document.getElementById('forwardingRuleId').value;
  const data = {
    address_prefix: document.getElementById('forwardingPrefix').value.trim().toLowerCase(),
    forward_to: document.getElementById('forwardingTo').value.trim().toLowerCase(),
    label: document.getElementById('forwardingLabel').value.trim() || null,
    is_active: document.getElementById('forwardingActive').checked,
    updated_at: new Date().toISOString()
  };

  if (!data.address_prefix || !data.forward_to) {
    showToast('Prefix and forward-to email are required', 'warning');
    return;
  }

  try {
    if (ruleId) {
      const { error } = await supabase
        .from('email_forwarding_config')
        .update(data)
        .eq('id', ruleId);
      if (error) throw error;
      showToast('Forwarding rule updated', 'success');
    } else {
      const { error } = await supabase
        .from('email_forwarding_config')
        .insert(data);
      if (error) throw error;
      showToast('Forwarding rule created', 'success');
    }

    closeForwardingRuleModal();
    await loadForwardingRules();
  } catch (error) {
    console.error('Error saving forwarding rule:', error);
    if (error.message?.includes('duplicate') || error.code === '23505') {
      showToast('This prefix + email combination already exists', 'error');
    } else {
      showToast('Failed to save forwarding rule', 'error');
    }
  }
}

async function deleteForwardingRule() {
  if (!editingForwardingRuleId) return;
  if (!confirm('Delete this forwarding rule?')) return;

  try {
    const { error } = await supabase
      .from('email_forwarding_config')
      .delete()
      .eq('id', editingForwardingRuleId);

    if (error) throw error;

    showToast('Forwarding rule deleted', 'success');
    closeForwardingRuleModal();
    await loadForwardingRules();
  } catch (error) {
    console.error('Error deleting forwarding rule:', error);
    showToast('Failed to delete forwarding rule', 'error');
  }
}

// =============================================
// EVENT LISTENERS
// =============================================

function setupEventListeners() {
  // Payment methods
  document.getElementById('addPaymentMethodBtn')?.addEventListener('click', () => openPaymentMethodModal());
  document.getElementById('closePaymentMethodModal')?.addEventListener('click', closePaymentMethodModal);
  document.getElementById('cancelPaymentMethodBtn')?.addEventListener('click', closePaymentMethodModal);
  document.getElementById('savePaymentMethodBtn')?.addEventListener('click', savePaymentMethod);
  document.getElementById('deletePaymentMethodBtn')?.addEventListener('click', deletePaymentMethod);

  // Fee codes
  document.getElementById('addFeeCodeBtn')?.addEventListener('click', () => openFeeCodeModal());
  document.getElementById('closeFeeCodeModal')?.addEventListener('click', closeFeeCodeModal);
  document.getElementById('cancelFeeCodeBtn')?.addEventListener('click', closeFeeCodeModal);
  document.getElementById('saveFeeCodeBtn')?.addEventListener('click', saveFeeCode);

  // Square test mode toggle
  document.getElementById('squareTestMode')?.addEventListener('change', (e) => {
    toggleSquareTestMode(e.target.checked);
  });

  // Telnyx test mode toggle
  document.getElementById('telnyxTestMode')?.addEventListener('change', async (e) => {
    const testMode = e.target.checked;
    try {
      const { error } = await supabase
        .from('telnyx_config')
        .update({ test_mode: testMode, updated_at: new Date().toISOString() })
        .eq('id', 1);
      if (error) throw error;

      const badge = document.getElementById('telnyxModeBadge');
      if (badge) {
        badge.textContent = testMode ? 'Test Mode' : 'Live';
        badge.classList.toggle('live', !testMode);
      }
      showToast(`SMS ${testMode ? 'test' : 'live'} mode enabled`, 'success');
    } catch (error) {
      console.error('Error updating Telnyx mode:', error);
      showToast('Failed to update SMS mode', 'error');
      e.target.checked = !testMode;
    }
  });

  // Forwarding rules
  document.getElementById('addForwardingRuleBtn')?.addEventListener('click', () => openForwardingRuleModal());
  document.getElementById('closeForwardingRuleModal')?.addEventListener('click', closeForwardingRuleModal);
  document.getElementById('cancelForwardingRuleBtn')?.addEventListener('click', closeForwardingRuleModal);
  document.getElementById('saveForwardingRuleBtn')?.addEventListener('click', saveForwardingRule);
  document.getElementById('deleteForwardingRuleBtn')?.addEventListener('click', deleteForwardingRule);

  // SMS compose
  document.getElementById('openComposeSmsBtn')?.addEventListener('click', () => openComposeSmsModal());
  document.getElementById('openBulkSmsBtn')?.addEventListener('click', openBulkSmsModal);
  document.getElementById('refreshInboundSmsBtn')?.addEventListener('click', loadInboundSms);

  // Compose SMS modal
  document.getElementById('closeComposeSmsModal')?.addEventListener('click', () => {
    document.getElementById('composeSmsModal').classList.add('hidden');
  });
  document.getElementById('cancelComposeSmsBtn')?.addEventListener('click', () => {
    document.getElementById('composeSmsModal').classList.add('hidden');
  });
  document.getElementById('sendSmsBtn')?.addEventListener('click', handleSendSms);

  // Character counter
  document.getElementById('smsComposeBody')?.addEventListener('input', (e) => {
    const len = e.target.value.length;
    document.getElementById('smsCharCount').textContent = len;
    document.getElementById('smsSegmentCount').textContent = Math.ceil(len / 160) || 0;
  });

  // Recipient change - load conversation
  document.getElementById('smsRecipientSelect')?.addEventListener('change', async (e) => {
    const personId = e.target.value;
    const section = document.getElementById('smsConversationSection');
    if (!personId) {
      section.classList.add('hidden');
      return;
    }
    await loadSmsConversation(personId);
  });

  // Bulk SMS modal
  document.getElementById('closeBulkSmsModal')?.addEventListener('click', () => {
    document.getElementById('bulkSmsModal').classList.add('hidden');
  });
  document.getElementById('cancelBulkSmsBtn')?.addEventListener('click', () => {
    document.getElementById('bulkSmsModal').classList.add('hidden');
  });
  document.getElementById('sendBulkSmsBtn')?.addEventListener('click', handleSendBulkSms);

  document.getElementById('bulkSmsBody')?.addEventListener('input', (e) => {
    document.getElementById('bulkSmsCharCount').textContent = e.target.value.length;
  });

  // Close modals on backdrop click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeFeeCodeModal();
      closePaymentMethodModal();
      closeForwardingRuleModal();
      document.getElementById('composeSmsModal')?.classList.add('hidden');
      document.getElementById('bulkSmsModal')?.classList.add('hidden');
    }
  });
}
