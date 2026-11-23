// Renders the US-visit questionnaire from questions.js, autosaves a draft on
// this device, and sends the answers to the mistiq-apply edge function
// (action "visa_survey"), which stores them and emails the team.
import { SECTIONS, DOC_OPTS } from './questions.js?v=6'; // bump ?v= with every change to either file (browsers cache them)

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
  return `<div class="vq-sub" data-sub="${name}"><label for="${name}">${esc(label.th)} · ${esc(label.en)}</label>
    <input type="text" id="${name}" name="${name}"></div>`;
}

function renderQuestion(q) {
  const cls = `vq-q${q.req ? ' vq-req' : ''}`;
  const hint = q.hint ? `<p class="vq-hint">${esc(q.hint.th)}<br>${esc(q.hint.en)}</p>` : '';
  if (q.type === 'consent') {
    return `<div class="${cls}" data-q="${q.id}"><label class="vq-consent"><input type="checkbox" name="${q.id}" value="Agreed">
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
  return `<div class="${cls}" role="group" data-q="${q.id}">${label}${hint}${field}</div>`;
}

form.innerHTML = SECTIONS.map((s, i) => `
  <section class="vq-section" id="sec-${s.id}">
    <h2>${i + 1}. ${esc(s.th)}<span class="vq-en">${esc(s.en)}</span></h2>
    ${s.intro ? `<div class="vq-section-intro">${esc(s.intro.th)}<br><span class="vq-en">${esc(s.intro.en)}</span></div>` : ''}
    ${s.questions.some((q) => q.rare) ? `<div class="vq-noall-wrap">
      <button type="button" class="vq-noall" data-sec="${s.id}">ไม่ / ไม่เคย ทุกข้อที่ยังไม่ได้ตอบ<span class="vq-en">No to all the yes/no questions I haven't answered</span></button>
      <p class="vq-hint">คำถามแบบ "เคย/ไม่เคย" ในส่วนนี้ คนส่วนใหญ่ตอบว่า "ไม่" กดปุ่มนี้ได้เลย แล้วค่อยแก้ข้อที่ตอบว่า "ใช่"<br>Most people answer "No" to the yes/no questions here. Tap this, then change any that are "Yes".</p>
    </div>` : ''}
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

// ── Show only what applies ──────────────────────────────────────────────────
const ALL_Q = SECTIONS.flatMap((s) => s.questions.map((q) => ({ ...q, section: s })));

function isAnswered(v) {
  return Array.isArray(v) ? v.length > 0 : Boolean(v && String(v).trim());
}

// Answers that need no follow-up details.
const NEGATIVE = /^(No|Never|None|Not sure|Don't have|Does not apply|Thai only|Alone)/;

function isVisible(q, vals) {
  if (!q.showIf) return true;
  const v = vals[q.showIf.q];
  return !isAnswered(v) || !q.showIf.notIn.includes(v);
}

function detailVisible(q, vals) {
  const v = vals[q.id];
  if (!isAnswered(v)) return false;
  if (Array.isArray(v)) return v.some((x) => !NEGATIVE.test(x));
  return q.detailFor ? q.detailFor.includes(v) : !NEGATIVE.test(v);
}

function applyVisibility(vals) {
  for (const q of ALL_Q) {
    const box = form.querySelector(`[data-q="${q.id}"]`);
    if (box) box.hidden = !isVisible(q, vals);
    const detail = form.querySelector(`[data-sub="${q.id}__detail"]`);
    if (detail) detail.hidden = !detailVisible(q, vals);
    const date = form.querySelector(`[data-sub="${q.id}__date"]`);
    if (date) date.hidden = !(typeof vals[q.id] === 'string' && vals[q.id].startsWith('Have it'));
  }
}

function updateProgress() {
  const vals = readForm();
  applyVisibility(vals);
  const shown = ALL_Q.filter((q) => isVisible(q, vals));
  const done = shown.filter((q) => isAnswered(vals[q.id])).length;
  fill.style.width = `${Math.round((done / shown.length) * 100)}%`;
  progressText.textContent = `ตอบแล้ว ${done} จาก ${shown.length} ข้อ · ${done} of ${shown.length} answered`;
}

// "No to all": answers every unanswered yes/no question in the section with
// its first negative option. Answers already given are left alone.
form.addEventListener('click', (e) => {
  const btn = e.target.closest('.vq-noall');
  if (!btn) return;
  const sec = SECTIONS.find((s) => s.id === btn.dataset.sec);
  for (const q of sec.questions.filter((x) => x.rare)) {
    if (form.querySelector(`input[name="${q.id}"]:checked`)) continue;
    const no = q.opts.find(([en]) => /^(No|Never)/.test(en));
    const input = no && form.querySelector(`input[name="${q.id}"][value="${CSS.escape(no[0])}"]`);
    if (input) input.checked = true;
  }
  saveDraft();
  updateProgress();
});

restoreDraft();
updateProgress();
form.addEventListener('input', () => { saveDraft(); updateProgress(); });
form.addEventListener('change', () => { saveDraft(); updateProgress(); });

// ── Submit ──────────────────────────────────────────────────────────────────
function buildAnswers(vals) {
  const answers = [];
  for (const q of ALL_Q) {
    if (!isVisible(q, vals)) continue; // e.g. partner questions after choosing "single"
    const main = vals[q.id];
    const parts = [];
    if (isAnswered(main)) parts.push(Array.isArray(main) ? main.join(', ') : main);
    const date = vals[`${q.id}__date`];
    if (isAnswered(date) && String(main).startsWith('Have it')) parts.push(`Date: ${date}`);
    const detail = vals[`${q.id}__detail`];
    if (isAnswered(detail) && detailVisible(q, vals)) parts.push(`Details: ${detail}`);
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
