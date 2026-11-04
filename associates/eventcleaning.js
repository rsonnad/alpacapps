/**
 * Event Cleaning — the host's page for one event.
 *
 * 1. Before photos of every area (AI checks them)
 * 2. Clean-up checklist tailored to the event
 * 3. After photos + "Submit for inspection" (AI compares and asks for more if unclear)
 * 4. Payout setup + charges/refund summary
 *
 * Opened from the email link: /associates/eventcleaning.html?event=<event_request_id>
 */
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../shared/supabase.js';
import { initAssociatePage, showToast } from '../shared/associate-shell.js';
import { mediaService } from '../shared/media-service.js';

const root = document.getElementById('ecRoot');
const params = new URLSearchParams(location.search);
let eventId = params.get('event');
let appUser = null;
let isStaff = false;
let ev = null;          // event_hosting_requests row
let photos = [];        // work_photos for this event
let checks = new Set(); // ticked task keys
let profile = null;     // host's associate profile
let charges = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `$${Number(n || 0).toFixed(Number(n) % 1 ? 2 : 0)}`;

initAssociatePage({
  activeTab: 'eventcleaning',
  extraRoles: ['resident'],
  onReady: async (state) => {
    appUser = state.appUser;
    isStaff = ['admin', 'staff', 'oracle'].includes(appUser?.role);
    try {
      await boot();
    } catch (e) {
      console.error(e);
      root.innerHTML = `<div class="ec-card"><p class="ec-title">Something went wrong</p><p class="ec-sub">${esc(e.message)}</p></div>`;
    }
  },
});

async function boot() {
  if (params.get('stripe_onboarding') === 'complete') showToast('Payout setup saved', 'success');

  if (!eventId) {
    const { data, error } = await supabase.rpc('event_host_my_events');
    if (error) throw error;
    if (!data?.length) {
      root.innerHTML = `<div class="ec-card"><p class="ec-title">No events yet</p>
        <p class="ec-sub">Once your event request is approved, its cleaning checklist shows up here. Make sure you're signed in with the email you used on the request.</p></div>`;
      return;
    }
    if (data.length > 1) {
      root.innerHTML = `<div class="ec-card ec-picker"><p class="ec-title">Your events</p>${data.map((e) =>
        `<a href="?event=${e.id}"><strong>${esc(e.event_name)}</strong><br><span class="ec-sub">${esc(e.event_date)}</span></a>`).join('')}</div>`;
      return;
    }
    eventId = data[0].id;
    history.replaceState(null, '', `?event=${eventId}`);
  }

  if (!isStaff) {
    const { error } = await supabase.rpc('event_host_claim', { p_request_id: eventId });
    if (error) {
      root.innerHTML = `<div class="ec-card"><p class="ec-title">This event isn't linked to your account</p>
        <p class="ec-sub">${esc(error.message)}. You're signed in as <strong>${esc(appUser?.email)}</strong>. Sign in with the email address on the event request, or reply to the email we sent and we'll fix it.</p></div>`;
      return;
    }
  }
  await loadAll();
  render();
}

async function loadAll() {
  const [evRes, phRes, ckRes, chRes] = await Promise.all([
    supabase.from('event_hosting_requests').select(
      'id, event_name, event_date, event_start_time, event_end_time, associate_profile_id, cleaning_checklist, ' +
      'before_photo_review, after_photo_review, more_photos_request, after_submitted_at, inspection_status, ' +
      'inspection_notes, cleaning_deposit, is_resident_host, cleaning_base_fee, cleaning_min_charge, cleaning_rate_per_hour, ' +
      'photo_penalty_amount, refund_payout_id'
    ).eq('id', eventId).single(),
    supabase.from('work_photos').select('id, photo_type, cleaning_area_key, created_at, media:media_id(url)')
      .eq('event_request_id', eventId).order('created_at'),
    supabase.from('event_cleaning_checks').select('task_key').eq('event_request_id', eventId),
    supabase.rpc('event_cleaning_charges', { p_request_id: eventId }),
  ]);
  if (evRes.error) throw evRes.error;
  ev = evRes.data;
  photos = (phRes.data || []).filter((p) => p.media?.url);
  checks = new Set((ckRes.data || []).map((c) => c.task_key));
  charges = chRes.data?.[0] || null;
  if (ev.associate_profile_id) {
    const { data } = await supabase.from('associate_profiles')
      .select('id, stripe_connect_account_id, payment_method').eq('id', ev.associate_profile_id).maybeSingle();
    profile = data;
  }
}

