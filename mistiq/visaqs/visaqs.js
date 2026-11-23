// Renders the US-visit questionnaire from questions.js, autosaves a draft on
// this device, and sends the answers to the mistiq-apply edge function
// (action "visa_survey"), which stores them and emails the team.
import { SECTIONS, DOC_OPTS } from './questions.js';

const EDGE_FN = 'https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/mistiq-apply';
const DRAFT_KEY = 'mistiq-visaqs-draft-v1';

const form = document.getElementById('vq-form');
const fill = document.getElementById('vq-progress-fill');
const progressText = document.getElementById('vq-progress-text');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bi = (th, en) => `<span>${esc(th)}</span><span class="vq-en">${esc(en)}</span>`;

const OTHER_DETAIL = { th: 'รายละเอียดเพิ่มเติม (ถ้ามี)', en: 'Details (optional)' };

function optionList(q, kind) {
  const opts = q.type === 'doc' ? DOC_OPTS : q.opts;
  return `<div class="vq-opts">${opts.map(([en, th]) => `
    <label class="vq-opt"><input type="${kind}" name="${q.id}" value="${esc(en)}">
      <span>${esc(th)}<span class="vq-en">${esc(en)}</span></span></label>`).join('')}</div>`;
}

function subText(name, label) {
  return `<div class="vq-sub"><label for="${name}">${esc(label.th)} · ${esc(label.en)}</label>
    <input type="text" id="${name}" name="${name}"></div>`;
}

function renderQuestion(q) {
  const cls = `vq-q${q.req ? ' vq-req' : ''}`;
  const hint = q.hint ? `<p class="vq-hint">${esc(q.hint.th)}<br>${esc(q.hint.en)}</p>` : '';
  if (q.type === 'consent') {
    return `<div class="${cls}"><label class="vq-consent"><input type="checkbox" name="${q.id}" value="Agreed">
      <span>${esc(q.th)}<br><span class="vq-en">${esc(q.en)}</span></span></label></div>`;
  }
  const label = `<label class="vq-label" ${['text', 'textarea', 'date'].includes(q.type) ? `for="${q.id}"` : ''}>${bi(q.th, q.en)}</label>`;
  let field = '';
  if (q.type === 'text') field = `<input type="text" id="${q.id}" name="${q.id}">`;
  else if (q.type === 'textarea') field = `<textarea id="${q.id}" name="${q.id}" rows="3"></textarea>`;
  // Typed, not a date picker: phone pickers make a 1960s birth year a long scroll.
  else if (q.type === 'date') field = `<input type="text" id="${q.id}" name="${q.id}" placeholder="วว/ดด/ปปปป · DD/MM/YYYY (1966)">`;
  else if (q.type === 'radio' || q.type === 'doc') field = optionList(q, 'radio');
  else if (q.type === 'checks') field = optionList(q, 'checkbox');
  if (q.type === 'doc' && q.date) field += subText(`${q.id}__date`, q.date);
  if (q.other) field += subText(`${q.id}__detail`, OTHER_DETAIL);
  return `<div class="${cls}" role="group">${label}${hint}${field}</div>`;
}

form.innerHTML = SECTIONS.map((s, i) => `
  <section class="vq-section" id="sec-${s.id}">
    <h2>${i + 1}. ${esc(s.th)}<span class="vq-en">${esc(s.en)}</span></h2>
    ${s.intro ? `<div class="vq-section-intro">${esc(s.intro.th)}<br><span class="vq-en">${esc(s.intro.en)}</span></div>` : ''}
    ${s.questions.map(renderQuestion).join('')}
  </section>`).join('') + `
  <div class="vq-error" id="vq-error" role="alert"></div>
  <div class="vq-actions">
    <button type="submit" class="vq-submit" id="vq-submit">ส่งคำตอบ · Send answers</button>
    <p class="vq-note">คำตอบจะส่งถึงทีม Mistique Journey เท่านั้น และจะไม่เปิดเผยต่อผู้อื่น<br>
      <span class="vq-en">Your answers go only to the Mistique Journey team and are kept private.</span></p>
  </div>`;

