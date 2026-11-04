/**
 * Staff → Events → event detail → Cleaning tab.
 *
 * Shows the AI cleanup-exposure estimate and tailored checklist, the host's before/after photos
 * per area with the AI review, lets a cleaning inspector pass/fail the clean (charges come from
 * the event_cleaning_charges SQL function), and sends the deposit refund.
 */
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../shared/supabase.js';
import { showToast, openLightbox } from '../shared/admin-shell.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `$${Number(n || 0).toFixed(2).replace(/\.00$/, '')}`;

async function callFn(name, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session?.access_token}`, apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Build the AI checklist + exposure estimate, set up the host's account, and email them. */
export function onboardEventHost(requestId, { sendEmail = true, regenerate = false } = {}) {
  return callFn('event-host-onboard', { event_request_id: requestId, send_email: sendEmail, regenerate });
}

let renderToken = 0;

export async function renderCleaningTab(requestId, el) {
  const token = ++renderToken;
  el.innerHTML = '<p class="text-muted">Loading…</p>';

  const [evRes, phRes, ckRes] = await Promise.all([
    supabase.from('event_hosting_requests').select('*, person:person_id(first_name, last_name, email)').eq('id', requestId).single(),
    supabase.from('work_photos').select('id, photo_type, cleaning_area_key, created_at, media:media_id(url)')
      .eq('event_request_id', requestId).order('created_at'),
    supabase.from('event_cleaning_checks').select('task_key').eq('event_request_id', requestId),
  ]);
  if (token !== renderToken) return;
  if (evRes.error) { el.innerHTML = `<p class="text-danger">${esc(evRes.error.message)}</p>`; return; }
  const ev = evRes.data;
  const photos = (phRes.data || []).filter((p) => p.media?.url);
  const checks = new Set((ckRes.data || []).map((c) => c.task_key));
  let profile = null;
  if (ev.associate_profile_id) {
    const { data } = await supabase.from('associate_profiles').select('id, stripe_connect_account_id').eq('id', ev.associate_profile_id).maybeSingle();
    profile = data;
  }

  const checklist = ev.cleaning_checklist || [];
  const risk = ev.risk_assessment;
  const after = ev.after_photo_review;
  const before = ev.before_photo_review;
  const tasks = checklist.flatMap((a) => a.tasks || []);
  const linkUrl = `${location.origin}/associates/eventcleaning.html?event=${ev.id}`;

  const pill = (ok, yes, no) => `<span class="status-badge ${ok ? 'approved' : 'pending'}" style="margin-right:.35rem">${ok ? yes : no}</span>`;
  const thumbs = (key, type) => {
    const list = photos.filter((p) => p.cleaning_area_key === key && p.photo_type === type);
    if (!list.length) return `<span class="text-muted" style="font-size:.8rem">No ${type} photo</span>`;
    return list.map((p) => `<img src="${esc(p.media.url)}" data-lightbox="${esc(p.media.url)}" alt="" style="width:84px;height:84px;object-fit:cover;border-radius:6px;cursor:zoom-in;margin:0 .3rem .3rem 0">`).join('');
  };

  el.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin-bottom:.75rem">
      ${pill(ev.is_resident_host, 'Resident host', 'Non-resident')}
      ${pill(!!ev.associate_profile_id, 'Host account linked', 'Host hasn\'t signed in yet')}
      ${pill(!!ev.cleaning_deposit_paid, 'Cleaning deposit paid', 'Cleaning deposit not paid')}
      ${pill(!!profile?.stripe_connect_account_id, 'Payout set up', 'No payout set up')}
      ${pill(!!ev.cleaning_portal_sent_at, 'Checklist emailed ' + (ev.cleaning_portal_sent_at ? new Date(ev.cleaning_portal_sent_at).toLocaleDateString() : ''), 'Checklist not emailed')}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem">
      <button type="button" class="btn-small btn-primary" data-act="send">${ev.cleaning_portal_sent_at ? 'Resend checklist email' : 'Send checklist email'}</button>
      <button type="button" class="btn-small" data-act="regen">Regenerate checklist &amp; estimate (AI)</button>
      <button type="button" class="btn-small" data-act="copy">Copy host link</button>
    </div>

    ${risk ? `
    <div style="background:#f8fafc;border-left:4px solid #2d6a4f;border-radius:6px;padding:.75rem 1rem;margin-bottom:1rem">
      <strong>AI cleanup exposure</strong>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.5rem;margin:.5rem 0">
        <div><div class="text-muted" style="font-size:.75rem">Worst case</div><strong>${money(risk.max_exposure)}</strong></div>
        <div><div class="text-muted" style="font-size:.75rem">Likely</div><strong>${money(risk.likely_cost)}</strong></div>
        <div><div class="text-muted" style="font-size:.75rem">Cleaner hours if no cleanup</div><strong>${esc(risk.cleanup_hours_worst)}</strong></div>
        <div><div class="text-muted" style="font-size:.75rem">Suggested deposit</div><strong>${money(risk.recommended_deposit)}</strong></div>
        <div><div class="text-muted" style="font-size:.75rem">Deposit set</div><strong>${money(ev.cleaning_deposit)}</strong></div>
      </div>
      <div style="font-size:.85rem">${esc(risk.summary)}</div>
      ${risk.factors?.length ? `<ul style="margin:.35rem 0 0;padding-left:1.1rem;font-size:.82rem">${risk.factors.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    </div>` : '<p class="text-muted">No AI estimate yet. Press "Send checklist email" or "Regenerate".</p>'}

    ${after ? `
    <div style="background:${after.needs?.length ? '#fff7ed' : after.likely_pass ? '#f0fdf4' : '#fef2f2'};border-radius:6px;padding:.75rem 1rem;margin-bottom:1rem">
      <strong>AI after-photo review</strong> · ${after.needs?.length ? 'waiting on more photos' : after.likely_pass ? 'looks clean' : 'cleaning likely needed'}
      · est. ${esc(after.est_cleanup_minutes)} min left
      <div style="font-size:.85rem;margin-top:.3rem">${esc(after.inspector_summary)}</div>
      ${after.needs?.length ? `<ul style="margin:.35rem 0 0;padding-left:1.1rem;font-size:.82rem">${after.needs.map((n) => `<li><strong>${esc(n.area_name)}:</strong> ${esc(n.reason)}</li>`).join('')}</ul>` : ''}
    </div>` : ''}

    <div style="display:flex;gap:.5rem;margin-bottom:.75rem;flex-wrap:wrap">
      <button type="button" class="btn-small" data-act="review-before">Run AI before review</button>
      <button type="button" class="btn-small" data-act="review-after">Run AI after review</button>
      <span class="text-muted" style="font-size:.8rem;align-self:center">${checks.size}/${tasks.length} tasks ticked by host${ev.after_submitted_at ? ' · submitted ' + new Date(ev.after_submitted_at).toLocaleString() : ''}</span>
    </div>

    ${checklist.map((a) => {
      const b = before?.areas?.find((x) => x.area_key === a.area_key);
      const af = after?.areas?.find((x) => x.area_key === a.area_key);
      const done = (a.tasks || []).filter((t) => checks.has(t.key)).length;
      return `
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:.75rem;margin-bottom:.6rem">
        <div style="display:flex;justify-content:space-between;gap:.5rem;flex-wrap:wrap">
          <strong>${esc(a.area_name)}</strong>
          <span class="text-muted" style="font-size:.8rem">${done}/${(a.tasks || []).length} tasks${af ? ' · AI: ' + esc(af.clean_status.replace('_', ' ')) + (af.est_minutes ? `, ~${af.est_minutes} min` : '') : ''}</span>
        </div>
        <details style="font-size:.82rem;margin:.3rem 0"><summary>Checklist</summary>
          <ul style="margin:.3rem 0;padding-left:1.1rem">${(a.tasks || []).map((t) => `<li style="${checks.has(t.key) ? 'color:#166534' : ''}">${checks.has(t.key) ? '✓ ' : ''}${esc(t.text)}</li>`).join('')}</ul>
        </details>
        ${a.needs_photos ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem">
          <div><div class="text-muted" style="font-size:.72rem;font-weight:700">BEFORE</div>${thumbs(a.area_key, 'before')}</div>
          <div><div class="text-muted" style="font-size:.72rem;font-weight:700">AFTER</div>${thumbs(a.area_key, 'after')}</div>
        </div>` : ''}
        ${b?.baseline_issues?.length ? `<div style="font-size:.8rem;color:#6b7280">Pre-existing: ${esc(b.baseline_issues.join('; '))}</div>` : ''}
        ${af?.issues?.length ? `<div style="font-size:.8rem;color:#991b1b">Still to do: ${esc(af.issues.join('; '))}</div>` : ''}
      </div>`;
    }).join('') || '<p class="text-muted">No checklist yet.</p>'}

    <h4 style="margin:1.25rem 0 .5rem">Cleaning inspection</h4>
    <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-end">
      <label style="display:flex;gap:.35rem;align-items:center"><input type="radio" name="ecStatus" value="passed" ${ev.inspection_status === 'passed' ? 'checked' : ''}> Clean (pass)</label>
      <label style="display:flex;gap:.35rem;align-items:center"><input type="radio" name="ecStatus" value="failed" ${ev.inspection_status === 'failed' ? 'checked' : ''}> Not clean (fail)</label>
      <label>Minutes to finish cleaning<br><input type="number" id="ecMinutes" min="0" step="5" style="width:110px" value="${ev.inspection_minutes ?? (after?.est_cleanup_minutes || '')}"></label>
    </div>
    <label style="display:block;margin-top:.5rem">Notes for the host<br><textarea id="ecNotes" rows="2" style="width:100%">${esc(ev.inspection_notes || '')}</textarea></label>
    <div id="ecCharges" style="margin:.6rem 0;font-size:.9rem"></div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">
      <button type="button" class="btn-small btn-primary" data-act="save-inspection">Save inspection</button>
      ${ev.refund_payout_id || ev.deposit_refunded_at
        ? `<span class="status-badge approved">Refunded ${money(ev.deposit_refund_amount)}</span>`
        : `<button type="button" class="btn-small" data-act="refund" ${ev.inspection_status === 'pending' ? 'disabled title="Save the inspection first"' : !ev.cleaning_deposit_paid ? 'disabled title="Cleaning deposit not recorded as paid"' : ''}>Send deposit refund</button>`}
    </div>
    <p class="text-muted" style="font-size:.78rem;margin-top:.5rem">Charges: ${money(ev.photo_penalty_amount)} if before or after photos are missing. If not clean: ${money(ev.cleaning_base_fee)} + ${money(ev.cleaning_rate_per_hour)}/hour, minimum ${money(ev.cleaning_min_charge)}${ev.is_resident_host ? ' (resident rate)' : ''}.</p>
  `;

  // ---- behavior ----
  el.querySelectorAll('img[data-lightbox]').forEach((img) => img.addEventListener('click', () => openLightbox(img.dataset.lightbox)));

  const status = () => el.querySelector('input[name="ecStatus"]:checked')?.value || null;
  const minutes = () => parseInt(el.querySelector('#ecMinutes').value, 10) || 0;
  async function preview() {
    const { data, error } = await supabase.rpc('event_cleaning_charges', { p_request_id: requestId, p_status: status(), p_minutes: minutes() });
    const c = data?.[0];
    const box = el.querySelector('#ecCharges');
    if (error || !c) { box.textContent = error?.message || ''; return; }
    box.innerHTML = `Photos: before ${c.has_before ? '✓' : '✗'} after ${c.has_after ? '✓' : '✗'} → penalty <strong>${money(c.photo_penalty)}</strong>
      · cleaning <strong>${money(c.cleaning_charge)}</strong> · deposit ${money(c.deposit)} → refund <strong>${money(c.refund)}</strong>`;
  }
  el.querySelectorAll('input[name="ecStatus"]').forEach((r) => r.addEventListener('change', preview));
  el.querySelector('#ecMinutes').addEventListener('input', preview);
  preview();

  const busy = async (btn, label, fn) => {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try { await fn(); } catch (e) { showToast(e.message, 'error'); }
    btn.disabled = false;
    btn.textContent = old;
  };

  el.querySelector('[data-act="send"]').addEventListener('click', (e) => busy(e.currentTarget, 'Sending…', async () => {
    const r = await onboardEventHost(requestId, { sendEmail: true });
    showToast(r.emailed ? 'Checklist emailed to host' : 'Saved, but the email did not send', r.emailed ? 'success' : 'warning');
    renderCleaningTab(requestId, el);
  }));
  el.querySelector('[data-act="regen"]').addEventListener('click', (e) => busy(e.currentTarget, 'AI is working…', async () => {
    const r = await onboardEventHost(requestId, { sendEmail: false, regenerate: true });
    showToast(r.ai_error ? 'AI failed, used the standard checklist' : 'Checklist and estimate updated', r.ai_error ? 'warning' : 'success');
    renderCleaningTab(requestId, el);
  }));
  el.querySelector('[data-act="copy"]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(linkUrl); showToast('Host link copied', 'success'); } catch { prompt('Host link', linkUrl); }
  });
  for (const mode of ['before', 'after']) {
    el.querySelector(`[data-act="review-${mode}"]`).addEventListener('click', (e) => busy(e.currentTarget, 'AI is reviewing…', async () => {
      const r = await callFn('event-photo-review', { event_request_id: requestId, mode, notify: false });
      showToast(r.review?.needs?.length ? `${r.review.needs.length} area(s) need photos` : 'Photos look complete', 'success');
      renderCleaningTab(requestId, el);
    }));
  }
  el.querySelector('[data-act="save-inspection"]').addEventListener('click', (e) => busy(e.currentTarget, 'Saving…', async () => {
    const s = status();
    if (!s) throw new Error('Pick pass or fail');
    if (s === 'failed' && !minutes()) throw new Error('Enter how many minutes the cleaning will take');
    const { data: c } = await supabase.rpc('event_cleaning_charges', { p_request_id: requestId, p_status: s, p_minutes: minutes() });
    const { data: { user } } = await supabase.auth.getUser();
    const { data: me } = await supabase.from('app_users').select('id').eq('auth_user_id', user?.id).maybeSingle();
    const { error } = await supabase.from('event_hosting_requests').update({
      inspection_status: s,
      inspection_minutes: s === 'failed' ? minutes() : 0,
      inspection_notes: el.querySelector('#ecNotes').value.trim() || null,
      photo_penalty: c?.[0]?.photo_penalty ?? null,
      cleaning_charge: c?.[0]?.cleaning_charge ?? null,
      inspector_id: me?.id || null,
      inspected_at: new Date().toISOString(),
      cleaning_verified_at: s === 'passed' ? new Date().toISOString() : null,
      cleaning_photos_submitted: !!(c?.[0]?.has_before && c?.[0]?.has_after),
      updated_at: new Date().toISOString(),
    }).eq('id', requestId);
    if (error) throw error;
    showToast('Inspection saved', 'success');
    renderCleaningTab(requestId, el);
  }));
  el.querySelector('[data-act="refund"]')?.addEventListener('click', (e) => busy(e.currentTarget, 'Sending…', async () => {
    const { data } = await supabase.rpc('event_cleaning_charges', { p_request_id: requestId });
    const c = data?.[0];
    if (!confirm(`Send ${money(c?.refund)} to ${ev.person?.first_name || 'the host'} through Stripe?\n\nDeposit ${money(c?.deposit)} − photo penalty ${money(c?.photo_penalty)} − cleaning ${money(c?.cleaning_charge)}`)) return;
    const r = await callFn('event-deposit-refund', { event_request_id: requestId });
    showToast(r.amount ? `Refund of ${money(r.amount)} sent${r.test_mode ? ' (test mode)' : ''}` : r.message, 'success');
    renderCleaningTab(requestId, el);
  }));
}
