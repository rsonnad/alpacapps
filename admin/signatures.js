import { supabase } from '../shared/supabase.js';
import { initAdminPage, showToast } from '../shared/admin-shell.js';

let sigData = [];

document.addEventListener('DOMContentLoaded', async () => {
  await initAdminPage({
    activeTab: 'signatures',
    requiredRole: 'admin',
    section: 'admin',
    onReady: async () => {
      bindEvents();
      await loadSignatures();
    },
  });
});

function bindEvents() {
  document.getElementById('refreshBtn')?.addEventListener('click', () => loadSignatures());
}

async function loadSignatures() {
  try {
    const { data, error } = await supabase
      .from('signature_audit_log')
      .select('*')
      .order('signed_at', { ascending: false });

    if (error) throw error;

    sigData = data || [];

    // AA17 #29: compute rentals that have a tenant signature but no
    // landlord countersign yet — surface as a banner so admins can
    // chase them down. The native flow auto-signs the landlord at
    // process-signature time, so any tenant row without a matching
    // landlord row is a failed auto-sign worth investigating.
    const tenantApps = new Set(sigData.filter(r => r.signer_role === 'tenant' && r.rental_application_id).map(r => r.rental_application_id));
    const landlordApps = new Set(sigData.filter(r => r.signer_role === 'landlord' && r.rental_application_id).map(r => r.rental_application_id));
    const awaitingCountersign = [...tenantApps].filter(id => !landlordApps.has(id));

    // Update stats
    document.getElementById('statTotal').textContent = sigData.length;
    document.getElementById('statRentals').textContent = sigData.filter(r => r.document_type === 'rental').length;
    document.getElementById('statEvents').textContent = sigData.filter(r => r.document_type === 'event').length;

    // Awaiting-countersign banner.
    const tbodyAnchor = document.getElementById('sigTableContainer');
    if (tbodyAnchor) {
      const oldBanner = document.getElementById('awaitingCountersignBanner');
      if (oldBanner) oldBanner.remove();
      if (awaitingCountersign.length > 0) {
        const banner = document.createElement('div');
        banner.id = 'awaitingCountersignBanner';
        banner.style.cssText = 'background:#fdf6ee;border-left:4px solid #d4883a;padding:0.9rem 1rem;margin:0 0 1rem;border-radius:6px;font-size:0.9rem;color:#8b6914;';
        banner.innerHTML = `<strong>${awaitingCountersign.length} rental${awaitingCountersign.length === 1 ? '' : 's'} awaiting landlord countersign.</strong>
          <button id="filterAwaitingBtn" type="button" style="margin-left:0.5rem;background:#8b6914;color:#fff;border:none;border-radius:4px;padding:4px 12px;font-size:0.8rem;cursor:pointer;">Show only these</button>`;
        tbodyAnchor.parentElement.insertBefore(banner, tbodyAnchor);
        document.getElementById('filterAwaitingBtn').addEventListener('click', () => {
          // Re-render the table in place with just the awaiting rows.
          const filtered = (data || []).filter(r => awaitingCountersign.includes(r.rental_application_id));
          sigData = filtered;
          renderRows(filtered);
        });
      }
    }
    if (sigData.length > 0) {
      const latest = new Date(sigData[0].signed_at);
      document.getElementById('statLatest').textContent = latest.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
    }

    renderRows(sigData);
  } catch (err) {
    console.error('Failed to load signatures:', err);
    showToast('Failed to load signatures: ' + err.message, 'error');
  }
}

