/**
 * Generate Daily Fact Edge Function
 *
 * Generates one alpaca fact per day using Gemini API, caches in kiosk_facts table.
 * Idempotent: returns cached fact if today's already exists.
 *
 * Deploy with: supabase functions deploy generate-daily-fact
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

function getAustinToday(): string {
  const now = new Date();
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); // YYYY-MM-DD
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = getAustinToday();

    // Check for force regenerate
    const url = new URL(req.url);
    const force = url.searchParams.get('force') === 'true';

    // Check if today's fact already exists
    if (!force) {
      const { data: existing } = await supabase
        .from('kiosk_facts')
        .select('fact_text')
        .eq('generated_date', today)
        .single();

      if (existing) {
        return new Response(
          JSON.stringify({ fact: existing.fact_text, cached: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Generate a new fact with Gemini
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const geminiResp = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: 'Generate one fun, interesting, or surprising fact about alpacas. Keep it to 1-2 sentences. Be creative and varied. Do not start with "Did you know". Just state the fact directly.'
          }]
        }],
        generationConfig: { temperature: 0.95, maxOutputTokens: 200 },
      }),
    });

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      console.error('Gemini API error:', errText);
      return new Response(
        JSON.stringify({ error: 'Failed to generate fact' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const geminiData = await geminiResp.json();
    const factText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!factText) {
      return new Response(
        JSON.stringify({ error: 'Empty response from Gemini' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Upsert the fact (handles both insert and force-regenerate)
    const { error: upsertError } = await supabase
      .from('kiosk_facts')
      .upsert(
        { fact_text: factText, generated_date: today, created_at: new Date().toISOString() },
        { onConflict: 'generated_date' }
      );

    if (upsertError) {
      console.error('Failed to store fact:', upsertError);
    }

    return new Response(
      JSON.stringify({ fact: factText, cached: false }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
