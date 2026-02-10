/**
 * Associate Hours Page - Mobile-optimized time tracking
 * Clock in/out, view history, upload work photos, manage payment preferences
 */
import { supabase } from '../shared/supabase.js';
import { initAssociatePage, showToast as shellShowToast } from '../shared/associate-shell.js';
import { hoursService, HoursService, PHOTO_TYPE_LABELS } from '../shared/hours-service.js';
import { mediaService } from '../shared/media-service.js';
import { PAYMENT_METHOD_LABELS } from '../shared/accounting-service.js';
import { identityService } from '../shared/identity-service.js';
import { projectService } from '../shared/project-service.js';

// =============================================
// STATE
// =============================================
let authState = null;
let profile = null;
let activeEntry = null;
let timerInterval = null;
let selectedPhotoType = 'before';
let currentLocation = null;
let spacesMap = {};
let scheduleData = [];
let scheduleActuals = {};
let scheduleLoaded = false;

// =============================================
// INITIALIZATION
// =============================================
initAssociatePage({
  activeTab: 'hours',
  onReady: async (state) => {
    authState = state;
    await initApp();
  }
});

async function initApp() {
  // Get or create associate profile
  try {
    profile = await hoursService.getOrCreateProfile(authState.appUser.id, authState.appUser.role);
  } catch (err) {
    console.error('Failed to get profile:', err);
    showToast('Failed to load your profile', 'error');
    return;
  }

  setupEventListeners();
  requestLocation();
  await loadSpaces();
  await loadTasksForSelector();
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
// SPACE SELECTOR (sticky)
// =============================================
const SPACE_KEY = 'worktracking-selected-space';

async function loadSpaces() {
  try {
    const { data, error } = await supabase
      .from('spaces')
      .select('id, name, parent:parent_id(name)')
      .eq('is_archived', false)
      .order('name');

    if (error) throw error;

    // Build a lookup map for space names (used by history/today rendering)
    spacesMap = {};
    for (const s of (data || [])) {
      spacesMap[s.id] = s.parent?.name ? `${s.name} (${s.parent.name})` : s.name;
    }

    const sel = document.getElementById('spaceSelector');
    sel.innerHTML = '<option value="">Select space...</option>';
    sel.innerHTML += '<option value="other">Other</option>';
    for (const s of (data || [])) {
      const label = s.parent?.name ? `${s.name} (${s.parent.name})` : s.name;
      sel.innerHTML += `<option value="${s.id}">${escapeHtml(label)}</option>`;
    }

    // Restore sticky selection
    const saved = localStorage.getItem(SPACE_KEY);
    if (saved && sel.querySelector(`option[value="${saved}"]`)) {
      sel.value = saved;
    }

    // Persist on change
    sel.addEventListener('change', () => {
      localStorage.setItem(SPACE_KEY, sel.value);
    });
  } catch (err) {
    console.error('Failed to load spaces:', err);
  }
}

function getSelectedSpaceId() {
  const val = document.getElementById('spaceSelector').value;
  return val && val !== 'other' ? val : null;
}

function getSelectedTaskId() {
  const sel = document.getElementById('taskSelector');
  return sel ? (sel.value || null) : null;
}

async function loadTasksForSelector() {
  try {
    const userId = authState?.appUser?.id;
    const tasks = userId
      ? await projectService.getOpenTasksForUser(userId)
      : await projectService.getAllTasks({ status: 'all' });
    const sel = document.getElementById('taskSelector');
    if (!sel) return;
    // Keep the first "No specific task" option
    while (sel.options.length > 1) sel.remove(1);
    (tasks || []).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      const location = t.space?.name || '';
      opt.textContent = location ? `${t.title} (${location})` : t.title;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load tasks:', err);
  }
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
    activeEntry = await hoursService.clockIn(profile.id, { ...(loc || {}), spaceId: getSelectedSpaceId(), taskId: getSelectedTaskId() });
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
      const spaceLabel = e.space_id && spacesMap[e.space_id] ? `<span class="space-tag">${escapeHtml(spacesMap[e.space_id])}</span>` : '';
      return `<div class="entry-row">
        <div><span class="entry-times">${ci} — ${co}</span>${manual}${spaceLabel}${desc}</div>
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
    const today = new Date().toISOString().split('T')[0];
    if (periodDays !== 'all') {
      const d = new Date();
      d.setDate(d.getDate() - parseInt(periodDays));
      dateFrom = d.toISOString().split('T')[0];
    }

    const isPaid = statusFilter === 'paid' ? true : (statusFilter === 'unpaid' ? false : undefined);
    const days = await hoursService.getHistory(profile.id, { dateFrom, isPaid });

    // Load schedule data for the same period to build weekly comparison
    const scheduleRows = await hoursService.getSchedule(profile.id, dateFrom, today);

    const container = document.getElementById('historyList');
    if (!days.length && !scheduleRows.length) {
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

    // Build schedule vs actuals weekly comparison
    let scheduleComparisonHtml = '';
    if (scheduleRows.length > 0) {
      // Build actuals by date from the history days
      const actualsByDate = {};
      for (const day of days) {
        actualsByDate[day.date] = day.totalMinutes;
      }

      // Group schedule rows + actuals into Sun-Sat weeks
      const allDates = new Set([
        ...scheduleRows.map(r => r.schedule_date),
        ...days.map(d => d.date)
      ]);
      const weekMap = {};
      for (const date of allDates) {
        const sun = getWeekSunday(date);
        if (!weekMap[sun]) weekMap[sun] = { sunday: sun, scheduledMins: 0, actualMins: 0, mods: 0 };
      }
      for (const row of scheduleRows) {
        const sun = getWeekSunday(row.schedule_date);
        if (!weekMap[sun]) weekMap[sun] = { sunday: sun, scheduledMins: 0, actualMins: 0, mods: 0 };
        weekMap[sun].scheduledMins += row.scheduled_minutes;
        weekMap[sun].mods += row.modification_count;
      }
      for (const day of days) {
        const sun = getWeekSunday(day.date);
        if (!weekMap[sun]) weekMap[sun] = { sunday: sun, scheduledMins: 0, actualMins: 0, mods: 0 };
        weekMap[sun].actualMins += day.totalMinutes;
      }

      // Sort weeks most recent first, only show weeks that have schedule data
      const weeks = Object.values(weekMap)
        .filter(w => w.scheduledMins > 0)
        .sort((a, b) => b.sunday.localeCompare(a.sunday));

      if (weeks.length > 0) {
        const weeksHtml = weeks.map(w => {
          const sunDate = new Date(w.sunday + 'T12:00:00');
          const satDate = new Date(sunDate);
          satDate.setDate(sunDate.getDate() + 6);
          const sunLabel = sunDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const satLabel = satDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          const schedH = HoursService.formatHoursDecimal(w.scheduledMins);
          const actualH = HoursService.formatHoursDecimal(w.actualMins);
          const deltaMins = w.actualMins - w.scheduledMins;
          const deltaH = HoursService.formatHoursDecimal(Math.abs(deltaMins));
          const deltaSign = deltaMins > 0 ? '+' : (deltaMins < 0 ? '-' : '');
          const deltaClass = deltaMins > 0 ? 'positive' : (deltaMins < 0 ? 'negative' : 'zero');
          const modsLabel = w.mods > 0 ? `<span class="hsb-mods">${w.mods} change${w.mods !== 1 ? 's' : ''}</span>` : '';

          return `<div class="hsb-week">
            <div class="hsb-week-label">${sunLabel} – ${satLabel}${modsLabel}<span class="hsb-dates">Sun – Sat</span></div>
            <div class="hsb-week-stats">
              <div class="hsb-stat sched"><span class="hsb-num">${schedH}h</span><span class="hsb-lbl">Sched</span></div>
              <div class="hsb-stat actual"><span class="hsb-num">${actualH}h</span><span class="hsb-lbl">Actual</span></div>
              <div class="hsb-stat delta"><span class="hsb-num ${deltaClass}">${deltaSign}${deltaH}h</span><span class="hsb-lbl">Delta</span></div>
            </div>
          </div>`;
        }).join('');

        scheduleComparisonHtml = `<div class="history-schedule-bar">
          <h4>Schedule vs Actual</h4>
          <div class="hsb-weeks">${weeksHtml}</div>
        </div>`;
      }
    }

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
        const spaceHtml = e.space_id && spacesMap[e.space_id] ? `<div class="ed-desc">${escapeHtml(spacesMap[e.space_id])}</div>` : '';

        return `<div class="history-entry">
          <div class="entry-time-block">
            <span class="etb-in">${ci}</span>
            <span class="etb-divider">▾</span>
            <span class="etb-out">${co}</span>
          </div>
          <div class="entry-detail">
            <div class="ed-duration">${dur}${manualHtml}</div>
            ${desc}
            ${spaceHtml}
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

    container.innerHTML = summaryHtml + scheduleComparisonHtml + daysHtml;
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
    profile = await hoursService.getOrCreateProfile(authState.appUser.id, authState.appUser.role);

    document.getElementById('payRate').textContent = `${HoursService.formatCurrency(profile.hourly_rate)}/hr`;
    document.getElementById('payMethod').value = profile.payment_method || '';
    document.getElementById('payHandle').value = profile.payment_handle || '';

    const summary = await hoursService.getAssociateSummary(profile.id);
    document.getElementById('payTotal').textContent = HoursService.formatCurrency(summary.totalAmount);
    document.getElementById('payPaid').textContent = HoursService.formatCurrency(summary.paidAmount);
    document.getElementById('payUnpaid').textContent = HoursService.formatCurrency(summary.unpaidAmount);

    // Show ID verification banner
    renderIdVerificationBanner(profile.identity_verification_status);
  } catch (err) {
    console.error('Failed to refresh payment tab:', err);
  }
}

