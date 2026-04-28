// Jacket-comment Edge Function
//
// Receives a comment from the public-facing cheasejackettheft.html page
// and emails it to the host. Submitter MUST provide an email address.
// Nothing else happens automatically — the host reads the email and
// chooses whether and how to respond manually.
//
// Deploy: supabase functions deploy jacket-comment --no-verify-jwt

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/api-helpers.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RECIPIENT = Deno.env.get("JACKET_COMMENT_RECIPIENT") || "rahulioson@gmail.com";
const FROM_EMAIL = "Encyclopedia Claude <pai@alpacaplayhouse.com>";

const MAX_COMMENT = 4000;
const MAX_NAME = 80;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Body {
  email?: string;
  name?: string;
  comment?: string;
  hp?: string; // honeypot — bots fill it; humans don't see it
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nl2br(s: string): string {
  return escapeHtml(s).replace(/\n/g, "<br>");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }

  // Honeypot — silently accept and drop
  if (body.hp && body.hp.trim().length > 0) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }

  const email = (body.email || "").trim();
  const name = (body.name || "").trim().slice(0, MAX_NAME);
  const comment = (body.comment || "").trim().slice(0, MAX_COMMENT);

  if (!email || !EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ error: "A valid email is required." }), {
      status: 400,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }

  if (!comment || comment.length < 2) {
    return new Response(JSON.stringify({ error: "Comment is required." }), {
      status: 400,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }

  if (!RESEND_API_KEY) {
    console.error("[jacket-comment] RESEND_API_KEY not configured");
    return new Response(
      JSON.stringify({ error: "Email service unavailable. Try again later." }),
      {
        status: 503,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      },
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";
  const ua = req.headers.get("user-agent") || "unknown";
  const submittedAt = new Date().toISOString();

  const subject = `[Jacket comment] ${name || email} — ${comment.slice(0, 60).replace(/\s+/g, " ")}${comment.length > 60 ? "…" : ""}`;

  const textBody = `New comment on cheasejackettheft.html

From: ${name ? `${name} <${email}>` : email}
Submitted: ${submittedAt}
IP: ${ip}
User-Agent: ${ua}

---

${comment}

---

Page: https://alpacaplayhouse.com/rahulio/pages/cheasejackettheft.html
Reply: ${email}
`;

  const htmlBody = `
<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:640px;color:#1a1a1a;">
  <h2 style="margin:0 0 0.5rem;font-size:1.05rem;">New comment on cheasejackettheft.html</h2>
  <table style="font-size:0.85rem;color:#555;border-collapse:collapse;margin-bottom:1rem;">
    <tr><td style="padding:2px 12px 2px 0;"><b>From</b></td><td>${escapeHtml(name ? `${name} <${email}>` : email)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;"><b>Submitted</b></td><td>${escapeHtml(submittedAt)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;"><b>IP</b></td><td>${escapeHtml(ip)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;"><b>UA</b></td><td style="font-size:0.78rem;color:#888;">${escapeHtml(ua)}</td></tr>
  </table>
  <div style="border-left:3px solid #d4883a;padding:0.75rem 1rem;background:#fdf6ee;border-radius:0 8px 8px 0;font-size:0.95rem;line-height:1.5;">
    ${nl2br(comment)}
  </div>
  <p style="font-size:0.78rem;color:#888;margin-top:1rem;">
    Page: <a href="https://alpacaplayhouse.com/rahulio/pages/cheasejackettheft.html">cheasejackettheft.html</a>
    &middot; Reply: <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>
  </p>
</div>`.trim();

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: RECIPIENT,
        reply_to: email,
        subject,
        text: textBody,
        html: htmlBody,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("[jacket-comment] Resend failed:", resp.status, errText);
      return new Response(
        JSON.stringify({ error: "Email send failed. Try again later." }),
        {
          status: 502,
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[jacket-comment] error:", err);
    return new Response(JSON.stringify({ error: "Internal error." }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
