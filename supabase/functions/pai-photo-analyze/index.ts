/**
 * PAI Photo Analyze — edge function
 *
 * Receives a photo URL + optional prompt from the app,
 * analyzes with Gemini 2.5 Flash vision, routes through PAI-style logic
 * (create task, categorize as marketing, social media, etc.),
 * records the submission, and emails results to the uploader.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders } from "../_shared/api-helpers.ts";

// ─── Types ─────────────────────────────────────────────────────────

interface PhotoAnalysisRequest {
  photo_url: string;
  media_id?: string;
  prompt?: string | null;
  user_id: string;
  user_name: string;
  user_email?: string | null;
}

interface AnalysisResult {
  category: "work_task" | "marketing" | "social_media" | "receipt" | "document" | "alpaca" | "other";
  action: string;          // what PAI decided to do
  action_label: string;    // human-readable label
  summary: string;         // description of analysis
  task_title?: string;     // if category is work_task
  task_notes?: string;
  task_priority?: number;  // 1-4
  task_space?: string;
  social_caption?: string; // if category is social_media or alpaca
  tags?: string[];
}

// ─── Helpers ───────────────────────────────────────────────────────

function jsonResponse(req: Request, body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

// ─── Gemini Vision Analysis ────────────────────────────────────────

async function analyzePhoto(
  photoUrl: string,
  prompt: string | null,
  userName: string,
  geminiApiKey: string
): Promise<AnalysisResult> {
  // Download the image and convert to base64
  const imgResp = await fetch(photoUrl);
  if (!imgResp.ok) throw new Error("Failed to download photo for analysis");
  const imgBuffer = new Uint8Array(await imgResp.arrayBuffer());
  let binaryStr = "";
  const chunkSize = 8192;
  for (let i = 0; i < imgBuffer.length; i += chunkSize) {
    const chunk = imgBuffer.subarray(i, i + chunkSize);
    binaryStr += String.fromCharCode(...chunk);
  }
  const base64Data = btoa(binaryStr);
  const contentType = imgResp.headers.get("content-type") || "image/jpeg";

  const systemPrompt = `You are PAI (Property AI Assistant) for Alpaca Playhouse, a property management company with alpacas.

A team member named "${userName}" just uploaded a photo${prompt ? ` with this note: "${prompt}"` : " with no specific instructions"}.

Analyze the photo and determine the best action. Classify into ONE of these categories:

1. **work_task** — Photo shows something that needs fixing, building, cleaning, or maintaining. Create a task.
2. **marketing** — Photo is a nice shot of the property, rooms, amenities, or scenery suitable for marketing materials.
3. **social_media** — Photo is fun, interesting, or engaging content good for social media posting.
4. **alpaca** — Photo features alpacas — perfect for Instagram/social media with a fun caption.
5. **receipt** — Photo of a receipt or invoice.
6. **document** — Photo of a document, permit, label, or informational material.
7. **other** — Doesn't fit above categories.

If the user's prompt/tags suggest a specific category, FOLLOW THEIR DIRECTION. For example:
- "new task: fix the fence" → work_task
- "marketing shot" → marketing
- "for instagram" → social_media or alpaca
- "receipt" → receipt

Return a JSON object with this EXACT structure:
{
  "category": "work_task|marketing|social_media|alpaca|receipt|document|other",
  "action": "short machine action label",
  "action_label": "Human-readable action taken (e.g. 'Task Created', 'Marketing Photo Filed', 'Alpaca Post Ready')",
  "summary": "2-3 sentence description of what you see and what you did with it",
  "task_title": "only if work_task — concise task title",
  "task_notes": "only if work_task — detailed description of what needs to be done",
  "task_priority": 3,
  "task_space": "only if work_task and you can identify the space/room from the photo",
  "social_caption": "only if social_media or alpaca — fun engaging caption with relevant hashtags",
  "tags": ["relevant", "tags", "for", "categorization"]
}

Return ONLY valid JSON, no markdown, no explanation.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt },
              {
                inline_data: {
                  mime_type: contentType,
                  data: base64Data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2000,
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Gemini photo analysis failed: ${res.status} — ${errText}`);
    throw new Error(`Gemini analysis failed (${res.status})`);
  }

  const result = await res.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

  // Log token usage
  const usage = result.usageMetadata;
  if (usage) {
    console.log(`Gemini photo analysis: in=${usage.promptTokenCount}, out=${usage.candidatesTokenCount}`);
  }

  // Parse JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in Gemini response");

  return JSON.parse(jsonMatch[0]) as AnalysisResult;
}

// ─── Action Handlers ───────────────────────────────────────────────

async function handleWorkTask(
  supabase: any,
  analysis: AnalysisResult,
  photoUrl: string,
  userId: string,
  userName: string
): Promise<string | null> {
  try {
    // Resolve space if mentioned
    let spaceId: string | null = null;
    if (analysis.task_space) {
      const { data: space } = await supabase
        .from("spaces")
        .select("id")
        .ilike("name", `%${analysis.task_space}%`)
        .eq("is_archived", false)
        .limit(1)
        .maybeSingle();
      if (space) spaceId = space.id;
    }

    const { data: task, error } = await supabase
      .from("tasks")
      .insert({
        title: analysis.task_title || "Photo-reported task",
        notes: analysis.task_notes || analysis.summary,
        priority: analysis.task_priority || 3,
        status: "open",
        space_id: spaceId,
        created_by: userId,
        photo_url: photoUrl,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Task creation error:", error);
      return null;
    }
    return task.id;
  } catch (err) {
    console.error("handleWorkTask error:", err);
    return null;
  }
}

async function handleMediaCategorization(
  supabase: any,
  mediaId: string | undefined,
  analysis: AnalysisResult
): Promise<void> {
  if (!mediaId) return;
  try {
    // Tag the media record with the AI-detected category
    await supabase
      .from("media")
      .update({
        category: analysis.category === "alpaca" ? "social_media" : analysis.category,
        ai_tags: analysis.tags || [],
        ai_caption: analysis.social_caption || null,
      })
      .eq("id", mediaId);
  } catch (_e) {
    // Non-critical
  }
}

// ─── Email Results ─────────────────────────────────────────────────

async function emailResults(
  supabaseUrl: string,
  serviceKey: string,
  toEmail: string,
  analysis: AnalysisResult,
  photoUrl: string,
  userName: string
): Promise<boolean> {
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        type: "pai_email_reply",
        to: toEmail,
        from: "PAI <pai@alpacaplayhouse.com>",
        data: {
          reply_body: buildEmailBody(analysis, photoUrl, userName),
          original_subject: "Photo AI Analysis",
          original_body: analysis.summary,
        },
      }),
    });
    return resp.ok;
  } catch (e) {
    console.error("Email results error:", e);
    return false;
  }
}

function buildEmailBody(analysis: AnalysisResult, photoUrl: string, userName: string): string {
  let body = `Hi ${userName},\n\nPAI analyzed your photo. Here's what I found:\n\n`;
  body += `📋 Category: ${analysis.action_label}\n\n`;
  body += `${analysis.summary}\n`;

  if (analysis.category === "work_task" && analysis.task_title) {
    body += `\n🔨 Task Created: "${analysis.task_title}"\n`;
    if (analysis.task_notes) body += `Details: ${analysis.task_notes}\n`;
    if (analysis.task_space) body += `Location: ${analysis.task_space}\n`;
  }

  if (analysis.social_caption) {
    body += `\n📱 Suggested Caption:\n${analysis.social_caption}\n`;
  }

  if (analysis.tags?.length) {
    body += `\n🏷️ Tags: ${analysis.tags.join(", ")}\n`;
  }

  body += `\n📸 Photo: ${photoUrl}\n`;
  body += `\n— PAI, Property AI Assistant`;
  return body;
}

// ─── Main Handler ──────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  if (!geminiApiKey) {
    return jsonResponse(req, { error: "GEMINI_API_KEY not configured" }, 500);
  }

  try {
    const body: PhotoAnalysisRequest = await req.json();
    const { photo_url, media_id, prompt, user_id, user_name, user_email } = body;

    if (!photo_url || !user_id) {
      return jsonResponse(req, { error: "photo_url and user_id are required" }, 400);
    }

    // 1. Analyze photo with Gemini 2.5 Flash
    const analysis = await analyzePhoto(photo_url, prompt || null, user_name, geminiApiKey);

    // 2. Take action based on category
    let taskId: string | null = null;

    if (analysis.category === "work_task") {
      taskId = await handleWorkTask(supabase, analysis, photo_url, user_id, user_name);
    }

    // Categorize the media record
    await handleMediaCategorization(supabase, media_id, analysis);

    // 3. Record submission
    try {
      await supabase.from("photo_ai_submissions").insert({
        app_user_id: user_id,
        photo_url,
        media_id: media_id || null,
        prompt: prompt || null,
        category: analysis.category,
        action_taken: analysis.action_label,
        summary: analysis.summary,
        task_id: taskId,
        ai_response: analysis,
      });
    } catch (e) {
      console.error("Failed to record submission:", e);
    }

    // 4. Log API usage
    try {
      await supabase.from("api_usage_log").insert({
        vendor: "google",
        category: "gemini_photo_analysis",
        endpoint: "gemini-2.5-flash:generateContent",
        units: 1,
        unit_type: "api_calls",
        estimated_cost_usd: 0.002,
        metadata: { user_name, category: analysis.category, prompt: prompt || null },
        app_user_id: user_id,
      });
    } catch (_e) { /* non-critical */ }

    // 5. Email results
    let emailed = false;
    if (user_email) {
      emailed = await emailResults(
        supabaseUrl, supabaseServiceKey, user_email, analysis, photo_url, user_name
      );
    }

    return jsonResponse(req, {
      success: true,
      category: analysis.category,
      action_label: analysis.action_label,
      summary: analysis.summary,
      task_id: taskId,
      social_caption: analysis.social_caption || null,
      tags: analysis.tags || [],
      emailed,
    });
  } catch (error) {
    console.error("pai-photo-analyze error:", error.message);
    return jsonResponse(req, { error: error.message || "Analysis failed" }, 500);
  }
});