// ---------- phase logic ----------
function eventStart() {
  return new Date(`${ev.event_date}T${ev.event_start_time || '00:00'}`);
}
function cleaningDeadline() {
  const d = new Date(`${ev.event_date}T13:01`);
  d.setDate(d.getDate() + 1);
  return d;
}
const photoAreas = () => (ev.cleaning_checklist || []).filter((a) => a.needs_photos);
const areaPhotos = (key, type) => photos.filter((p) => p.cleaning_area_key === key && p.photo_type === type);
const allTasks = () => (ev.cleaning_checklist || []).flatMap((a) => a.tasks || []);

function stepState() {
  const areas = photoAreas();
  const beforeDone = areas.length > 0 && areas.every((a) => areaPhotos(a.area_key, 'before').length);
  const tasks = allTasks();
  const cleanDone = tasks.length > 0 && tasks.every((t) => checks.has(t.key));
  const afterDone = !!ev.after_submitted_at && !(ev.more_photos_request || []).length;
  const inspected = ev.inspection_status !== 'pending';
  return { beforeDone, cleanDone, afterDone, inspected };
}

// ---------- render ----------
function render() {
  if (!ev.cleaning_checklist?.length) {
    root.innerHTML = `<div class="ec-card"><p class="ec-title">${esc(ev.event_name)}</p>
      <p class="ec-sub">Your cleaning checklist is being prepared. You'll get an email when it's ready.</p></div>`;
    return;
  }
  const s = stepState();
  const now = new Date();
  const started = now >= eventStart();
  const steps = [
    ['Before photos', s.beforeDone],
    ['Clean up', s.cleanDone],
    ['After photos', s.afterDone],
    ['Inspection', s.inspected],
  ];
  const firstOpen = steps.findIndex(([, d]) => !d);

  root.innerHTML = `
    <div class="ec-card">
      <p class="ec-title">${esc(ev.event_name)}</p>
      <p class="ec-sub">${esc(new Date(ev.event_date + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}
        · cleaning done by <strong>1:01pm ${esc(cleaningDeadline().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))}</strong></p>
      <div class="ec-steps">${steps.map(([label, done], i) =>
        `<div class="ec-step ${done ? 'done' : i === firstOpen ? 'now' : ''}">${done ? '✓ ' : ''}${label}</div>`).join('')}</div>
    </div>
    ${renderNotices(s, started)}
    ${(ev.cleaning_checklist || []).map(renderArea).join('')}
    ${renderSubmit(s)}
    ${renderMoney()}
  `;
  wire();
}

function renderNotices(s, started) {
  const out = [];
  const more = ev.more_photos_request || [];
  if (more.length) {
    out.push(`<div class="ec-notice warn"><strong>We need a few more after photos:</strong><ul>${more.map((m) =>
      `<li><strong>${esc(m.area_name)}:</strong> ${esc(m.reason)}</li>`).join('')}</ul></div>`);
  }
  const br = ev.before_photo_review;
  if (br?.needs?.length && !s.inspected) {
    out.push(`<div class="ec-notice ${started ? 'warn' : 'info'}"><strong>Before photos to add or retake:</strong><ul>${br.needs.map((m) =>
      `<li><strong>${esc(m.area_name)}:</strong> ${esc(m.reason)}</li>`).join('')}</ul></div>`);
  } else if (br && s.beforeDone) {
    out.push(`<div class="ec-notice ok">✓ Before photos checked. ${esc(br.summary || '')}</div>`);
  }
  if (!started && !s.beforeDone) {
    out.push(`<div class="ec-notice info">Take a <strong>before</strong> photo of each area below before guests arrive. Missing before or after photos cost ${money(ev.photo_penalty_amount)}.</div>`);
  }
  if (ev.inspection_status === 'passed') out.push(`<div class="ec-notice ok"><strong>Inspection passed.</strong> Thank you! ${esc(ev.inspection_notes || '')}</div>`);
  if (ev.inspection_status === 'failed') out.push(`<div class="ec-notice warn"><strong>The inspector found cleaning left to do.</strong> ${esc(ev.inspection_notes || '')}</div>`);
  return out.join('');
}

function aiLine(area) {
  const b = ev.before_photo_review?.areas?.find((x) => x.area_key === area.area_key);
  const a = ev.after_photo_review?.areas?.find((x) => x.area_key === area.area_key);
  const bits = [];
  if (b && b.status !== 'ok' && b.notes) bits.push(`<div class="ec-ai bad">Before: ${esc(b.notes)}</div>`);
  if (b?.baseline_issues?.length) bits.push(`<div class="ec-ai">Noted before your event (not on you): ${esc(b.baseline_issues.join('; '))}</div>`);
  if (a?.issues?.length) bits.push(`<div class="ec-ai bad">Still to do: ${esc(a.issues.join('; '))}</div>`);
  return bits.join('');
}

