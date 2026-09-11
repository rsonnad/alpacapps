// ENM Style quiz — model-backed endpoints for rahulio/pages/enmtest.
//
// One function, several actions, because they share the OpenRouter plumbing and
// the audit trail:
//
//   summary      public  — situation read-out shown to the taker after Q20
//   review       admin   — regenerate the question-design action items
//   prompt       admin   — free-form prompt box at the bottom of the page
//   site-update  admin   — queue an edit to rahulio/pages/enmtest and kick CI
//
// Admin actions require a signed-in app_user with role admin or staff. The
// public action is deliberately narrow: it only ever reads a session that
// already exists and returns prose.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders } from "../_shared/api-helpers.ts";

/* GLM 5.3 Flash allows 131k output tokens; the ceiling that matters is the one
   we set below. Reasoning cannot be switched off on this endpoint, so budget for
   it: an undersized max_tokens gets eaten by reasoning and the answer never
   arrives. Override with ENM_MODEL to swap models without a redeploy. */
const MODEL = Deno.env.get("ENM_MODEL") || "z-ai/glm-5.3-flash";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** The only tree the site updater may touch. Enforced again in the workflow. */
const PATH_SCOPE = "rahulio/pages/enmtest/";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function svc() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

// ─── OpenRouter ──────────────────────────────────────────────────────────────

interface AskOptions {
  system?: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

async function ask(kind: string, prompt: string, actor: string | null, opts: AskOptions = {}) {
  const apiKey = Deno.env.get("OPENROUTER_ENM_KEY") || Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("No OpenRouter key configured");

  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });

  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
    max_tokens: opts.maxTokens ?? 6000,
    temperature: opts.temperature ?? 0.4,
    // "minimal" still reasons, but briefly — enough to stay accurate without
    // spending the whole completion budget before it starts answering.
    reasoning: { effort: "minimal" },
  };
  if (opts.json) body.response_format = { type: "json_object" };

  const started = Date.now();
  let ok = true;
  let error: string | null = null;
  let content = "";
  let usage: unknown = null;

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://alpacaplayhouse.com",
        "X-Title": "AlpacApps ENM Quiz",
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    content = json.choices?.[0]?.message?.content ?? "";
    usage = json.usage ?? null;
  } catch (e) {
    ok = false;
    error = String(e);
    throw e;
  } finally {
    // Audit every call, including the failures — this is a spend surface.
    await svc().from("enm_quiz_ai_runs").insert({
      kind,
      model: MODEL,
      request: { prompt: prompt.slice(0, 8000), system: opts.system?.slice(0, 2000) ?? null },
      response: content.slice(0, 20000),
      usage: { ...(usage as Record<string, unknown> ?? {}), ms: Date.now() - started },
      actor,
      ok,
      error,
    });
  }

  return { content, usage };
}

/** Models wrap JSON in prose or fences often enough to be worth handling. */
function parseJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const braced = candidate.match(/[{[][\s\S]*[}\]]/);
  if (!braced) throw new Error("No JSON found in model response");
  return JSON.parse(braced[0]);
}

// ─── Auth ────────────────────────────────────────────────────────────────────

/** CI calls in with the service-role key rather than a user session. */
function isMachineCaller(req: Request): boolean {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token.length > 0 && token === SERVICE_KEY;
}

async function requireStaff(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: "Missing authorization header", status: 401 };

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return { error: "Unauthorized", status: 401 };

  const { data: appUser } = await client
    .from("app_users").select("id, role, email").eq("auth_user_id", user.id).single();

  if (!appUser || !["admin", "staff"].includes(appUser.role)) {
    return { error: "Admin access required", status: 403 };
  }
  return { appUser };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

const SUMMARY_SYSTEM = `You are an experienced, non-judgemental relationship coach specialising in ethical non-monogamy.
You are writing directly to one person who has just finished a quiz about their ENM style.

Rules:
- Address them as "you". Never use their name.
- Be warm, specific and plain-spoken. No therapy-speak, no hype, no emoji.
- Ground every observation in the answers you were given. Do not invent facts about their life.
- Name real tensions honestly, including where their own answers contradict each other.
- Never imply there is a correct answer or that more non-monogamy is better.
- If their answers suggest a partner has not consented or does not know, say plainly that the
  conversation with that partner comes before anything else. Do not moralise; state it once.

Return ONLY a JSON object:
{
  "headline": "one sentence, under 20 words, naming where they actually are",
  "situation": "2-3 short paragraphs reading back their situation",
  "challenges": [{"title": "short", "detail": "2-3 sentences on why this one bites for them"}],
  "topics": [{"title": "short", "why": "one sentence on why this is their next thing to learn"}]
}
Give 2-4 challenges and 3-5 topics.`;

