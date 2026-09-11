// ENM Style quiz — partner invites.
//
// Two actions, both public, both narrow:
//
//   send    a taker who has just finished gives their partner's email; we mint
//           a token, mail the invite, and remember who invited whom
//   redeem  the partner finishes their own run via that link; we cross-link the
//           two leads so the pair can be read as one couple
//
// Cross-linking needs an UPDATE, and the anon role deliberately has INSERT-only
// rights on enm_quiz_leads, so it has to happen here under the service role.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders } from "../_shared/api-helpers.ts";

const QUIZ_URL = "https://alpacaplayhouse.com/rahulio/pages/enmtest/";
const FROM = "The ENM Style Quiz <pai@alpacaplayhouse.com>";

const db = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function sendMail(to: string, subject: string, html: string, text: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY not configured");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}

function inviteEmail(inviterName: string | null, link: string) {
  const who = inviterName ? esc(inviterName) : "Someone you know";
  const text =
    `${inviterName ?? "Someone you know"} just took the ENM Style quiz and asked us to send you your own copy.\n\n` +
    `It is about 20 questions, it is judgement-free, and your answers are your own — they do not see them ` +
    `unless you choose to share.\n\nTake it here: ${link}\n\n` +
    `If this is not something you want, you can ignore this email and we will not write again.`;

  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#3c3c3c;max-width:520px;margin:0 auto;padding:24px">
  <h1 style="font-size:20px;font-weight:600;margin:0 0 16px">${who} invited you to take the ENM Style quiz</h1>
  <p style="margin:0 0 14px;line-height:1.55">It is about 20 questions and it is judgement-free. Your answers are your own &mdash; they do not see them unless you choose to share.</p>
  <p style="margin:0 0 14px;line-height:1.55">When you are done, the two of you can compare where you actually line up, and where you do not.</p>
  <p style="margin:26px 0"><a href="${esc(link)}" style="background:#fc6a77;color:#fff;text-decoration:none;padding:13px 28px;border-radius:30px;font-weight:600;display:inline-block">Take the quiz</a></p>
  <p style="margin:0;font-size:12px;color:#8a8a8a;line-height:1.5">If this is not something you want, ignore this email and we will not write again.</p>
</div>`;

  return { html, text };
}

async function actionSend(payload: any) {
  const runId = payload?.run_id;
  const partnerEmail = String(payload?.partner_email ?? "").trim().toLowerCase();
  if (!runId) return { status: 400, body: { error: "run_id required" } };
  if (!isEmail(partnerEmail)) return { status: 400, body: { error: "A valid partner email is required" } };

  const client = db();
  const { data: session } = await client
    .from("enm_quiz_sessions").select("id, lead_id").eq("run_id", runId).maybeSingle();
  if (!session?.lead_id) return { status: 404, body: { error: "Session not found" } };

  const { data: lead } = await client
    .from("enm_quiz_leads").select("id, email, first_name, invite_token")
    .eq("id", session.lead_id).maybeSingle();
  if (!lead) return { status: 404, body: { error: "Lead not found" } };

  // Don't let someone invite themselves into a self-partnership.
  if (lead.email?.toLowerCase() === partnerEmail) {
    return { status: 400, body: { error: "That is your own address" } };
  }

  const token = lead.invite_token ?? crypto.randomUUID().replace(/-/g, "");
  const link = `${QUIZ_URL}?invite=${token}`;

  await client.from("enm_quiz_leads").update({
    partner_email: partnerEmail,
    invite_token: token,
    invite_sent_at: new Date().toISOString(),
  }).eq("id", lead.id);

  try {
    const { html, text } = inviteEmail(lead.first_name, link);
    await sendMail(
      partnerEmail,
      `${lead.first_name ?? "Someone"} invited you to take the ENM Style quiz`,
      html,
      text,
    );
  } catch (e) {
    console.error("invite send failed", e);
    return { status: 502, body: { error: "Could not send the invite just now" } };
  }

  return { status: 200, body: { sent: true, partner_email: partnerEmail } };
}

async function actionRedeem(payload: any) {
  const token = String(payload?.invite_token ?? "").trim();
  const runId = payload?.run_id;
  if (!token || !runId) return { status: 400, body: { error: "invite_token and run_id required" } };

  const client = db();
  const { data: inviter } = await client
    .from("enm_quiz_leads").select("id, partner_lead_id").eq("invite_token", token).maybeSingle();
  if (!inviter) return { status: 404, body: { error: "Unknown invite" } };

  const { data: session } = await client
    .from("enm_quiz_sessions").select("lead_id").eq("run_id", runId).maybeSingle();
  if (!session?.lead_id) return { status: 404, body: { error: "Session not found" } };
  if (session.lead_id === inviter.id) return { status: 400, body: { error: "That is the same person" } };

  const now = new Date().toISOString();
  await client.from("enm_quiz_leads").update({
    partner_lead_id: session.lead_id, partner_linked_at: now,
  }).eq("id", inviter.id);
  await client.from("enm_quiz_leads").update({
    partner_lead_id: inviter.id, invited_by_lead_id: inviter.id, partner_linked_at: now,
  }).eq("id", session.lead_id);

  return { status: 200, body: { linked: true } };
}

serve(async (req: Request) => {
  const cors = { ...getCorsHeaders(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(req) });

  try {
    const payload = await req.json();
    const action = String(payload?.action ?? "");
    const result = action === "send"
      ? await actionSend(payload)
      : action === "redeem"
      ? await actionRedeem(payload)
      : { status: 400, body: { error: `Unknown action: ${action}` } };

    return new Response(JSON.stringify(result.body), { status: result.status, headers: cors });
  } catch (e) {
    console.error("enm-quiz-invite failed", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
