/**
 * POST /api/contact — relays the contact form to a private inbox.
 * The destination address lives ONLY in the CONTACT_TO secret; it never
 * appears in the published HTML.
 */
const json = (b, s) => new Response(JSON.stringify(b), {
  status: s, headers: { 'Content-Type': 'application/json' },
});
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const name = String(b.name || '').trim().slice(0, 200);
  const email = String(b.email || '').trim().slice(0, 320);
  const message = String(b.message || '').trim().slice(0, 20000);

  if (!message) return json({ error: 'empty_message' }, 400);
  if (String(b.website || '').trim()) return json({ ok: true }, 200);   // honeypot
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\r\n]/.test(email)))
    return json({ error: 'bad_email' }, 400);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const country = request.cf?.country || 'unknown';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.CONTACT_FROM,
      to: [env.CONTACT_TO],
      subject: `youarewarned.com — message from ${name || 'a reader'}`,
      ...(email ? { reply_to: email } : {}),
      text: `Name: ${name || '(not given)'}\nEmail: ${email || '(not given)'}\n`
          + `Origin: ${country} · ${ip}\n\n${message}`,
      html: `<p><strong>Name:</strong> ${esc(name) || '<em>not given</em>'}<br>`
          + `<strong>Email:</strong> ${esc(email) || '<em>not given</em>'}<br>`
          + `<strong>Origin:</strong> ${esc(country)} · ${esc(ip)}</p>`
          + `<hr><p style="white-space:pre-wrap">${esc(message)}</p>`,
    }),
  });

  if (!res.ok) {
    console.error('resend_failed', res.status, await res.text());
    return json({ error: 'send_failed' }, 502);   // never leak upstream body
  }
  return json({ ok: true }, 200);
}
