/**
 * Hours Service
 * Business logic for associate time tracking, work photos, and payment integration.
 */

import { supabase } from './supabase.js';
import { accountingService, DIRECTION, PAYMENT_METHOD_LABELS } from './accounting-service.js';
import { AUSTIN_TIMEZONE } from './timezone.js';

// =============================================
// CONSTANTS
// =============================================
export const PHOTO_TYPES = {
  BEFORE: 'before',
  AFTER: 'after',
  PROGRESS: 'progress'
};

export const PHOTO_TYPE_LABELS = {
  before: 'Before',
  after: 'After',
  progress: 'Progress'
};

// =============================================
// HOURS SERVICE
// =============================================
class HoursService {

  // ---- Profile Management ----

  /**
   * Get or create an associate profile for a given app_user
   */
  async getOrCreateProfile(appUserId, userRole) {
    // Try to fetch existing
    const { data: existing, error: fetchErr } = await supabase
      .from('associate_profiles')
      .select('*')
      .eq('app_user_id', appUserId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (existing) return existing;

    // Auto-create for associates and staff who access the hours page
    if (!['associate', 'staff'].includes(userRole)) return null;

    // Create new profile
    const { data: created, error: createErr } = await supabase
      .from('associate_profiles')
      .insert({ app_user_id: appUserId })
      .select()
      .single();

    if (createErr) throw createErr;
    return created;
  }

  /**
   * Get profile by associate_profiles.id
   */
  async getProfile(profileId) {
    const { data, error } = await supabase
      .from('associate_profiles')
      .select('*, app_user:app_user_id(id, email, display_name, first_name, last_name, person_id)')
      .eq('id', profileId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get profile by app_user_id
   */
  async getProfileByUserId(appUserId) {
    const { data, error } = await supabase
      .from('associate_profiles')
      .select('*, app_user:app_user_id(id, email, display_name, first_name, last_name, person_id)')
      .eq('app_user_id', appUserId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Update associate profile (rate, payment info, notes)
   */
  async updateProfile(profileId, updates) {
    const allowed = {};
    if (updates.hourly_rate !== undefined) allowed.hourly_rate = updates.hourly_rate;
    if (updates.payment_method !== undefined) allowed.payment_method = updates.payment_method;
    if (updates.payment_handle !== undefined) allowed.payment_handle = updates.payment_handle;
    if (updates.is_active !== undefined) allowed.is_active = updates.is_active;
    if (updates.notes !== undefined) allowed.notes = updates.notes;
    allowed.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('associate_profiles')
      .update(allowed)
      .eq('id', profileId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get all associate profiles (admin view)
   */
  async getAllAssociates() {
    const { data, error } = await supabase
      .from('associate_profiles')
      .select('*, app_user:app_user_id(id, email, display_name, first_name, last_name, person_id, role)')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get all app_users who do NOT yet have an associate_profiles row.
   * Returns users eligible to be added as associates.
   */
  async getEligibleUsers() {
    // Get all app_users
    const { data: allUsers, error: usersErr } = await supabase
      .from('app_users')
      .select('id, email, display_name, first_name, last_name, role, auth_user_id')
      .order('display_name');

    if (usersErr) throw usersErr;

    // Get existing associate app_user_ids
    const { data: existing, error: existErr } = await supabase
      .from('associate_profiles')
      .select('app_user_id');

    if (existErr) throw existErr;

    const existingSet = new Set((existing || []).map(e => e.app_user_id));

    return (allUsers || []).filter(u =>
      !existingSet.has(u.id) && u.email !== 'bot@alpacaplayhouse.com' && u.role !== 'demo'
    );
  }

  /**
   * Create an associate profile for a given app_user (admin action)
   */
  async createProfile(appUserId, { hourlyRate = 0 } = {}) {
    const { data, error } = await supabase
      .from('associate_profiles')
      .insert({ app_user_id: appUserId, hourly_rate: hourlyRate })
      .select('*, app_user:app_user_id(id, email, display_name, first_name, last_name, person_id, role)')
      .single();

    if (error) throw error;
    return data;
  }

  // ---- Time Entry Management ----

  /**
   * Clock in — create a new time entry.
   * #3 race-safety: reject if an open entry already exists. The DB also
   * enforces this via `idx_time_entries_one_open_per_associate`, but the
   * explicit pre-check gives a friendly error and avoids a DB conflict.
   */
  async clockIn(associateId, { lat, lng, spaceId, taskId } = {}) {
    const existingOpen = await this.getActiveEntry(associateId);
    if (existingOpen) {
      const err = new Error('You are already clocked in. Clock out first before clocking in again.');
      err.code = 'already_clocked_in';
      err.existing_entry_id = existingOpen.id;
      throw err;
    }

    const { data: profile, error: profileErr } = await supabase
      .from('associate_profiles')
      .select('hourly_rate')
      .eq('id', associateId)
      .single();

    if (profileErr) throw profileErr;

    const entry = {
      associate_id: associateId,
      clock_in: new Date().toISOString(),
      hourly_rate: profile.hourly_rate,
      clock_in_lat: lat || null,
      clock_in_lng: lng || null,
      space_id: spaceId || null,
      task_id: taskId || null
    };

    const { data, error } = await supabase
      .from('time_entries')
      .insert(entry)
      .select()
      .single();

    if (error) {
      // Friendly message if the unique partial index fired (race we lost).
      if (error.code === '23505' || /unique/i.test(error.message || '')) {
        const friendly = new Error('You are already clocked in. Refresh the page and try again.');
        friendly.code = 'already_clocked_in';
        throw friendly;
      }
      throw error;
    }
    return data;
  }

  /**
   * Clock out — close an open entry using DB-side `now()` for the timestamp
   * so the server clock (UTC) is authoritative and not the browser. The
   * legacy browser-Date path remains as a fallback when the RPC isn't
   * deployed yet.
   */
  async clockOut(entryId, { lat, lng, description } = {}) {
    // #15 Try the server-clock RPC first.
    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('clock_out_server_time', {
        p_entry_id: entryId,
        p_lat: lat || null,
        p_lng: lng || null,
        p_description: description ?? null,
      });
      if (!rpcErr && rpcData) return Array.isArray(rpcData) ? rpcData[0] : rpcData;
      // fall through on RPC missing
    } catch (_e) { /* fall through */ }

    const clockOut = new Date();
    const { data: entry, error: fetchErr } = await supabase
      .from('time_entries')
      .select('clock_in')
      .eq('id', entryId)
      .single();
    if (fetchErr) throw fetchErr;
    const clockIn = new Date(entry.clock_in);
    const durationMinutes = Math.round((clockOut - clockIn) / 60000);

    const updates = {
      clock_out: clockOut.toISOString(),
      duration_minutes: durationMinutes,
      clock_out_lat: lat || null,
      clock_out_lng: lng || null,
      updated_at: clockOut.toISOString()
    };
    if (description !== undefined) updates.description = description;

    const { data, error } = await supabase
      .from('time_entries')
      .update(updates)
      .eq('id', entryId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Create a manual time entry (not from live clock in/out)
   * Used by both associate page (with manualReason) and admin page (without)
   */
  async createManualEntry(associateId, { clockIn, clockOut, description, manualReason, hourlyRate, spaceId, taskId } = {}) {
    const ciDate = new Date(clockIn);
    const coDate = clockOut ? new Date(clockOut) : null;
    const durationMinutes = coDate ? Math.round((coDate - ciDate) / 60000) : null;

    if (coDate && coDate <= ciDate) throw new Error('Clock out must be after clock in');
    // #24 manual_reason min length matches the DB CHECK constraint.
    if (!manualReason || manualReason.trim().length < 10) {
      throw new Error('Please describe why this manual entry is being added (10 characters or more).');
    }

    // Use provided rate or fetch from profile
    let rate = hourlyRate;
    if (rate === undefined || rate === null) {
      const { data: profile } = await supabase
        .from('associate_profiles')
        .select('hourly_rate')
        .eq('id', associateId)
        .single();
      rate = profile?.hourly_rate || 0;
    }

    const entry = {
      associate_id: associateId,
      clock_in: ciDate.toISOString(),
      clock_out: coDate ? coDate.toISOString() : null,
      duration_minutes: durationMinutes,
      hourly_rate: rate,
      description: description || null,
      is_manual: true,
      manual_reason: manualReason || null,
      space_id: spaceId || null,
      task_id: taskId || null
    };

    const { data, error } = await supabase
      .from('time_entries')
      .insert(entry)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get the currently active (clocked-in, not clocked-out) entry for an associate
   */
  async getActiveEntry(associateId) {
    const { data, error } = await supabase
      .from('time_entries')
      .select('*')
      .eq('associate_id', associateId)
      .is('clock_out', null)
      .order('clock_in', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Get time entries for an associate within a date range
   */
  async getEntries(associateId, { dateFrom, dateTo, isPaid } = {}) {
    let query = supabase
      .from('time_entries')
      .select('*')
      .eq('associate_id', associateId)
      .order('clock_in', { ascending: false });

    if (dateFrom) query = query.gte('clock_in', `${dateFrom}T00:00:00`);
    if (dateTo) query = query.lte('clock_in', `${dateTo}T23:59:59`);
    if (isPaid !== undefined) query = query.eq('is_paid', isPaid);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /**
   * Get entries for ALL associates (admin) with profile info
   */
  async getAllEntries({ dateFrom, dateTo, associateId, isPaid } = {}) {
    let query = supabase
      .from('time_entries')
      .select('*, associate:associate_id(id, app_user_id, hourly_rate, payment_method, payment_handle, app_user:app_user_id(id, email, display_name, first_name, last_name)), space:space_id(id, name), task:task_id(id, title)')
      .order('clock_in', { ascending: false });

    if (dateFrom) query = query.gte('clock_in', `${dateFrom}T00:00:00`);
    if (dateTo) query = query.lte('clock_in', `${dateTo}T23:59:59`);
    if (associateId) query = query.eq('associate_id', associateId);
    if (isPaid !== undefined) query = query.eq('is_paid', isPaid);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /**
   * Update a time entry (admin or owner). RLS blocks cross-associate
   * writes; this method also auto-logs the diff to `time_entry_edits`
   * (#12) using the caller's app_user_id for the audit trail.
   */
  async updateEntry(entryId, updates, { editedBy = null } = {}) {
    // Fetch the current row so we can (a) diff for the audit log and
    // (b) recompute duration if a timestamp changed.
    const { data: before, error: beforeErr } = await supabase
      .from('time_entries')
      .select('clock_in, clock_out, description, hourly_rate, space_id')
      .eq('id', entryId)
      .single();
    if (beforeErr) throw beforeErr;

    const allowed = {};
    if (updates.clock_in !== undefined) allowed.clock_in = updates.clock_in;
    if (updates.clock_out !== undefined) allowed.clock_out = updates.clock_out;
    if (updates.description !== undefined) allowed.description = updates.description;
    if (updates.hourly_rate !== undefined) allowed.hourly_rate = updates.hourly_rate;
    if (updates.space_id !== undefined) allowed.space_id = updates.space_id;
    allowed.updated_at = new Date().toISOString();

    if (allowed.clock_in || allowed.clock_out) {
      const ci = new Date(allowed.clock_in || before.clock_in);
      const co = allowed.clock_out ? new Date(allowed.clock_out) : (before.clock_out ? new Date(before.clock_out) : null);
      if (co) {
        allowed.duration_minutes = Math.round((co - ci) / 60000);
      }
    }

    const { data, error } = await supabase
      .from('time_entries')
      .update(allowed)
      .eq('id', entryId)
      .select()
      .single();

    if (error) throw error;

    // #12 Auto-log every field that actually changed. Resolve editedBy
    // from the current session if the caller didn't pass it.
    let actor = editedBy;
    if (!actor) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          const { data: appUser } = await supabase
            .from('app_users')
            .select('id')
            .eq('auth_user_id', session.user.id)
            .maybeSingle();
          actor = appUser?.id || null;
        }
      } catch (_e) { /* best-effort */ }
    }
    if (actor) {
      const changes = {};
      for (const f of ['clock_in', 'clock_out', 'description', 'hourly_rate', 'space_id']) {
        if (allowed[f] !== undefined && String(before[f] ?? '') !== String(allowed[f] ?? '')) {
          changes[f] = { oldVal: before[f], newVal: allowed[f] };
        }
      }
      if (Object.keys(changes).length > 0) {
        try { await this.logEdit(entryId, actor, changes); } catch (_e) { /* non-fatal */ }
      }
    }

    return data;
  }

  /**
   * Delete a time entry (admin only)
   */
  async deleteEntry(entryId) {
    const { error } = await supabase
      .from('time_entries')
      .delete()
      .eq('id', entryId);

    if (error) throw error;
  }

  // ---- History & Summaries ----

  /**
   * Get entries grouped by day for an associate
   */
  async getHistory(associateId, { dateFrom, dateTo, isPaid } = {}) {
    const entries = await this.getEntries(associateId, { dateFrom, dateTo, isPaid });
    return this._groupByDay(entries);
  }

  /**
   * Group entries by day, computing totals per day
   */
  _groupByDay(entries) {
    const days = {};

    for (const entry of entries) {
      // Convert UTC timestamp to Austin date (YYYY-MM-DD) to group by local day
      const date = new Date(entry.clock_in).toLocaleDateString('en-CA', { timeZone: AUSTIN_TIMEZONE });
      if (!days[date]) {
        days[date] = { date, entries: [], totalMinutes: 0, totalAmount: 0, hasPaid: false, hasUnpaid: false };
      }
      days[date].entries.push(entry);
      const mins = parseFloat(entry.duration_minutes) || 0;
      days[date].totalMinutes += mins;
      days[date].totalAmount += (mins / 60) * parseFloat(entry.hourly_rate);
      if (entry.is_paid) days[date].hasPaid = true;
      else days[date].hasUnpaid = true;
    }

    return Object.values(days).sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * Get unpaid summary for an associate
   */
  async getUnpaidSummary(associateId) {
    const entries = await this.getEntries(associateId, { isPaid: false });
    let totalMinutes = 0;
    let totalAmount = 0;

    for (const entry of entries) {
      if (!entry.clock_out) continue; // skip active entries
      const mins = parseFloat(entry.duration_minutes) || 0;
      totalMinutes += mins;
      totalAmount += (mins / 60) * parseFloat(entry.hourly_rate);
    }

    return { totalMinutes, totalAmount, totalHours: totalMinutes / 60, count: entries.length, entries };
  }

  /**
   * Get overall summary stats for an associate
   */
  async getAssociateSummary(associateId, { dateFrom, dateTo } = {}) {
    const entries = await this.getEntries(associateId, { dateFrom, dateTo });
    let totalMinutes = 0;
    let totalAmount = 0;
    let paidAmount = 0;
    let unpaidAmount = 0;

    for (const entry of entries) {
      const mins = parseFloat(entry.duration_minutes) || 0;
      totalMinutes += mins;
      const amt = (mins / 60) * parseFloat(entry.hourly_rate);
      totalAmount += amt;
      if (entry.is_paid) paidAmount += amt;
      else unpaidAmount += amt;
    }

    return { totalMinutes, totalHours: totalMinutes / 60, totalAmount, paidAmount, unpaidAmount, entryCount: entries.length };
  }

  // ---- Payment Integration ----

  /**
   * Mark time entries as paid — creates a ledger entry and links it
   */
  async markPaid(entryIds, { paymentMethod, notes, personId, personName } = {}) {
    // Fetch entries to compute total
    const { data: entries, error: fetchErr } = await supabase
      .from('time_entries')
      .select('*, associate:associate_id(app_user_id, payment_method, app_user:app_user_id(display_name, first_name, last_name, person_id))')
      .in('id', entryIds);

    if (fetchErr) throw fetchErr;
    if (!entries || entries.length === 0) throw new Error('No entries found');

    // Compute total
    let totalAmount = 0;
    let totalMinutes = 0;
    for (const entry of entries) {
      const mins = parseFloat(entry.duration_minutes) || 0;
      totalMinutes += mins;
      totalAmount += (mins / 60) * parseFloat(entry.hourly_rate);
    }

    // Determine date range
    const dates = entries.map(e => new Date(e.clock_in).toLocaleDateString('en-CA', { timeZone: AUSTIN_TIMEZONE })).sort();
    const periodStart = dates[0];
    const periodEnd = dates[dates.length - 1];

    // Determine person info
    const assoc = entries[0].associate;
    const appUser = assoc?.app_user;
    const resolvedPersonId = personId || appUser?.person_id || null;
    const resolvedPersonName = personName || appUser?.display_name || `${appUser?.first_name || ''} ${appUser?.last_name || ''}`.trim() || null;
    const resolvedMethod = paymentMethod || assoc?.payment_method || null;

    const totalHours = (totalMinutes / 60).toFixed(2);

    // Create ledger entry
    const ledgerEntry = await accountingService.createTransaction({
      direction: DIRECTION.EXPENSE,
      category: 'associate_payment',
      amount: Math.round(totalAmount * 100) / 100,
      payment_method: resolvedMethod,
      person_id: resolvedPersonId,
      person_name: resolvedPersonName,
      description: `Associate payment: ${totalHours}h (${periodStart} to ${periodEnd})`,
      notes: notes || null,
      status: 'completed',
      recorded_by: 'admin',
      period_start: periodStart,
      period_end: periodEnd
    });

    // Mark all entries as paid with reference to ledger
    const { error: updateErr } = await supabase
      .from('time_entries')
      .update({ is_paid: true, payment_id: ledgerEntry.id, updated_at: new Date().toISOString() })
      .in('id', entryIds);

    if (updateErr) throw updateErr;

    return { ledgerEntry, totalAmount, totalHours: parseFloat(totalHours), entriesUpdated: entries.length };
  }

  // ---- Work Photos ----

  /**
   * Create a work photo record (after media is uploaded via media-service).
   * #16: re-validate the underlying media row's MIME and size — defense
   * in depth in case the upload path slips through (admin tooling, etc.).
   */
  async createWorkPhoto({ associateId, mediaId, timeEntryId, photoType, caption, workDate }) {
    if (mediaId) {
      const { data: media } = await supabase
        .from('media')
        .select('id, mime_type, file_size_bytes')
        .eq('id', mediaId)
        .maybeSingle();
      if (media) {
        const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        const mime = (media.mime_type || '').toLowerCase();
        if (!allowed.includes(mime)) {
          throw new Error(`Photo type ${mime || 'unknown'} is not allowed. Use JPEG, PNG, or WEBP.`);
        }
        if (media.file_size_bytes && media.file_size_bytes > 10 * 1024 * 1024) {
          throw new Error(`Photo is over 10 MB — please re-upload a smaller file.`);
        }
      }
    }
    const { data, error } = await supabase
      .from('work_photos')
      .insert({
        associate_id: associateId,
        media_id: mediaId,
        time_entry_id: timeEntryId || null,
        photo_type: photoType || 'progress',
        caption: caption || null,
        work_date: workDate || new Date().toLocaleDateString('en-CA', { timeZone: AUSTIN_TIMEZONE })
      })
      .select('*, media:media_id(id, url, caption)')
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get work photos for an associate by date range
   */
  async getWorkPhotos(associateId, { dateFrom, dateTo, timeEntryId } = {}) {
    let query = supabase
      .from('work_photos')
      .select('*, media:media_id(id, url, caption, media_type, title, mime_type)')
      .eq('associate_id', associateId)
      .order('created_at', { ascending: false });

    if (dateFrom) query = query.gte('work_date', dateFrom);
    if (dateTo) query = query.lte('work_date', dateTo);
    if (timeEntryId) query = query.eq('time_entry_id', timeEntryId);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /**
   * Get photos for a specific date
   */
  async getPhotosForDate(associateId, date) {
    return this.getWorkPhotos(associateId, { dateFrom: date, dateTo: date });
  }

  /**
   * Delete a work photo record
   */
  async deleteWorkPhoto(photoId) {
    const { error } = await supabase
      .from('work_photos')
      .delete()
      .eq('id', photoId);

    if (error) throw error;
  }

  // ---- Scheduling ----

  /**
   * Get schedule rows for an associate within a date range
   */
  async getSchedule(associateId, dateFrom, dateTo) {
    let query = supabase
      .from('associate_schedules')
      .select('*')
      .eq('associate_id', associateId)
      .order('schedule_date', { ascending: true });

    if (dateFrom) query = query.gte('schedule_date', dateFrom);
    if (dateTo) query = query.lte('schedule_date', dateTo);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /**
   * Upsert schedule rows for an associate.
   * Each row: { schedule_date, start_time, end_time, scheduled_minutes }
   * Increments modification_count if the row already exists and times changed.
   * Deletes rows that are cleared (no times).
   */
  async upsertSchedule(associateId, scheduleRows) {
    // Fetch existing rows to detect changes
    const dates = scheduleRows.map(r => r.schedule_date);
    const { data: existing, error: fetchErr } = await supabase
      .from('associate_schedules')
      .select('*')
      .eq('associate_id', associateId)
      .in('schedule_date', dates);

    if (fetchErr) throw fetchErr;

    const existingMap = {};
    for (const row of (existing || [])) {
      existingMap[row.schedule_date] = row;
    }

    const toUpsert = [];
    const toDelete = [];

    for (const row of scheduleRows) {
      const ex = existingMap[row.schedule_date];

      if (!row.start_time || !row.end_time) {
        // Clear — delete if exists
        if (ex) toDelete.push(ex.id);
        continue;
      }

      const modCount = ex
        ? (ex.start_time !== row.start_time || ex.end_time !== row.end_time
          ? ex.modification_count + 1
          : ex.modification_count)
        : 0;

      toUpsert.push({
        associate_id: associateId,
        schedule_date: row.schedule_date,
        start_time: row.start_time,
        end_time: row.end_time,
        scheduled_minutes: row.scheduled_minutes,
        modification_count: modCount,
        updated_at: new Date().toISOString()
      });
    }

    // Delete cleared rows
    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from('associate_schedules')
        .delete()
        .in('id', toDelete);
      if (delErr) throw delErr;
    }

    // Upsert rows with times
    if (toUpsert.length > 0) {
      const { error: upsertErr } = await supabase
        .from('associate_schedules')
        .upsert(toUpsert, { onConflict: 'associate_id,schedule_date' });
      if (upsertErr) throw upsertErr;
    }

    return { upserted: toUpsert.length, deleted: toDelete.length };
  }

  // ---- Work Groups ----

  /**
   * Get all active work groups (admin view)
   */
  async getWorkGroups() {
    const { data, error } = await supabase
      .from('work_groups')
      .select('*, members:work_group_members(id, associate_id, added_at, associate:associate_id(id, app_user_id, app_user:app_user_id(id, display_name, first_name, last_name, email)))')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    return data || [];
  }

  /**
   * Create a work group (admin)
   */
  async createWorkGroup(name, description) {
    const { data, error } = await supabase
      .from('work_groups')
      .insert({ name, description: description || null })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update a work group (admin)
   */
  async updateWorkGroup(groupId, updates) {
    const allowed = {};
    if (updates.name !== undefined) allowed.name = updates.name;
    if (updates.description !== undefined) allowed.description = updates.description;
    if (updates.is_active !== undefined) allowed.is_active = updates.is_active;
    allowed.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('work_groups')
      .update(allowed)
      .eq('id', groupId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Delete a work group (admin) — CASCADE deletes members
   */
  async deleteWorkGroup(groupId) {
    const { error } = await supabase
      .from('work_groups')
      .delete()
      .eq('id', groupId);

    if (error) throw error;
  }

  /**
   * Add an associate to a work group
   */
  async addGroupMember(groupId, associateId) {
    const { data, error } = await supabase
      .from('work_group_members')
      .insert({ work_group_id: groupId, associate_id: associateId })
      .select('id, associate_id, added_at, associate:associate_id(id, app_user_id, app_user:app_user_id(id, display_name, first_name, last_name, email))')
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Remove an associate from a work group
   */
  async removeGroupMember(groupId, associateId) {
    const { error } = await supabase
      .from('work_group_members')
      .delete()
      .eq('work_group_id', groupId)
      .eq('associate_id', associateId);

    if (error) throw error;
  }

  /**
   * Get work groups the associate belongs to, with all member profiles
   */
  async getMyGroups(associateId) {
    // Find which groups this associate is in
    const { data: memberships, error: memErr } = await supabase
      .from('work_group_members')
      .select('work_group_id')
      .eq('associate_id', associateId);

    if (memErr) throw memErr;
    if (!memberships || memberships.length === 0) return [];

    const groupIds = memberships.map(m => m.work_group_id);

    // Fetch those groups with all members
    const { data, error } = await supabase
      .from('work_groups')
      .select('*, members:work_group_members(id, associate_id, added_at, associate:associate_id(id, app_user_id, app_user:app_user_id(id, display_name, first_name, last_name)))')
      .in('id', groupIds)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    return data || [];
  }

  /**
   * Get schedules for multiple associates within a date range
   */
  async getGroupSchedules(associateIds, dateFrom, dateTo) {
    const { data, error } = await supabase
      .from('associate_schedules')
      .select('*')
      .in('associate_id', associateIds)
      .gte('schedule_date', dateFrom)
      .lte('schedule_date', dateTo)
      .order('schedule_date', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get time entry actuals for multiple associates within a date range (completed only)
   */
  async getGroupActuals(associateIds, dateFrom, dateTo) {
    const { data, error } = await supabase
      .from('time_entries')
      .select('associate_id, clock_in, duration_minutes')
      .in('associate_id', associateIds)
      .gte('clock_in', `${dateFrom}T00:00:00`)
      .lte('clock_in', `${dateTo}T23:59:59`)
      .not('duration_minutes', 'is', null);

    if (error) throw error;
    return data || [];
  }

  // ---- Utility ----

  /**
   * Format minutes as "H:MM" (e.g., 0:00, 1:30, 2:05)
   */
  static formatDuration(minutes) {
    if (!minutes || minutes <= 0) return '0:00';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h}:${String(m).padStart(2, '0')}`;
  }

  /**
   * Format minutes as decimal hours (e.g., 7.50)
   */
  static formatHoursDecimal(minutes) {
    if (!minutes) return '0.00';
    return (minutes / 60).toFixed(2);
  }

  /**
   * Format currency
   */
  static formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  }

  /**
   * Format time from ISO string to local time (e.g., "10:30 AM")
   */
  static formatTime(isoString) {
    if (!isoString) return '';
    return new Date(isoString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: AUSTIN_TIMEZONE });
  }

  /**
   * Format date from ISO string to readable (e.g., "Mon, Jan 17")
   */
  static formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T12:00:00'));
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: AUSTIN_TIMEZONE });
  }

  /**
   * Format date as full date (e.g., "Monday, January 17, 2025")
   */
  static formatDateFull(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T12:00:00'));
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: AUSTIN_TIMEZONE });
  }

  // ---- Edit Audit Trail ----

  /**
   * Log field-level changes to a time entry
   */
  async logEdit(entryId, editedBy, changes) {
    const rows = [];
    for (const [field, { oldVal, newVal }] of Object.entries(changes)) {
      if (String(oldVal || '') !== String(newVal || '')) {
        rows.push({
          time_entry_id: entryId,
          edited_by: editedBy,
          field_changed: field,
          old_value: oldVal != null ? String(oldVal) : null,
          new_value: newVal != null ? String(newVal) : null
        });
      }
    }
    if (!rows.length) return;
    const { error } = await supabase.from('time_entry_edits').insert(rows);
    if (error) console.error('Failed to log edits:', error);
  }

  /**
   * Get edit history for a time entry
   */
  async getEditHistory(entryId) {
    const { data, error } = await supabase
      .from('time_entry_edits')
      .select('*, editor:edited_by(id, display_name, first_name, last_name)')
      .eq('time_entry_id', entryId)
      .order('edited_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  // ---- Edit Requests (admin approval for >10hr additions) ----

  /**
   * Create an edit request that requires admin approval
   */
  async createEditRequest(entryId, requestedBy, proposed, original) {
    const { data, error } = await supabase
      .from('time_entry_edit_requests')
      .insert({
        time_entry_id: entryId,
        requested_by: requestedBy,
        proposed_clock_in: proposed.clock_in,
        proposed_clock_out: proposed.clock_out,
        proposed_description: proposed.description || null,
        proposed_space_id: proposed.space_id || null,
        original_clock_in: original.clock_in,
        original_clock_out: original.clock_out,
        original_duration_minutes: original.duration_minutes
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  /**
   * Get pending edit requests (admin)
   */
  async getEditRequests(status = 'pending') {
    const { data, error } = await supabase
      .from('time_entry_edit_requests')
      .select('*, requester:requested_by(id, display_name, first_name, last_name, email), entry:time_entry_id(id, clock_in, clock_out, duration_minutes, hourly_rate, associate_id)')
      .eq('status', status)
      .order('requested_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  /**
   * Approve or deny an edit request (admin)
   */
  async reviewEditRequest(requestId, reviewedBy, decision) {
    // Update request status
    const { data: request, error: fetchErr } = await supabase
      .from('time_entry_edit_requests')
      .select('*')
      .eq('id', requestId)
      .single();
    if (fetchErr) throw fetchErr;

    const { error: updateErr } = await supabase
      .from('time_entry_edit_requests')
      .update({ status: decision, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
      .eq('id', requestId);
    if (updateErr) throw updateErr;

    // If approved, apply the edit
    if (decision === 'approved') {
      await this.updateEntry(request.time_entry_id, {
        clock_in: request.proposed_clock_in,
        clock_out: request.proposed_clock_out,
        description: request.proposed_description,
        space_id: request.proposed_space_id
      });

      // Log the edit
      await this.logEdit(request.time_entry_id, reviewedBy, {
        clock_in: { oldVal: request.original_clock_in, newVal: request.proposed_clock_in },
        clock_out: { oldVal: request.original_clock_out, newVal: request.proposed_clock_out }
      });
    }

    return { status: decision };
  }
}

export const hoursService = new HoursService();
export { HoursService };