function renderIdVerificationBanner(status) {
  const banner = document.getElementById('idVerificationBanner');
  if (!banner) return;

  if (status === 'verified') {
    banner.style.display = 'block';
    banner.innerHTML = `<div class="id-banner ok"><strong>Identity Verified</strong>Your ID has been verified. You're all set to receive payments.</div>`;
    return;
  }

  if (status === 'link_sent') {
    banner.style.display = 'block';
    banner.innerHTML = `<div class="id-banner info"><strong>ID Verification Pending</strong>A verification link has been sent. Complete it to receive payments.<button class="btn-verify" id="btnVerifyId">Verify My ID</button></div>`;
    document.getElementById('btnVerifyId')?.addEventListener('click', handleSelfVerify);
    return;
  }

  if (status === 'flagged') {
    banner.style.display = 'block';
    banner.innerHTML = `<div class="id-banner info"><strong>ID Under Review</strong>Your ID is being reviewed by our team. We'll update you shortly.</div>`;
    return;
  }

  if (status === 'rejected') {
    banner.style.display = 'block';
    banner.innerHTML = `<div class="id-banner error"><strong>ID Verification Issue</strong>There was an issue with your ID. Please upload a new one.<button class="btn-verify" id="btnVerifyId">Upload New ID</button></div>`;
    document.getElementById('btnVerifyId')?.addEventListener('click', handleSelfVerify);
    return;
  }

  // pending or null — not yet requested
  banner.style.display = 'block';
  banner.innerHTML = `<div class="id-banner warn"><strong>ID Verification Required</strong>Upload your driver's license or state ID to receive payments.<button class="btn-verify" id="btnVerifyId">Verify My ID</button></div>`;
  document.getElementById('btnVerifyId')?.addEventListener('click', handleSelfVerify);
}

