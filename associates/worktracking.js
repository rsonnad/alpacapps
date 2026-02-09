/**
 * Associate Hours Page - Mobile-optimized time tracking
 * Clock in/out, view history, upload work photos, manage payment preferences
 */
import { supabase } from '../shared/supabase.js';
import { initAuth, getAuthState, signOut, onAuthStateChange } from '../shared/auth.js';
import { hoursService, HoursService, PHOTO_TYPE_LABELS } from '../shared/hours-service.js';
import { mediaService } from '../shared/media-service.js';
import { PAYMENT_METHOD_LABELS } from '../shared/accounting-service.js';

// =============================================
// STATE
// =============================================
let authState = null;
let profile = null;
let activeEntry = null;
let timerInterval = null;
let selectedPhotoType = 'before';
let currentLocation = null;

// =============================================
// INITIALIZATION
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initAuth();
    authState = getAuthState();
    if (!authState?.appUser) {
      showAuthScreen();
      return;
    }
    await initApp();
  } catch (err) {
    console.error('Init failed:', err);
    showAuthScreen();
  }

  onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT') {
      showAuthScreen();
    } else if (event === 'SIGNED_IN' && session) {
      authState = getAuthState();
      if (authState?.appUser) await initApp();
    }
  });
});

function showAuthScreen() {
  document.getElementById('loadingOverlay').classList.add('hidden');
  document.getElementById('appContent').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
}

async function initApp() {
  const role = authState.appUser?.role;
  if (!['associate', 'staff', 'admin'].includes(role)) {
    showAuthScreen();
    showToast('Your account is not authorized for hours tracking', 'error');
    return;
  }

  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('loadingOverlay').classList.add('hidden');
  document.getElementById('appContent').classList.remove('hidden');

  document.getElementById('userName').textContent =
    authState.appUser?.display_name || authState.appUser?.first_name || authState.email || '';

  // Get or create associate profile
  try {
    profile = await hoursService.getOrCreateProfile(authState.appUser.id);
  } catch (err) {
    console.error('Failed to get profile:', err);
    showToast('Failed to load your profile', 'error');
    return;
  }

  setupEventListeners();
  requestLocation();
  await refreshAll();
}

async function refreshAll() {
  await Promise.all([
    refreshClockState(),
    refreshToday(),
    refreshTodayPhotos(),
    refreshPaymentTab()
  ]);
}

// =============================================
// LOCATION
// =============================================
function requestLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => { currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
    () => { currentLocation = null; },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(currentLocation),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  });
}

// =============================================
// CLOCK IN/OUT
// =============================================
async function refreshClockState() {
  try {
    activeEntry = await hoursService.getActiveEntry(profile.id);
    updateClockUI();
  } catch (err) {
    console.error('Failed to get clock state:', err);
  }
}

function updateClockUI() {
  const btn = document.getElementById('clockBtn');
  const timer = document.getElementById('timerDisplay');
  const timerLabel = document.getElementById('timerLabel');
  const rateDisplay = document.getElementById('rateDisplay');
  const prompt = document.getElementById('clockoutPrompt');

  rateDisplay.textContent = `Your rate: ${HoursService.formatCurrency(profile.hourly_rate)}/hr`;
  prompt.classList.remove('visible');

  if (activeEntry) {
    btn.className = 'clock-btn clock-out';
    btn.textContent = 'Clock Out';
    btn.onclick = showClockoutPrompt;
    timer.style.display = '';
    timerLabel.style.display = '';
    startTimer();
  } else {
    btn.className = 'clock-btn clock-in';
    btn.textContent = 'Clock In';
    btn.onclick = handleClockIn;
    timer.style.display = 'none';
    timerLabel.style.display = 'none';
    stopTimer();
  }
}