function badge(area) {
  if (!area.needs_photos) return '';
  const a = ev.after_photo_review?.areas?.find((x) => x.area_key === area.area_key);
  if (a?.clean_status === 'clean') return '<span class="ec-badge ok">Looks clean</span>';
  if (a?.clean_status === 'needs_work') return '<span class="ec-badge bad">Needs work</span>';
  const hasB = areaPhotos(area.area_key, 'before').length;
  const hasA = areaPhotos(area.area_key, 'after').length;
  if (hasB && hasA) return '<span class="ec-badge ok">Photos done</span>';
  if (hasB) return '<span class="ec-badge">Before ✓</span>';
  return '<span class="ec-badge warn">Needs before photo</span>';
}

function renderArea(area) {
  const locked = ev.inspection_status !== 'pending' || isStaff;
  const thumbs = (type) => areaPhotos(area.area_key, type).map((p) => `
    <div class="ec-thumb"><img src="${esc(p.media.url)}" alt="" data-full="${esc(p.media.url)}">
      ${locked ? '' : `<button type="button" data-remove="${p.id}" title="Remove">×</button>`}</div>`).join('');
  const add = (type) => locked ? '' : `
    <label class="ec-add" data-add="${type}" data-area="${esc(area.area_key)}">
      <input type="file" accept="image/*" multiple>📷<br>Add ${type}</label>`;
  return `
    <div class="ec-card ec-area">
      <h3>${esc(area.area_name)} ${badge(area)}</h3>
      ${(area.tasks || []).map((t) => `
        <label class="ec-task ${checks.has(t.key) ? 'done' : ''}">
          <input type="checkbox" data-task="${esc(t.key)}" ${checks.has(t.key) ? 'checked' : ''} ${locked ? 'disabled' : ''}>
          <span>${esc(t.text)}</span></label>`).join('')}
      ${area.needs_photos ? `
        <div class="ec-phase"><div class="ec-phase-label">Before</div><div class="ec-thumbs">${thumbs('before')}${add('before')}</div></div>
        <div class="ec-phase"><div class="ec-phase-label">After</div><div class="ec-thumbs">${thumbs('after')}${add('after')}</div></div>` : ''}
      ${aiLine(area)}
    </div>`;
}

function renderSubmit(s) {
  if (isStaff) return `<div class="ec-notice info">You're viewing this as staff. Inspect it from Staff → Events → Cleaning.</div>`;
  if (s.inspected) return '';
  const beforeCount = photos.filter((p) => p.photo_type === 'before').length;
  const afterCount = photos.filter((p) => p.photo_type === 'after').length;
  return `
    <div class="ec-card">
      <p class="ec-title" style="font-size:1.05rem">Check &amp; submit</p>
      <p class="ec-sub">${beforeCount} before photo${beforeCount === 1 ? '' : 's'}, ${afterCount} after photo${afterCount === 1 ? '' : 's'},
        ${checks.size} of ${allTasks().length} tasks ticked.${ev.after_submitted_at ? ' Submitted ' + esc(new Date(ev.after_submitted_at).toLocaleString()) + '.' : ''}</p>
      <div class="ec-actions">
        <button class="ec-btn secondary" id="checkBeforeBtn" ${beforeCount ? '' : 'disabled'}>Check my before photos</button>
        <button class="ec-btn" id="submitAfterBtn" ${afterCount ? '' : 'disabled'}>${ev.after_submitted_at ? 'Resubmit for inspection' : 'Submit for inspection'}</button>
      </div>
    </div>`;
}

function renderMoney() {
  const hasStripe = !!profile?.stripe_connect_account_id;
  const c = charges;
  return `
    <div class="ec-card">
      <p class="ec-title" style="font-size:1.05rem">Your deposit</p>
      <table class="ec-money">
        <tr><td>Cleaning deposit</td><td>${money(ev.cleaning_deposit)}</td></tr>
        ${c && ev.inspection_status !== 'pending' ? `
          <tr><td>Missing photos</td><td>−${money(c.photo_penalty)}</td></tr>
          <tr><td>Extra cleaning</td><td>−${money(c.cleaning_charge)}</td></tr>
          <tr class="total"><td>Refund</td><td>${money(c.refund)}</td></tr>` : `
          <tr><td colspan="2" class="ec-sub">Missing before or after photos: ${money(ev.photo_penalty_amount)}. If the inspector finds it isn't clean:
            ${money(ev.cleaning_base_fee)} + ${money(ev.cleaning_rate_per_hour)}/hour, minimum ${money(ev.cleaning_min_charge)}.</td></tr>`}
      </table>
      ${ev.refund_payout_id ? '<div class="ec-notice ok" style="margin-top:.75rem">Your refund has been sent.</div>' : `
      <p class="ec-sub" style="margin-top:.75rem">${hasStripe
        ? '✓ Payout is set up. Your refund goes to your bank after inspection.'
        : 'Set up your payout so we can send your refund to your bank (takes about 3 minutes with Stripe).'}</p>
      ${isStaff ? '' : `<div class="ec-actions"><button class="ec-btn ${hasStripe ? 'secondary' : ''}" id="payoutBtn">${hasStripe ? 'Update payout details' : 'Set up payout'}</button></div>`}`}
    </div>`;
}

