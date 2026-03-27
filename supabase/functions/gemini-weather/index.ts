import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { getCorsHeaders } from "../_shared/api-helpers.ts";
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY not configured");
    }

    const { contents, generationConfig } = await req.json();

    if (!contents?.length) {
      return new Response(
        JSON.stringify({ error: "contents required" }),
        { status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: generationConfig || { temperature: 0.3, maxOutputTokens: 2048 },
        }),
      }
    );

    if (!geminiResp.ok) {
      const err = await geminiResp.json();
      console.error("Gemini error:", JSON.stringify(err));
      return new Response(
        JSON.stringify({ error: err?.error?.message || "Gemini API error" }),
        { status: geminiResp.status, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    const data = await geminiResp.json();
    return new Response(JSON.stringify(data), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error.message, error.stack);
    return new Response(
      JSON.stringify({ error: "Internal error processing weather request" }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