async function actionSummary(payload: any) {
  const runId = payload?.run_id;
  if (!runId) return { status: 400, body: { error: "run_id required" } };

  const db = svc();
  const { data: session } = await db
    .from("enm_quiz_sessions")
    .select("id, run_id, result_title, top_results, ai_summary")
    .eq("run_id", runId).maybeSingle();

  if (!session) return { status: 404, body: { error: "Session not found" } };
  if (session.ai_summary) return { status: 200, body: { summary: session.ai_summary, cached: true } };

  const { data: answers } = await db
    .from("enm_quiz_answers")
    .select("question_number, question_title, option_texts")
    .eq("session_id", session.id).order("question_number");

  const transcript = (answers ?? [])
    .map((a) => `${a.question_number}. ${a.question_title}\n   -> ${(a.option_texts ?? []).join(" | ")}`)
    .join("\n");

  const top = (session.top_results as any[] ?? [])
    .map((r) => `${r.title} (${r.percent}%)`).join(", ");

  const { content } = await ask(
    "summary",
    `Their scored result: ${session.result_title}\nTop matches: ${top}\n\nTheir answers:\n${transcript}`,
    null,
    { system: SUMMARY_SYSTEM, json: true, maxTokens: 6000 },
  );

  const summary = parseJson(content);
  await db.from("enm_quiz_sessions")
    .update({ ai_summary: summary, ai_summary_at: new Date().toISOString() })
    .eq("id", session.id);

  return { status: 200, body: { summary, cached: false } };
}

const REVIEW_SYSTEM = `You are a senior UX researcher reviewing a 20-question personality quiz about
ethical non-monogamy, for the team that owns it. You are looking for problems worth fixing, not praise.

Weight these concerns heavily:
- Coverage: which real user situations have no honest answer?
- Self vs partner: is it clear whose view each question records? Can a single person answer?
- Scoring: options that score nothing, or that score in a way the wording does not justify.
- Safety: anything that mishandles consent, disclosure, or a partner who has not agreed.
- Copy: typos, mixed voice, leading or loaded wording.

Return ONLY a JSON object: {"items": [...]} where each item is
{"question_number": 0 for whole-quiz else 1-20,
 "category": one of coverage|clarity|self-vs-partner|scoring|flow|safety|copy,
 "title": "short imperative finding, under 12 words",
 "finding": "2-4 sentences of specific evidence, quoting the actual wording",
 "recommendation": "2-3 sentences saying exactly what to change"}
Return at most 12 items, the highest-value ones only. Do not repeat items already listed as existing.`;

async function actionReview(payload: any, actor: string) {
  const db = svc();

  const { data: existing } = await db
    .from("enm_quiz_review_items").select("title, question_number").limit(200);
  const { data: feedback } = await db
    .from("enm_quiz_question_feedback")
    .select("question_number, question_title, feedback")
    .order("created_at", { ascending: false }).limit(80);

  const quizText: string = payload?.quiz_text ?? "";
  if (!quizText) return { status: 400, body: { error: "quiz_text required" } };

  const parts = [
    `The quiz as it currently stands:\n${quizText}`,
    existing?.length
      ? `\nFindings already logged (do not repeat these):\n${existing.map((e) => `- Q${e.question_number}: ${e.title}`).join("\n")}`
      : "",
    feedback?.length
      ? `\nVerbatim feedback left by actual quiz takers:\n${feedback.map((f) => `- Q${f.question_number}: ${f.feedback}`).join("\n")}`
      : "",
  ];

  const { content } = await ask("review", parts.join("\n"), actor, {
    system: REVIEW_SYSTEM, json: true, maxTokens: 16000,
  });

  const items = parseJson(content).items ?? [];
  if (!items.length) return { status: 200, body: { added: 0, items: [] } };

  const { data: inserted } = await db.from("enm_quiz_review_items").insert(
    items.slice(0, 12).map((i: any, n: number) => ({
      question_number: Number(i.question_number) || 0,
      category: ["coverage", "clarity", "self-vs-partner", "scoring", "flow", "safety", "copy"]
        .includes(i.category) ? i.category : "clarity",
      title: String(i.title ?? "").slice(0, 200),
      finding: String(i.finding ?? ""),
      recommendation: String(i.recommendation ?? ""),
      source: "ai",
      sort_order: 1000 + n,
    })),
  ).select("id");

  return { status: 200, body: { added: inserted?.length ?? 0 } };
}

async function actionPrompt(payload: any, actor: string) {
  const prompt = String(payload?.prompt ?? "").trim();
  if (!prompt) return { status: 400, body: { error: "prompt required" } };

  const { content, usage } = await ask("prompt", prompt, actor, {
    maxTokens: Math.min(Number(payload?.max_tokens) || 6000, 32000),
    temperature: 0.6,
  });
  return { status: 200, body: { reply: content, usage } };
}

/**
 * Queue a site edit and ask CI to apply it.
 *
 * The model does not write to the repo from here. This records what should
 * change and kicks a GitHub Actions workflow, which runs with the repository's
 * own token and re-checks the path scope before committing. That keeps a
 * long-lived repo-write credential out of the edge environment entirely.
 */