// ---------- actions ----------
function wire() {
  root.querySelectorAll('input[data-task]').forEach((cb) => cb.addEventListener('change', async () => {
    const key = cb.dataset.task;
    const { error } = await supabase.rpc('event_host_toggle_task', { p_request_id: eventId, p_task_key: key, p_done: cb.checked });
    if (error) { showToast(error.message, 'error'); cb.checked = !cb.checked; return; }
    cb.checked ? checks.add(key) : checks.delete(key);
    cb.closest('.ec-task').classList.toggle('done', cb.checked);
  }));

  root.querySelectorAll('label[data-add] input').forEach((input) => input.addEventListener('change', async () => {
    const label = input.closest('label');
    const files = [...input.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    label.classList.add('busy');
    let added = 0;
    for (const file of files) {
      try {
        const res = await mediaService.upload(file, { category: 'projects', caption: `${ev.event_name} — ${label.dataset.area} (${label.dataset.add})` });
        const media = res.success ? res.media : (res.isDuplicate ? res.existingMedia : null);
        if (!media) { showToast('Upload failed: ' + (res.error || 'unknown error'), 'error'); continue; }
        const { error } = await supabase.rpc('event_host_add_photo', {
          p_request_id: eventId, p_media_id: media.id, p_photo_type: label.dataset.add, p_area_key: label.dataset.area, p_caption: null,
        });
        if (error) { showToast(error.message, 'error'); continue; }
        added++;
      } catch (e) {
        showToast('Upload failed: ' + e.message, 'error');
      }
    }
    if (added) showToast(`${added} photo${added > 1 ? 's' : ''} added`, 'success');
    await loadAll();
    render();
  }));

  root.querySelectorAll('button[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await supabase.rpc('event_host_remove_photo', { p_photo_id: b.dataset.remove });
    if (error) return showToast(error.message, 'error');
    await loadAll();
    render();
  }));

  root.querySelectorAll('img[data-full]').forEach((img) => img.addEventListener('click', () => window.open(img.dataset.full, '_blank')));

  document.getElementById('checkBeforeBtn')?.addEventListener('click', (e) => runReview('before', e.currentTarget));
  document.getElementById('submitAfterBtn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const missing = photoAreas().filter((a) => !areaPhotos(a.area_key, 'after').length);
    if (missing.length && !confirm(`No after photo yet for: ${missing.map((a) => a.area_name).join(', ')}.\nMissing photos cost ${money(ev.photo_penalty_amount)}. Submit anyway?`)) return;
    btn.disabled = true;
    const { error } = await supabase.rpc('event_host_submit_after', { p_request_id: eventId });
    if (error) { btn.disabled = false; return showToast(error.message, 'error'); }
    await runReview('after', btn);
  });
  document.getElementById('payoutBtn')?.addEventListener('click', setupPayout);
}

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

async function runReview(mode, btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = mode === 'before' ? 'AI is checking your photos…' : 'Submitting, AI is reviewing…';
  try {
    const { review } = await callFn('event-photo-review', { event_request_id: eventId, mode, notify: mode === 'after' });
    if (review?.needs?.length) showToast(`${review.needs.length} area${review.needs.length > 1 ? 's' : ''} need${review.needs.length > 1 ? '' : 's'} another photo`, 'warning');
    else showToast(mode === 'before' ? 'Before photos look good' : 'Submitted for inspection', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
  btn.textContent = label;
  await loadAll();
  render();
}

async function setupPayout() {
  const btn = document.getElementById('payoutBtn');
  btn.disabled = true;
  btn.textContent = 'Opening Stripe…';
  try {
    if (!profile?.stripe_connect_account_id) {
      await callFn('stripe-connect-onboard', { action: 'create_account', associate_id: ev.associate_profile_id });
    }
    const link = await callFn('stripe-connect-onboard', {
      action: 'create_account_link', associate_id: ev.associate_profile_id,
      return_path: `/associates/eventcleaning.html?event=${eventId}`,
    });
    if (link.url) { location.href = link.url; return; }
    throw new Error('No Stripe link returned');
  } catch (e) {
    showToast(e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Set up payout';
  }
}