// ── Draft: saved on this device only ────────────────────────────────────────
function readForm() {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') {
      if (!out[el.name]) out[el.name] = [];
      if (el.checked) out[el.name].push(el.value);
    } else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    } else if (el.value.trim()) {
      out[el.name] = el.value;
    }
  }
  return out;
}

function restoreDraft() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { saved = null; }
  if (!saved || typeof saved !== 'object') return;
  for (const el of form.elements) {
    if (!el.name || !(el.name in saved)) continue;
    const v = saved[el.name];
    if (el.type === 'checkbox') el.checked = Array.isArray(v) && v.includes(el.value);
    else if (el.type === 'radio') el.checked = v === el.value;
    else el.value = v;
  }
}

function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(readForm())); } catch { /* storage blocked: no draft */ }
}

// ── Progress ────────────────────────────────────────────────────────────────
const ALL_Q = SECTIONS.flatMap((s) => s.questions.map((q) => ({ ...q, section: s })));

function isAnswered(v) {
  return Array.isArray(v) ? v.length > 0 : Boolean(v && String(v).trim());
}

function updateProgress() {
  const vals = readForm();
  const done = ALL_Q.filter((q) => isAnswered(vals[q.id])).length;
  fill.style.width = `${Math.round((done / ALL_Q.length) * 100)}%`;
  progressText.textContent = `ตอบแล้ว ${done} จาก ${ALL_Q.length} ข้อ · ${done} of ${ALL_Q.length} answered`;
}

restoreDraft();
updateProgress();
form.addEventListener('input', () => { saveDraft(); updateProgress(); });
form.addEventListener('change', () => { saveDraft(); updateProgress(); });

// ── Submit ──────────────────────────────────────────────────────────────────
function buildAnswers(vals) {
  const answers = [];
  for (const q of ALL_Q) {
    const main = vals[q.id];
    const parts = [];
    if (isAnswered(main)) parts.push(Array.isArray(main) ? main.join(', ') : main);
    const date = vals[`${q.id}__date`];
    if (isAnswered(date)) parts.push(`Date: ${date}`);
    const detail = vals[`${q.id}__detail`];
    if (isAnswered(detail)) parts.push(`Details: ${detail}`);
    if (!parts.length) continue;
    answers.push({ section: q.section.en, id: q.id, q_en: q.en, q_th: q.th, answer: parts.join(' — ') });
  }
  return answers;
}

const errorEl = () => document.getElementById('vq-error');

function showError(th, en) {
  const el = errorEl();
  el.innerHTML = `${esc(th)}<br>${esc(en)}`;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl().style.display = 'none';
  const vals = readForm();
  const missing = ALL_Q.filter((q) => q.req && !isAnswered(vals[q.id]));
  if (missing.length) {
    showError(
      `กรุณาตอบข้อที่มีเครื่องหมาย *: ${missing.map((q) => q.th).join(' / ')}`,
      `Please answer the questions marked *: ${missing.map((q) => q.en).join(' / ')}`,
    );
    return;
  }

  const btn = document.getElementById('vq-submit');
  btn.disabled = true;
  btn.textContent = 'กำลังส่ง… · Sending…';
  try {
    const res = await fetch(EDGE_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'visa_survey',
        language: 'th',
        referrer: document.referrer || null,
        answers: buildAnswers(vals),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    form.style.display = 'none';
    document.querySelector('.vq-progress').style.display = 'none';
    document.getElementById('vq-success').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch {
    showError(
      'ส่งไม่สำเร็จ คำตอบยังถูกเก็บไว้ในโทรศัพท์ กรุณาลองใหม่อีกครั้งภายหลัง',
      'Sending failed. Your answers are still saved on this phone. Please try again later.',
    );
    btn.disabled = false;
    btn.textContent = 'ส่งคำตอบ · Send answers';
  }
});

// Page view (fire-and-forget, same tracking as the apply pages)
fetch(EDGE_FN, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'track', event_type: 'pageview', page: 'visaqs', language: 'th', referrer: document.referrer || null }),
}).catch(() => {});