async function handleClockIn() {
  const btn = document.getElementById('clockBtn');
  btn.disabled = true;
  try {
    const loc = await getLocation();
    activeEntry = await hoursService.clockIn(profile.id, loc || {});
    showToast('Clocked in!', 'success');
    updateClockUI();
    await refreshToday();
  } catch (err) {
    showToast('Failed to clock in: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function showClockoutPrompt() {
  document.getElementById('clockoutPrompt').classList.add('visible');
  document.getElementById('clockoutDesc').value = '';
  document.getElementById('clockoutDesc').focus();
}

async function handleClockOut(description) {
  const btn = document.getElementById('btnClockoutSubmit');
  btn.disabled = true;
  try {
    const loc = await getLocation();
    await hoursService.clockOut(activeEntry.id, {
      ...(loc || {}),
      description: description || null
    });
    activeEntry = null;
    showToast('Clocked out!', 'success');
    updateClockUI();
    await refreshToday();
  } catch (err) {
    showToast('Failed to clock out: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// =============================================
// TIMER
// =============================================
function startTimer() {
  stopTimer();
  updateTimerDisplay();
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function updateTimerDisplay() {
  if (!activeEntry) return;
  const elapsed = Date.now() - new Date(activeEntry.clock_in).getTime();
  const secs = Math.floor(elapsed / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  document.getElementById('timerDisplay').textContent =
    `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// =============================================
// TODAY TAB
// =============================================
async function refreshToday() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const entries = await hoursService.getEntries(profile.id, { dateFrom: today, dateTo: today });

    let totalMins = 0, totalAmt = 0;
    for (const e of entries) {
      const mins = parseFloat(e.duration_minutes) || 0;
      totalMins += mins;
      totalAmt += (mins / 60) * parseFloat(e.hourly_rate);
    }

    // If clocked in, add running time
    if (activeEntry) {
      const runningMins = (Date.now() - new Date(activeEntry.clock_in).getTime()) / 60000;
      totalMins += runningMins;
      totalAmt += (runningMins / 60) * parseFloat(activeEntry.hourly_rate);
    }

    document.getElementById('todayHours').textContent = HoursService.formatDuration(totalMins);
    document.getElementById('todayAmount').textContent = HoursService.formatCurrency(totalAmt);

    const container = document.getElementById('todayEntries');
    if (!entries.length && !activeEntry) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;font-size:0.85rem;">No entries yet today. Hit Clock In to start!</p>';
      return;
    }

    container.innerHTML = entries.map(e => {
      const ci = HoursService.formatTime(e.clock_in);
      const co = e.clock_out ? HoursService.formatTime(e.clock_out) : 'Active';
      const dur = e.duration_minutes ? HoursService.formatDuration(e.duration_minutes) : '...';
      const desc = e.description ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.15rem;">${escapeHtml(e.description)}</div>` : '';
      const manual = e.is_manual ? '<span class="manual-badge" style="margin-left:0.3rem;">Manual</span>' : '';
      return `<div class="entry-row">
        <div><span class="entry-times">${ci} — ${co}</span>${manual}${desc}</div>
        <span class="entry-duration">${dur}</span>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('Failed to refresh today:', err);
  }
}

// =============================================
// PHOTOS
// =============================================
async function refreshTodayPhotos() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const photos = await hoursService.getPhotosForDate(profile.id, today);
    const grid = document.getElementById('todayPhotos');

    if (!photos.length) {
      grid.innerHTML = '';
      return;
    }

    grid.innerHTML = photos.map(p => {
      const url = p.media?.url || '';
      const type = PHOTO_TYPE_LABELS[p.photo_type] || p.photo_type;
      return `<div class="photo-thumb" style="position:relative;" onclick="window.open('${escapeHtml(url)}','_blank')">
        <img src="${escapeHtml(url)}" alt="${escapeHtml(type)}" loading="lazy">
        <span class="type-tag">${escapeHtml(type)}</span>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('Failed to load photos:', err);
  }
}

async function handlePhotoUpload(file) {
  if (!file) return;
  showToast('Uploading photo...', 'info', 2000);

  try {
    // Upload via media service
    const media = await mediaService.uploadMedia(file, { category: 'projects' });

    // Create work photo record
    await hoursService.createWorkPhoto({
      associateId: profile.id,
      mediaId: media.id,
      timeEntryId: activeEntry?.id || null,
      photoType: selectedPhotoType,
      workDate: new Date().toISOString().split('T')[0]
    });

    showToast('Photo uploaded!', 'success');
    await refreshTodayPhotos();
  } catch (err) {
    showToast('Failed to upload photo: ' + err.message, 'error');
  }
}

// =============================================
// HISTORY TAB
// =============================================
async function refreshHistory() {
  try {
    const periodDays = document.getElementById('historyPeriod').value;
    const statusFilter = document.getElementById('historyStatus').value;

    let dateFrom = null;
    if (periodDays !== 'all') {
      const d = new Date();
      d.setDate(d.getDate() - parseInt(periodDays));
      dateFrom = d.toISOString().split('T')[0];
    }

    const isPaid = statusFilter === 'paid' ? true : (statusFilter === 'unpaid' ? false : undefined);
    const days = await hoursService.getHistory(profile.id, { dateFrom, isPaid });

    const container = document.getElementById('historyList');
    if (!days.length) {
      container.innerHTML = `<div class="history-empty">
        <div class="he-icon">📋</div>
        <div class="he-text">No entries found</div>
        <div class="he-sub">Try adjusting your filters or clock in to start tracking</div>
      </div>`;
      return;
    }

    // Compute period totals
    let periodMins = 0, periodAmt = 0, periodDayCount = days.length;
    for (const day of days) {
      periodMins += day.totalMinutes;
      periodAmt += day.totalAmount;
    }

    const summaryHtml = `<div class="history-summary">
      <div><div class="hs-val">${periodDayCount}</div><div class="hs-lbl">Days</div></div>
      <div><div class="hs-val">${HoursService.formatHoursDecimal(periodMins)}h</div><div class="hs-lbl">Total Hours</div></div>
      <div><div class="hs-val">${HoursService.formatCurrency(periodAmt)}</div><div class="hs-lbl">Total Earned</div></div>
    </div>`;

    const daysHtml = days.map(day => {
      const badgeClass = day.hasPaid && day.hasUnpaid ? 'mixed' : (day.hasPaid ? 'paid' : 'unpaid');
      const badgeText = day.hasPaid && day.hasUnpaid ? 'Partial' : (day.hasPaid ? 'Paid' : 'Unpaid');

      const entriesHtml = day.entries.map(e => {
        const ci = HoursService.formatTime(e.clock_in);
        const co = e.clock_out ? HoursService.formatTime(e.clock_out) : 'Active';
        const mins = parseFloat(e.duration_minutes) || 0;
        const dur = e.clock_out ? HoursService.formatDuration(mins) : '...';
        const earned = mins > 0 ? HoursService.formatCurrency((mins / 60) * parseFloat(e.hourly_rate)) : '';
        const desc = e.description ? `<div class="ed-desc" title="${escapeHtml(e.description)}">${escapeHtml(e.description)}</div>` : '';
        const paidClass = e.is_paid ? 'paid' : 'unpaid';
        const manualHtml = e.is_manual ? `<span class="manual-badge" title="${escapeHtml(e.manual_reason || 'Manual entry')}">Manual</span>` : '';

        return `<div class="history-entry">
          <div class="entry-time-block">
            <span class="etb-in">${ci}</span>
            <span class="etb-divider">▾</span>
            <span class="etb-out">${co}</span>
          </div>
          <div class="entry-detail">
            <div class="ed-duration">${dur}${manualHtml}</div>
            ${desc}
          </div>
          ${earned ? `<div class="entry-earned">${earned}</div>` : ''}
          <div class="entry-paid-dot ${paidClass}" title="${e.is_paid ? 'Paid' : 'Unpaid'}"></div>
        </div>`;
      }).join('');

      return `<div class="day-group">
        <div class="day-header">
          <div>
            <span class="day-date">${HoursService.formatDate(day.date)}</span>
            <span class="day-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="day-totals">
            <div class="day-hours">${HoursService.formatDuration(day.totalMinutes)}</div>
            <div class="day-amount">${HoursService.formatCurrency(day.totalAmount)}</div>
          </div>
        </div>
        <div class="day-entries">${entriesHtml}</div>
      </div>`;
    }).join('');

    container.innerHTML = summaryHtml + daysHtml;
  } catch (err) {
    console.error('Failed to load history:', err);
    showToast('Failed to load history', 'error');
  }
}

// =============================================
// PAYMENT TAB
// =============================================
async function refreshPaymentTab() {
  try {
    // Refresh profile to get latest rate
    profile = await hoursService.getOrCreateProfile(authState.appUser.id);

    document.getElementById('payRate').textContent = `${HoursService.formatCurrency(profile.hourly_rate)}/hr`;
    document.getElementById('payMethod').value = profile.payment_method || '';
    document.getElementById('payHandle').value = profile.payment_handle || '';

    const summary = await hoursService.getAssociateSummary(profile.id);
    document.getElementById('payTotal').textContent = HoursService.formatCurrency(summary.totalAmount);
    document.getElementById('payPaid').textContent = HoursService.formatCurrency(summary.paidAmount);
    document.getElementById('payUnpaid').textContent = HoursService.formatCurrency(summary.unpaidAmount);
  } catch (err) {
    console.error('Failed to refresh payment tab:', err);
  }
}

async function savePaymentPref() {
  const method = document.getElementById('payMethod').value || null;
  const handle = document.getElementById('payHandle').value.trim() || null;

  try {
    await hoursService.updateProfile(profile.id, { payment_method: method, payment_handle: handle });
    profile.payment_method = method;
    profile.payment_handle = handle;
    showToast('Payment preference saved!', 'success');
  } catch (err) {
    showToast('Failed to save: ' + err.message, 'error');
  }
}

// =============================================
// EVENT LISTENERS
// =============================================
function setupEventListeners() {
  // Sign out
  document.getElementById('btnSignOut').addEventListener('click', async () => {
    await signOut();
    showAuthScreen();
  });

  // Google sign in
  document.getElementById('btnGoogleSignIn').addEventListener('click', async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.href }
      });
      if (error) showToast(error.message, 'error');
    } catch (err) {
      showToast('Sign in failed', 'error');
    }
  });

  // Tab switching
  document.querySelectorAll('.tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const tabId = `tab${btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)}`;
      document.getElementById(tabId).classList.add('active');
      // Load tab data on switch
      if (btn.dataset.tab === 'history') refreshHistory();
      else if (btn.dataset.tab === 'payment') refreshPaymentTab();
    });
  });

  // Clock out prompt
  document.getElementById('btnClockoutSubmit').addEventListener('click', () => {
    handleClockOut(document.getElementById('clockoutDesc').value.trim());
  });
  document.getElementById('btnClockoutSkip').addEventListener('click', () => {
    handleClockOut(null);
  });

  // Photo type selector
  document.querySelectorAll('[data-photo-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-photo-type]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPhotoType = btn.dataset.photoType;
    });
  });

  // Photo upload
  document.getElementById('photoUploadArea').addEventListener('click', () => {
    document.getElementById('photoInput').click();
  });
  document.getElementById('photoInput').addEventListener('change', (e) => {
    if (e.target.files[0]) handlePhotoUpload(e.target.files[0]);
    e.target.value = '';
  });

  // History filters
  document.getElementById('historyPeriod').addEventListener('change', refreshHistory);
  document.getElementById('historyStatus').addEventListener('change', refreshHistory);

  // Save payment preference
  document.getElementById('btnSavePref').addEventListener('click', savePaymentPref);

  // Manual entry modal
  document.getElementById('btnManualEntry').addEventListener('click', openManualModal);
  document.getElementById('btnManualClose').addEventListener('click', closeManualModal);
  document.getElementById('manualEntryModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeManualModal();
  });
  document.getElementById('btnManualSubmit').addEventListener('click', handleManualSubmit);

  // Live duration computation
  const computeDuration = () => {
    const date = document.getElementById('manualDate').value;
    const ci = document.getElementById('manualClockIn').value;
    const co = document.getElementById('manualClockOut').value;
    const durEl = document.getElementById('manualDuration');
    if (!ci || !co) { durEl.textContent = '—'; return; }
    const ciDate = new Date(`${date || new Date().toISOString().split('T')[0]}T${ci}`);
    const coDate = new Date(`${date || new Date().toISOString().split('T')[0]}T${co}`);
    const diffMs = coDate - ciDate;
    if (diffMs <= 0) { durEl.textContent = 'Invalid (out must be after in)'; durEl.style.color = '#ef4444'; return; }
    const mins = Math.round(diffMs / 60000);
    const earned = (mins / 60) * parseFloat(profile.hourly_rate || 0);
    durEl.style.color = '#0f766e';
    durEl.textContent = `${HoursService.formatDuration(mins)} — ${HoursService.formatCurrency(earned)}`;
  };
  document.getElementById('manualClockIn').addEventListener('input', computeDuration);
  document.getElementById('manualClockOut').addEventListener('input', computeDuration);
}