function renderRows(rows) {
  const tbody = document.getElementById('sigTableBody');
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="padding:2rem; text-align:center; color:#999;">No signatures match</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((row, idx) => {
      const signedAt = new Date(row.signed_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
      const hashShort = row.document_hash ? row.document_hash.substring(0, 12) + '...' : '\u2014';
      const roleBadge = row.signer_role === 'landlord'
        ? '<span style="background:#e8f4f0; color:#2e7566; padding:2px 8px; border-radius:4px; font-size:0.75rem;">Landlord</span>'
        : '<span style="background:#f0f0eb; color:#555; padding:2px 8px; border-radius:4px; font-size:0.75rem;">Tenant</span>';
      const typeBadge = row.document_type === 'rental'
        ? '<span style="background:#e8f4f0; color:#3d8b7a; padding:2px 8px; border-radius:4px; font-size:0.75rem;">Rental</span>'
        : '<span style="background:#fff3e0; color:#8b6914; padding:2px 8px; border-radius:4px; font-size:0.75rem;">Event</span>';
      const sigPreview = row.signature_image_url
        ? `<img src="${esc(row.signature_image_url)}" style="max-height:30px; max-width:80px; cursor:pointer; border:1px solid #eee; border-radius:4px;" data-action="view-sig" data-url="${esc(row.signature_image_url)}" title="Click to enlarge">`
        : '\u2014';
      const docBtn = row.document_html
        ? `<button data-action="view-doc" data-idx="${idx}" style="background:#3d8b7a; color:white; border:none; padding:4px 10px; border-radius:4px; font-size:0.75rem; cursor:pointer;">View</button>`
        : '\u2014';

      return `<tr style="border-bottom:1px solid #f0f0eb;">
        <td style="padding:0.6rem 1rem;">
          <div style="font-weight:500;">${esc(row.signer_name)}</div>
          <div style="font-size:0.75rem; color:#888;">${esc(row.signer_email)}</div>
        </td>
        <td style="padding:0.6rem 1rem;">${roleBadge}</td>
        <td style="padding:0.6rem 1rem;">${typeBadge}</td>
        <td style="padding:0.6rem 1rem; white-space:nowrap;">${signedAt}</td>
        <td style="padding:0.6rem 1rem; font-family:monospace; font-size:0.8rem;">${esc(row.ip_address || '\u2014')}</td>
        <td style="padding:0.6rem 1rem; font-family:monospace; font-size:0.8rem;" title="${esc(row.document_hash || '')}">${hashShort}</td>
        <td style="padding:0.6rem 1rem;">${sigPreview}</td>
        <td style="padding:0.6rem 1rem;">${docBtn}</td>
      </tr>`;
  }).join('');

  // Delegate click events for view buttons.
  // Re-binding is idempotent because addEventListener dedupes identical listeners
  // by reference — we use the same `handleSigTableClick` function each time.
  const tbodyEl = document.getElementById('sigTableBody');
  tbodyEl.removeEventListener('click', handleSigTableClick);
  tbodyEl.addEventListener('click', handleSigTableClick);
}

function handleSigTableClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  if (target.dataset.action === 'view-doc') {
    viewDocument(parseInt(target.dataset.idx, 10));
  } else if (target.dataset.action === 'view-sig') {
    viewSignature(target.dataset.url);
  }
}

function viewDocument(index) {
  const row = sigData[index];
  if (!row || !row.document_html) return;
  document.getElementById('docModalContent').innerHTML =
    `<div style="margin-bottom:1rem; padding-bottom:1rem; border-bottom:1px solid #eee; font-size:0.85rem; color:#666;">
      <strong>${esc(row.signer_name)}</strong> &middot; ${esc(row.signer_email)} &middot; ${new Date(row.signed_at).toLocaleString()}
      ${row.document_hash ? `<br>Hash: <code style="font-size:0.75rem;">${esc(row.document_hash)}</code>` : ''}
    </div><iframe title="Signed document" sandbox="" style="width:100%;min-height:60vh;border:0" srcdoc="${escAttr(row.document_html)}"></iframe>`;
  openModal();
}

function viewSignature(url) {
  const content = document.getElementById('docModalContent');
  content.replaceChildren();
  const safeUrl = typeof url === 'string' && /^https:\/\//i.test(url) ? url : '';
  if (!safeUrl) return;
  const wrapper = document.createElement('div');
  wrapper.style.textAlign = 'center';
  const image = document.createElement('img');
  image.src = safeUrl;
  image.alt = 'Signature';
  image.style.cssText = 'max-width:100%;border:1px solid #eee;border-radius:8px;';
  wrapper.appendChild(image);
  content.appendChild(wrapper);
  openModal();
}

function openModal() {
  document.getElementById('docModal').style.display = 'block';
  document.body.style.overflow = 'hidden';
}

function closeDocModal() {
  document.getElementById('docModal').style.display = 'none';
  document.body.style.overflow = '';
}
window.closeDocModal = closeDocModal;

// Close modal on escape or backdrop click
document.getElementById('docModal')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('docModal')) closeDocModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDocModal();
});

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escAttr(s) {
  return esc(s).replace(/'/g, '&#39;');
}
