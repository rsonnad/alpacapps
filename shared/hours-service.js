/**
 * Hours Service
 * Business logic for associate time tracking, work photos, and payment integration.
 */

import { supabase } from './supabase.js';
import { accountingService, DIRECTION, PAYMENT_METHOD_LABELS } from './accounting-service.js';

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
  async getOrCreateProfile(appUserId) {
    // Try to fetch existing
    const { data: existing, error: fetchErr } = await supabase
      .from('associate_profiles')
      .select('*')
      .eq('app_user_id', appUserId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (existing) return existing;

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
      .select('*, app_user:app_user_id(id, email, display_name, first_name, last_name, person_id)')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  // ---- Time Entry Management ----

  /**
   * Clock in — create a new time entry
   */
  async clockIn(associateId, { lat, lng } = {}) {
    // Get current rate from profile
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
      clock_in_lng: lng || null
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
   * Clock out — update an existing time entry with end time and duration
   */
  async clockOut(entryId, { lat, lng, description } = {}) {
    const clockOut = new Date();

    // Fetch the entry to compute duration
    const { data: entry, error: fetchErr } = await supabase
      .from('time_entries')
      .select('clock_in')
      .eq('id', entryId)
      .single();

    if (fetchErr) throw fetchErr;

    const clockIn = new Date(entry.clock_in);
    const durationMs = clockOut - clockIn;
    const durationMinutes = Math.round(durationMs / 60000);

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
   */
  async createManualEntry(associateId, { clockIn, clockOut, description, manualReason, hourlyRate }) {
    const ciDate = new Date(clockIn);
    const coDate = new Date(clockOut);
    const durationMs = coDate - ciDate;
    if (durationMs <= 0) throw new Error('Clock out must be after clock in');
    const durationMinutes = Math.round(durationMs / 60000);

    const entry = {
      associate_id: associateId,
      clock_in: ciDate.toISOString(),
      clock_out: coDate.toISOString(),
      duration_minutes: durationMinutes,
      hourly_rate: hourlyRate,
      description: description || null,
      is_manual: true,
      manual_reason: manualReason || null
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
      .select('*, associate:associate_id(id, app_user_id, hourly_rate, payment_method, payment_handle, app_user:app_user_id(id, email, display_name, first_name, last_name))')
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
   * Update a time entry (admin - manual edits)
   */
  async updateEntry(entryId, updates) {
    const allowed = {};
    if (updates.clock_in !== undefined) allowed.clock_in = updates.clock_in;
    if (updates.clock_out !== undefined) allowed.clock_out = updates.clock_out;
    if (updates.description !== undefined) allowed.description = updates.description;
    if (updates.hourly_rate !== undefined) allowed.hourly_rate = updates.hourly_rate;
    allowed.updated_at = new Date().toISOString();

    // Recompute duration if both clock_in and clock_out present
    if (allowed.clock_in || allowed.clock_out) {
      // Fetch current values for any we're not updating
      const { data: current } = await supabase
        .from('time_entries')
        .select('clock_in, clock_out')
        .eq('id', entryId)
        .single();

      const ci = new Date(allowed.clock_in || current.clock_in);
      const co = allowed.clock_out ? new Date(allowed.clock_out) : (current.clock_out ? new Date(current.clock_out) : null);
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
    return data;
  }

  /**
   * Create a manual time entry (admin)
   */
  async createManualEntry(associateId, { clockIn, clockOut, description, hourlyRate }) {
    const ci = new Date(clockIn);
    const co = clockOut ? new Date(clockOut) : null;
    const durationMinutes = co ? Math.round((co - ci) / 60000) : null;

    // Use provided rate or fetch from profile
    let rate = hourlyRate;
    if (rate === undefined || rate === null) {
      const { data: profile } = await supabase
        .from('associate_profiles')
        .select('hourly_rate')
        .eq('id', associateId)
        .single();
      rate = profile.hourly_rate;
    }

    const { data, error } = await supabase
      .from('time_entries')
      .insert({
        associate_id: associateId,
        clock_in: ci.toISOString(),
        clock_out: co ? co.toISOString() : null,
        duration_minutes: durationMinutes,
        hourly_rate: rate,
        description: description || null
      })
      .select()
      .single();

    if (error) throw error;
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
      const date = entry.clock_in.split('T')[0];
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
    const dates = entries.map(e => e.clock_in.split('T')[0]).sort();
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
   * Create a work photo record (after media is uploaded via media-service)
   */
  async createWorkPhoto({ associateId, mediaId, timeEntryId, photoType, caption, workDate }) {
    const { data, error } = await supabase
      .from('work_photos')
      .insert({
        associate_id: associateId,
        media_id: mediaId,
        time_entry_id: timeEntryId || null,
        photo_type: photoType || 'progress',
        caption: caption || null,
        work_date: workDate || new Date().toISOString().split('T')[0]
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
      .select('*, media:media_id(id, url, caption)')
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

  // ---- Utility ----

  /**
   * Format minutes as "Xh Ym"
   */
  static formatDuration(minutes) {
    if (!minutes || minutes <= 0) return '0m';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
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
    return new Date(isoString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  /**
   * Format date from ISO string to readable (e.g., "Mon, Jan 17")
   */
  static formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T12:00:00'));
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  /**
   * Format date as full date (e.g., "Monday, January 17, 2025")
   */
  static formatDateFull(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T12:00:00'));
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
}

export const hoursService = new HoursService();
export { HoursService };