// =============================================
// MANUAL ENTRY
// =============================================
function openManualModal() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('manualDate').value = today;
  document.getElementById('manualClockIn').value = '';
  document.getElementById('manualClockOut').value = '';
  document.getElementById('manualDesc').value = '';
  document.getElementById('manualReason').value = '';
  document.getElementById('manualDuration').textContent = '—';
  document.getElementById('manualEntryModal').classList.add('visible');
}

function closeManualModal() {
  document.getElementById('manualEntryModal').classList.remove('visible');
}

async function handleManualSubmit() {
  const date = document.getElementById('manualDate').value;
  const clockIn = document.getElementById('manualClockIn').value;
  const clockOut = document.getElementById('manualClockOut').value;
  const description = document.getElementById('manualDesc').value.trim();
  const manualReason = document.getElementById('manualReason').value.trim();

  if (!date || !clockIn || !clockOut) {
    showToast('Please fill in date, clock in, and clock out times', 'error');
    return;
  }
  if (!manualReason) {
    showToast('Please provide a reason for the manual entry', 'error');
    return;
  }

  const ciDateTime = `${date}T${clockIn}`;
  const coDateTime = `${date}T${clockOut}`;
  if (new Date(coDateTime) <= new Date(ciDateTime)) {
    showToast('Clock out must be after clock in', 'error');
    return;
  }

  const btn = document.getElementById('btnManualSubmit');
  btn.disabled = true;
  btn.textContent = 'Adding...';

  try {
    await hoursService.createManualEntry(profile.id, {
      clockIn: ciDateTime,
      clockOut: coDateTime,
      description: description || null,
      manualReason,
      hourlyRate: profile.hourly_rate
    });
    showToast('Manual entry added!', 'success');
    closeManualModal();
    await Promise.all([refreshToday(), refreshHistory()]);
  } catch (err) {
    showToast('Failed to add entry: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add Entry';
  }
}

// =============================================
// TOAST
// =============================================
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span><button class="toast-close" onclick="this.parentElement.remove()">&times;</button>`;
  container.appendChild(toast);
  if (duration > 0) {
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 200); }, duration);
  }
}

// =============================================
// HELPERS
// =============================================
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
