// Ninja Workshop Signups — list who signed up; show when closed (6 spots)

import { supabase } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';

const EVENT_ID = 'ai-ninja-workshop-2026-03-09';
const MAX_SPOTS = 6;

let loaded = false;

document.addEventListener('DOMContentLoaded', async () => {
  await initAdminPage({
    activeTab: 'ninjasignups',
    requiredRole: 'staff',
    section: 'staff',
    onReady: () => { if (!loaded) { loaded = true; loadSignups(); } },
  });
  // Fallback: if onReady never fired (async auth race), load anyway
  if (!loaded) { loaded = true; loadSignups(); }
});

async function loadSignups() {
  const tbody = document.getElementById('ninjaSignupsBody');
  const lead = document.getElementById('ninjaStatusLead');

  try {
    const { data: rows, error } = await supabase
      .from('event_rsvps')
      .select('id, name, email, phone, goals, status, submitted_at')
      .eq('event', EVENT_ID)
      .order('submitted_at', { ascending: true });

    if (error) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-aap-error">${error.message}</td></tr>`;
      lead.textContent = 'Error loading signups.';
      return;
    }

    const confirmed = (rows || []).filter((r) => r.status === 'confirmed');
    const waitlist = (rows || []).filter((r) => r.status === 'waitlist');
    const interest = (rows || []).filter((r) => r.status === 'interest');
    const rsvpRows = (rows || []).filter((r) => r.status !== 'interest');
    const closed = confirmed.length >= MAX_SPOTS;

    if (closed) {
      lead.textContent = `Registration closed — ${confirmed.length} spots filled. ${waitlist.length} on waitlist. ${interest.length} AI-interest signups.`;
      lead.classList.remove('text-muted');
      lead.classList.add('text-aap-amber');
    } else {
      lead.textContent = `${confirmed.length} of ${MAX_SPOTS} spots filled. ${waitlist.length} on waitlist. ${interest.length} AI-interest signups.`;
    }

    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: #999; padding: 1.5rem;">No signups yet.</td></tr>';
      return;
    }

    tbody.innerHTML = rsvpRows
      .map((r, i) => {
        const submitted = r.submitted_at
          ? new Date(r.submitted_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
          : '—';
        const listBadge = r.status === 'waitlist'
          ? '<span class="status-badge" style="background:#f59e0b;color:#fff">Waitlist</span>'
          : '<span class="status-badge">Confirmed</span>';
        const goals = (r.goals || '').trim().slice(0, 80);
        const goalsCell = goals ? (goals.length >= 80 ? goals + '…' : goals) : '—';
        return `
          <tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(r.name || '—')}</td>
            <td>${escapeHtml(r.email || '—')}</td>
            <td>${escapeHtml(r.phone || '—')}</td>
            <td style="max-width:220px;">${escapeHtml(goalsCell)}</td>
            <td>${listBadge}</td>
            <td>${escapeHtml(submitted)}</td>
          </tr>`;
      })
      .join('');

    // ── AI-Interest section ──
    const interestTbody = document.getElementById('ninjaInterestBody');
    const interestCount = document.getElementById('ninjaInterestCount');
    if (interestTbody) {
      if (interestCount) interestCount.textContent = interest.length;
      if (interest.length === 0) {
        interestTbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color: #999; padding: 1rem;">No AI-interest signups yet.</td></tr>';
      } else {
        interestTbody.innerHTML = interest
          .map((r, i) => {
            const submitted = r.submitted_at
              ? new Date(r.submitted_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
              : '—';
            return `
              <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(r.email || '—')}</td>
                <td>${escapeHtml(submitted)}</td>
              </tr>`;
          })
          .join('');
      }
    }
  } catch (e) {
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="7" class="text-aap-error">${escapeHtml(String(e))}</td></tr>`;
    lead.textContent = 'Error loading signups.';
    showToast('Error loading signups', 'error');
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
