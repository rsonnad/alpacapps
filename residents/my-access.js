/**
 * My Access — Shows the logged-in resident's door/access codes.
 *
 * Calls the SECURITY DEFINER RPC `get_my_space_codes()` which internally
 * resolves auth.uid() → person_id → active assignments → password_vault,
 * so residents can only ever see codes for their own assigned spaces.
 */
import { initResidentPage, showToast } from '../shared/resident-shell.js';
import { supabase } from '../shared/supabase.js';

document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'my-access',
    requiredRole: 'resident',
    onReady: async () => {
      await loadAccessCodes();
    },
  });
});

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function loadAccessCodes() {
  const list = document.getElementById('accessList');
  if (!list) return;

  const { data, error } = await supabase.rpc('get_my_space_codes');

  if (error) {
    console.error('Failed to fetch access codes:', error);
    list.innerHTML = `<div class="access-empty">Something went wrong loading your codes. Text PAI at <a href="sms:+17377474737">(737) 747-4737</a> for help.</div>`;
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = `
      <div class="access-empty">
        <p style="margin:0 0 0.5rem;"><strong>No codes on file for your space.</strong></p>
        <p style="margin:0 0 0.5rem;">Your space might use a physical key (not a keypad), or you may not have an active assignment yet.</p>
        <p style="margin:0;">Either way, text Jon at <a href="sms:+12396665815">(239) 666-5815</a> or email <a href="mailto:pai@alpacaplayhouse.com">pai@alpacaplayhouse.com</a> and we'll sort it out.</p>
      </div>`;
    return;
  }

  // Group by space_id so multi-code spaces render as a single card.
  const bySpace = new Map();
  for (const row of data) {
    if (!bySpace.has(row.space_id)) {
      bySpace.set(row.space_id, { name: row.space_name, codes: [] });
    }
    bySpace.get(row.space_id).codes.push(row);
  }

  list.innerHTML = [...bySpace.values()]
    .map((space) => {
      const codeRows = space.codes
        .map((c, idx) => {
          const uid = `${escapeHtml(space.name)}-${idx}`;
          const label = c.service || space.name;
          return `
            <div style="margin-top:0.5rem;">
              <div class="service-label"><strong>${escapeHtml(label)}</strong>${c.username ? ` — ${escapeHtml(c.username)}` : ''}</div>
              <div class="access-row">
                <span class="access-code masked" data-code="${escapeHtml(c.password ?? '')}" data-masked="true">••••••••</span>
                <button type="button" class="btn-small" data-action="reveal">Show</button>
                <button type="button" class="btn-small" data-action="copy" data-copy="${escapeHtml(c.password ?? '')}">Copy</button>
              </div>
              ${c.notes ? `<div class="access-notes">${escapeHtml(c.notes)}</div>` : ''}
            </div>`;
        })
        .join('');
      return `
        <div class="access-card">
          <h3>${escapeHtml(space.name)}</h3>
          ${codeRows}
        </div>`;
    })
    .join('');

  // Wire reveal + copy on all rendered rows (event delegation).
  list.addEventListener('click', handleCardClick);
}

function handleCardClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'reveal') {
    const codeEl = btn.parentElement.querySelector('.access-code');
    if (!codeEl) return;
    const isMasked = codeEl.dataset.masked === 'true';
    if (isMasked) {
      codeEl.textContent = codeEl.dataset.code;
      codeEl.classList.remove('masked');
      codeEl.dataset.masked = 'false';
      btn.textContent = 'Hide';
    } else {
      codeEl.textContent = '••••••••';
      codeEl.classList.add('masked');
      codeEl.dataset.masked = 'true';
      btn.textContent = 'Show';
    }
    return;
  }

  if (action === 'copy') {
    const val = btn.dataset.copy;
    if (!val) return;
    navigator.clipboard.writeText(val).then(
      () => showToast('Code copied to clipboard', 'success', 2000),
      () => showToast('Could not copy — reveal and copy manually', 'error', 3000)
    );
  }
}