async function actionSiteUpdate(payload: any, actor: string, actorEmail: string | null) {
  const email = String(payload?.email ?? actorEmail ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { status: 400, body: { error: "A valid admin email is required for a rebuild" } };
  }

  const db = svc();
  const itemIds: string[] = Array.isArray(payload?.review_item_ids) ? payload.review_item_ids : [];
  const freeform = String(payload?.instructions ?? "").trim();

  let instructions = freeform;
  if (itemIds.length) {
    const { data: items } = await db
      .from("enm_quiz_review_items")
      .select("id, question_number, title, finding, recommendation, status")
      .in("id", itemIds);

    const accepted = (items ?? []).filter((i) => i.status === "accepted");
    if (!accepted.length) {
      return { status: 400, body: { error: "None of the selected items are accepted" } };
    }
    instructions = accepted.map((i) =>
      `## Q${i.question_number}: ${i.title}\nFinding: ${i.finding}\nDo this: ${i.recommendation}`
    ).join("\n\n") + (freeform ? `\n\nAlso: ${freeform}` : "");
  }

  if (!instructions) return { status: 400, body: { error: "Nothing to apply" } };

  const { data: change, error } = await db.from("enm_quiz_site_changes").insert({
    kind: itemIds.length ? "review_items" : "freeform",
    path_scope: PATH_SCOPE,
    instructions,
    review_item_ids: itemIds,
    requested_by: actor,
    requested_by_email: email,
    status: "queued",
  }).select("id").single();

  if (error) return { status: 500, body: { error: error.message } };

  // Instant trigger when a dispatch token exists; otherwise the scheduled run
  // in the same workflow picks the row up on its next pass.
  let dispatched = false;
  const ghToken = Deno.env.get("ENM_GITHUB_DISPATCH_TOKEN");
  if (ghToken) {
    try {
      const res = await fetch("https://api.github.com/repos/rsonnad/alpacapps/dispatches", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ghToken}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event_type: "enm-quiz-site-update", client_payload: { change_id: change.id } }),
      });
      dispatched = res.ok;
      if (!res.ok) console.warn("dispatch failed", res.status, await res.text());
    } catch (e) {
      console.warn("dispatch threw", e);
    }
  }

  return { status: 200, body: { change_id: change.id, dispatched, email } };
}

/**
 * Deploy notification, called by the site-update workflow.
 *
 * The Resend key lives here already, so CI sends mail through this rather than
 * carrying its own copy of the credential.
 */
async function actionNotifyDeploy(payload: any) {
  const to = String(payload?.to ?? "").trim();
  const subject = String(payload?.subject ?? "ENM quiz update").slice(0, 200);
  const lines: string[] = Array.isArray(payload?.lines) ? payload.lines.slice(0, 12) : [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) {
    return { status: 400, body: { error: "valid `to` required" } };
  }

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { status: 503, body: { error: "RESEND_API_KEY not configured" } };

  const url = "https://alpacaplayhouse.com/rahulio/pages/enmtest/";
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#3c3c3c;max-width:560px">
  <h1 style="font-size:18px;margin:0 0 14px">${subject}</h1>
  ${lines.map((l) => `<p style="margin:0 0 10px;line-height:1.55">${l}</p>`).join("")}
  <p style="margin:18px 0 0"><a href="${url}" style="color:#fc6a77">${url}</a></p>
</div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "ENM Quiz Updater <pai@alpacaplayhouse.com>",
      to: [to],
      subject,
      html,
      text: lines.join("\n\n").replace(/<[^>]+>/g, "") + `\n\n${url}`,
    }),
  });
  if (!res.ok) {
    return { status: 502, body: { error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` } };
  }
  return { status: 200, body: { sent: true } };
}

// ─── Entry ───────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const cors = { ...getCorsHeaders(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(req) });

  try {
    const payload = await req.json();
    const action = String(payload?.action ?? "");

    if (action === "summary") {
      const { status, body } = await actionSummary(payload);
      return new Response(JSON.stringify(body), { status, headers: cors });
    }

    if (action === "notify-deploy") {
      if (!isMachineCaller(req)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
      }
      const { status, body } = await actionNotifyDeploy(payload);
      return new Response(JSON.stringify(body), { status, headers: cors });
    }

    const auth = await requireStaff(req);
    if ("error" in auth) {
      return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: cors });
    }
    const actor = auth.appUser.id;
    const actorEmail = auth.appUser.email ?? null;

    let result;
    if (action === "review") result = await actionReview(payload, actor);
    else if (action === "prompt") result = await actionPrompt(payload, actor);
    else if (action === "site-update") result = await actionSiteUpdate(payload, actor, actorEmail);
    else result = { status: 400, body: { error: `Unknown action: ${action}` } };

    return new Response(JSON.stringify(result.body), { status: result.status, headers: cors });
  } catch (e) {
    console.error("enm-quiz-ai failed", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