async function handleSelfVerify() {
  const btn = document.getElementById('btnVerifyId');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating link...'; }
  try {
    const { uploadUrl } = await identityService.requestAssociateVerification(authState.appUser.id, 'self');
    window.location.href = uploadUrl;
  } catch (err) {
    showToast('Failed to start verification: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Verify My ID'; }
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
      else if (btn.dataset.tab === 'coworkers') refreshCoworkers();
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

  // Scheduling — lazy load on first open
  document.getElementById('scheduleDetails').addEventListener('toggle', (e) => {
    if (e.target.open && !scheduleLoaded) loadSchedule();
  });
  document.getElementById('btnSaveSchedule').addEventListener('click', saveSchedule);

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
      hourlyRate: profile.hourly_rate,
      spaceId: getSelectedSpaceId(),
      taskId: getSelectedTaskId()
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
// SCHEDULING
// =============================================
function getScheduleDates() {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < 10; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

async function loadSchedule() {
  if (!profile) return;
  try {
    const dates = getScheduleDates();
    scheduleData = await hoursService.getSchedule(profile.id, dates[0], dates[9]);

    // Load actuals for the same period
    const entries = await hoursService.getEntries(profile.id, { dateFrom: dates[0], dateTo: dates[9] });
    scheduleActuals = {};
    for (const e of entries) {
      if (!e.duration_minutes) continue;
      const date = e.clock_in.split('T')[0];
      scheduleActuals[date] = (scheduleActuals[date] || 0) + parseFloat(e.duration_minutes);
    }

    scheduleLoaded = true;
    renderSchedule();
  } catch (err) {
    console.error('Failed to load schedule:', err);
  }
}

/**
 * Get the Sunday that starts the week containing a given date string (YYYY-MM-DD).
 */
function getWeekSunday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - day);
  return d.toISOString().split('T')[0];
}

function renderSchedule() {
  const dates = getScheduleDates();
  const today = new Date().toISOString().split('T')[0];

  // Build lookup from existing schedule data
  const schedMap = {};
  let totalModifications = 0;
  for (const row of scheduleData) {
    schedMap[row.schedule_date] = row;
    totalModifications += row.modification_count;
  }

  // Compute totals
  let totalScheduledMins = 0;
  let totalActualMins = 0;
  for (const date of dates) {
    const sched = schedMap[date];
    if (sched) totalScheduledMins += sched.scheduled_minutes;
    totalActualMins += (scheduleActuals[date] || 0);
  }

  // Summary
  const summaryEl = document.getElementById('scheduleSummary');
  const pctRaw = totalScheduledMins > 0 ? Math.round((totalActualMins / totalScheduledMins) * 100) : 0;
  const pctClass = pctRaw >= 90 ? 'green' : (pctRaw >= 50 ? 'yellow' : 'red');
  const scheduledH = HoursService.formatHoursDecimal(totalScheduledMins);
  const actualH = HoursService.formatHoursDecimal(totalActualMins);

  let summaryHtml = `<span><span class="ss-val">${scheduledH}h</span> planned</span>`;
  summaryHtml += `<span><span class="ss-val">${actualH}h</span> worked</span>`;
  if (totalScheduledMins > 0) {
    summaryHtml += `<span class="ss-pct ${pctClass}">${pctRaw}%</span>`;
  }
  if (totalModifications > 0) {
    summaryHtml += `<span class="ss-mods">${totalModifications} modification${totalModifications !== 1 ? 's' : ''}</span>`;
  }
  summaryEl.innerHTML = summaryHtml;

  // Group dates into Sun-Sat weeks
  const weeks = [];
  let currentWeek = null;
  for (const date of dates) {
    const weekSun = getWeekSunday(date);
    if (!currentWeek || currentWeek.sunday !== weekSun) {
      currentWeek = { sunday: weekSun, dates: [], scheduledMins: 0, actualMins: 0, mods: 0 };
      weeks.push(currentWeek);
    }
    currentWeek.dates.push(date);
    const sched = schedMap[date];
    if (sched) {
      currentWeek.scheduledMins += sched.scheduled_minutes;
      currentWeek.mods += sched.modification_count;
    }
    currentWeek.actualMins += (scheduleActuals[date] || 0);
  }

  // Grid rows grouped by week
  const gridEl = document.getElementById('scheduleGrid');
  let html = '';

  for (const week of weeks) {
    // Week header
    const sunDate = new Date(week.sunday + 'T12:00:00');
    const satDate = new Date(sunDate);
    satDate.setDate(sunDate.getDate() + 6);
    const sunLabel = sunDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const satLabel = satDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const modsLabel = week.mods > 0 ? `${week.mods} change${week.mods !== 1 ? 's' : ''}` : '';
    html += `<div class="schedule-week-header">
      <span>Week of ${sunLabel} – ${satLabel}</span>
      <span>${modsLabel}</span>
    </div>`;

    // Day rows for this week
    for (const date of week.dates) {
      const sched = schedMap[date];
      const isToday = date === today;
      const dayLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const startVal = sched ? sched.start_time.slice(0, 5) : '';
      const endVal = sched ? sched.end_time.slice(0, 5) : '';
      const plannedMins = sched ? sched.scheduled_minutes : 0;
      const actualMins = scheduleActuals[date] || 0;
      const plannedLabel = plannedMins > 0 ? HoursService.formatDuration(plannedMins) : '';
      const actualLabel = actualMins > 0 ? HoursService.formatDuration(actualMins) : (plannedMins > 0 ? '0m' : '');
      const actualClass = plannedMins > 0
        ? (actualMins >= plannedMins ? 'met' : (actualMins > 0 ? 'partial' : 'none'))
        : 'none';

      html += `<div class="schedule-row">
        <span class="sr-date${isToday ? ' today' : ''}">${dayLabel}</span>
        <input type="time" data-date="${date}" data-field="start" value="${startVal}">
        <span class="sr-arrow">&rarr;</span>
        <input type="time" data-date="${date}" data-field="end" value="${endVal}">
        <span class="sr-planned">${plannedLabel}</span>
        <span class="sr-actual ${actualClass}">${actualLabel}</span>
      </div>`;
    }

    // Week subtotal row
    if (week.scheduledMins > 0 || week.actualMins > 0) {
      html += `<div class="schedule-week-totals">
        <span class="swt-label">Week total:</span>
        <span class="swt-hours">${HoursService.formatDuration(week.scheduledMins)} planned</span>
        <span class="swt-hours">${HoursService.formatDuration(week.actualMins)} worked</span>
      </div>`;
    }
  }

  gridEl.innerHTML = html;
}

async function saveSchedule() {
  const btn = document.getElementById('btnSaveSchedule');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const dates = getScheduleDates();
    const rows = [];

    for (const date of dates) {
      const startInput = document.querySelector(`input[data-date="${date}"][data-field="start"]`);
      const endInput = document.querySelector(`input[data-date="${date}"][data-field="end"]`);
      const startTime = startInput?.value || '';
      const endTime = endInput?.value || '';

      if (startTime && endTime) {
        // Compute minutes
        const [sh, sm] = startTime.split(':').map(Number);
        const [eh, em] = endTime.split(':').map(Number);
        const scheduledMinutes = (eh * 60 + em) - (sh * 60 + sm);

        if (scheduledMinutes <= 0) {
          showToast(`Invalid times for ${HoursService.formatDate(date)} — end must be after start`, 'error');
          btn.disabled = false;
          btn.textContent = 'Save Schedule';
          return;
        }

        rows.push({
          schedule_date: date,
          start_time: startTime + ':00',
          end_time: endTime + ':00',
          scheduled_minutes: scheduledMinutes
        });
      } else {
        // Clear row
        rows.push({ schedule_date: date, start_time: '', end_time: '', scheduled_minutes: 0 });
      }
    }

    await hoursService.upsertSchedule(profile.id, rows);
    showToast('Schedule saved!', 'success');
    await loadSchedule();
  } catch (err) {
    showToast('Failed to save schedule: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Schedule';
  }
}

// =============================================
// COWORKERS TAB
// =============================================
async function refreshCoworkers() {
  const container = document.getElementById('coworkersList');
  try {
    const groups = await hoursService.getMyGroups(profile.id);

    if (!groups.length) {
      container.innerHTML = `<div class="cw-empty">
        <div class="cw-icon">👥</div>
        <div class="cw-text">No work group</div>
        <div class="cw-sub">Ask your admin to add you to a work group to see coworkers' schedules.</div>
      </div>`;
      return;
    }

    // Get current week Sun-Sat
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const dayOfWeek = today.getDay(); // 0=Sun
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - dayOfWeek);
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    const sunStr = sunday.toISOString().split('T')[0];
    const satStr = saturday.toISOString().split('T')[0];

    // Build week date array
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      weekDates.push(d.toISOString().split('T')[0]);
    }
    const dayAbbrevs = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    let html = '';

    for (const group of groups) {
      const members = group.members || [];
      if (!members.length) continue;

      const associateIds = members.map(m => m.associate_id);

      // Fetch schedules and actuals for all members this week
      const [schedules, actuals] = await Promise.all([
        hoursService.getGroupSchedules(associateIds, sunStr, satStr),
        hoursService.getGroupActuals(associateIds, sunStr, satStr)
      ]);

      // Index schedules by associate_id → date
      const schedByAssoc = {};
      for (const s of schedules) {
        if (!schedByAssoc[s.associate_id]) schedByAssoc[s.associate_id] = {};
        schedByAssoc[s.associate_id][s.schedule_date] = s;
      }

      // Index actuals by associate_id → date (sum minutes)
      const actualsByAssoc = {};
      for (const a of actuals) {
        const date = a.clock_in.split('T')[0];
        if (!actualsByAssoc[a.associate_id]) actualsByAssoc[a.associate_id] = {};
        actualsByAssoc[a.associate_id][date] = (actualsByAssoc[a.associate_id][date] || 0) + parseFloat(a.duration_minutes);
      }

      html += `<div class="cw-group">`;
      html += `<div class="cw-group-name">${escapeHtml(group.name)}</div>`;

      for (const member of members) {
        const assocId = member.associate_id;
        const appUser = member.associate?.app_user;
        const name = appUser?.display_name || appUser?.first_name || 'Unknown';
        const isYou = assocId === profile.id;
        const memberScheds = schedByAssoc[assocId] || {};
        const memberActuals = actualsByAssoc[assocId] || {};

        // Compute week totals
        let weekSchedMins = 0, weekActualMins = 0, weekMods = 0;
        for (const date of weekDates) {
          const sched = memberScheds[date];
          if (sched) { weekSchedMins += sched.scheduled_minutes; weekMods += sched.modification_count; }
          weekActualMins += (memberActuals[date] || 0);
        }

        const pctRaw = weekSchedMins > 0 ? Math.round((weekActualMins / weekSchedMins) * 100) : 0;
        const pctClass = weekSchedMins === 0 ? '' : (pctRaw >= 90 ? 'green' : (pctRaw >= 50 ? 'yellow' : 'red'));
        const schedH = HoursService.formatHoursDecimal(weekSchedMins);
        const actualH = HoursService.formatHoursDecimal(weekActualMins);

        // Day cells
        const daysHtml = weekDates.map((date, i) => {
          const sched = memberScheds[date];
          const actualMins = memberActuals[date] || 0;
          const schedMins = sched ? sched.scheduled_minutes : 0;
          const isToday = date === todayStr;

          let statusIcon = '';
          let dayClass = 'none';

          if (schedMins > 0) {
            if (actualMins >= schedMins) { dayClass = 'met'; statusIcon = '✓'; }
            else if (actualMins > 0) { dayClass = 'partial'; statusIcon = '◐'; }
            else {
              // Only mark as missed if the date is in the past
              if (date < todayStr) { dayClass = 'missed'; statusIcon = '✗'; }
              else { dayClass = 'none'; statusIcon = '◌'; }
            }
          }

          const hoursLabel = schedMins > 0 ? HoursService.formatDuration(schedMins) : '—';

          return `<div class="cw-day ${dayClass}${isToday ? ' today' : ''}">
            <span class="cw-d-label">${dayAbbrevs[i]}</span>
            <span class="cw-d-hours">${hoursLabel}</span>
            ${statusIcon ? `<span class="cw-d-status">${statusIcon}</span>` : ''}
          </div>`;
        }).join('');

        const modsHtml = weekMods > 0 ? `<div class="cw-mods">${weekMods} schedule change${weekMods !== 1 ? 's' : ''} this week</div>` : '';

        html += `<div class="cw-card">
          <div class="cw-card-header">
            <span class="cw-name${isYou ? ' is-you' : ''}">${escapeHtml(name)}${isYou ? ' (you)' : ''}</span>
            <div class="cw-week-stats">
              <span>${schedH}h sched</span>
              <span>${actualH}h actual</span>
              ${weekSchedMins > 0 ? `<span class="cw-pct ${pctClass}">${pctRaw}%</span>` : ''}
            </div>
          </div>
          <div class="cw-days">${daysHtml}</div>
          ${modsHtml}
        </div>`;
      }

      html += `</div>`;
    }

    container.innerHTML = html || `<div class="cw-empty">
      <div class="cw-icon">👥</div>
      <div class="cw-text">No coworkers in your group yet</div>
    </div>`;
  } catch (err) {
    console.error('Failed to load coworkers:', err);
    container.innerHTML = `<div class="cw-empty"><div class="cw-text">Failed to load coworkers</div></div>`;
  }
}

// =============================================
// TOAST (delegates to associate-shell.js)
// =============================================
function showToast(message, type = 'info', duration = 4000) {
  shellShowToast(message, type, duration);
}

// =============================================
// HELPERS
// =============================================
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
