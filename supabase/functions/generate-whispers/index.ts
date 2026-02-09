/**
 * Generate Whispers Edge Function
 *
 * Calls Claude or Gemini to generate a batch of whisper templates for a chapter,
 * then inserts them into the spirit_whispers table.
 *
 * Requires admin role. Reads AI config from spirit_whisper_config.
 *
 * POST body:
 *   { chapter: 1-4, count?: number, replace?: boolean }
 *   - chapter: which chapter to generate whispers for
 *   - count: how many whispers to generate (default 30)
 *   - replace: if true, deactivates existing whispers for that chapter first
 *
 * Deploy with: supabase functions deploy generate-whispers --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

// AI model pricing (per million tokens)
const MODEL_PRICING: Record<string, { input: number; output: number; provider: string }> = {
  'claude-opus-4-6':       { input: 5.00,  output: 25.00, provider: 'anthropic' },
  'claude-sonnet-4-5':     { input: 3.00,  output: 15.00, provider: 'anthropic' },
  'claude-haiku-4-5':      { input: 1.00,  output: 5.00,  provider: 'anthropic' },
  'gemini-2.5-flash':      { input: 0,     output: 0,     provider: 'gemini' },
  'gemini-2.5-flash-lite': { input: 0,     output: 0,     provider: 'gemini' },
};

async function callClaude(model: string, systemPrompt: string, userPrompt: string) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`Claude API error ${resp.status}: ${errBody.substring(0, 300)}`);
  }

  const result = await resp.json();
  const text = result.content?.[0]?.text || '';
  const inputTokens = result.usage?.input_tokens || 0;
  const outputTokens = result.usage?.output_tokens || 0;

  return { text: text.trim(), inputTokens, outputTokens };
}

async function callGemini(model: string, systemPrompt: string, userPrompt: string) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 8000,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${errBody.substring(0, 300)}`);
  }

  const result = await resp.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = result.usageMetadata || {};
  const inputTokens = usage.promptTokenCount || 0;
  const outputTokens = usage.candidatesTokenCount || 0;

  return { text: text.trim(), inputTokens, outputTokens };
}

function parseWhispersFromAI(rawText: string): any[] {
  // Try to extract JSON array from the response
  let jsonStr = rawText;

  // If response has markdown code fences, extract the JSON
  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // Try to find a JSON array in the response
  const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    jsonStr = arrayMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      throw new Error('Expected JSON array');
    }
    return parsed;
  } catch (err) {
    console.error('Failed to parse AI response as JSON:', jsonStr.substring(0, 200));
    throw new Error('AI response was not valid JSON. Please try again.');
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Auth check — require admin role
    const authHeader = req.headers.get('Authorization');
    const apikey = req.headers.get('apikey') || '';
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user's token
    const userSupabase = createClient(supabaseUrl, apikey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check admin role
    const { data: appUser } = await createClient(supabaseUrl, supabaseServiceKey)
      .from('app_users')
      .select('role')
      .eq('supabase_auth_id', user.id)
      .single();

    if (!appUser || !['admin', 'oracle'].includes(appUser.role)) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request
    const body = await req.json();
    const chapter = body.chapter || 1;
    const count = body.count || 30;
    const replace = body.replace || false;

    if (chapter < 1 || chapter > 4) {
      return new Response(
        JSON.stringify({ error: 'Chapter must be 1-4' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Load config (has prompts and AI model settings)
    const { data: config, error: cfgErr } = await supabase
      .from('spirit_whisper_config')
      .select('*')
      .eq('id', 1)
      .single();

    if (cfgErr || !config) {
      return new Response(
        JSON.stringify({ error: 'Failed to load spirit config' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const model = config.story_ai_model || 'gemini-2.5-flash';
    const provider = config.story_ai_provider || 'gemini';

    // Build prompts
    const systemPrompt = config.story_system_prompt || 'You are PAI, an alpaca spirit guardian.';
    const genPromptTemplate = config.whisper_gen_prompt || 'Generate {count} whisper templates for Chapter {chapter}.';
    const userPrompt = genPromptTemplate
      .replace('{chapter}', String(chapter))
      .replace('{count}', String(count));

    console.log(`Generating ${count} whispers for Chapter ${chapter} using ${provider}/${model}`);

    // Call AI
    let aiResult;
    if (provider === 'anthropic') {
      // For Claude, add JSON instruction since it doesn't have responseMimeType
      const jsonInstructedPrompt = userPrompt + '\n\nIMPORTANT: Return ONLY a valid JSON array. No markdown, no explanation, just the JSON array.';
      aiResult = await callClaude(model, systemPrompt, jsonInstructedPrompt);
    } else {
      aiResult = await callGemini(model, systemPrompt, userPrompt);
    }

    if (!aiResult || !aiResult.text) {
      return new Response(
        JSON.stringify({ error: 'AI returned empty response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse whispers from AI response
    const whispers = parseWhispersFromAI(aiResult.text);

    // Calculate cost
    const pricing = MODEL_PRICING[model] || { input: 0, output: 0, provider: 'unknown' };
    const aiCost = (aiResult.inputTokens * pricing.input / 1_000_000) +
                   (aiResult.outputTokens * pricing.output / 1_000_000);

    // If replacing, deactivate existing whispers for this chapter
    if (replace) {
      const { error: deactivateErr } = await supabase
        .from('spirit_whispers')
        .update({ is_active: false })
        .eq('chapter', chapter);

      if (deactivateErr) {
        console.error('Failed to deactivate existing whispers:', deactivateErr);
      }
    }

    // Insert new whispers
    const insertRows = whispers.map((w: any) => ({
      chapter,
      text_template: w.text_template || w.text || '',
      requires_data: w.requires_data || [],
      voice_override: w.voice_override || null,
      weight: w.weight || 10,
      is_active: true,
    })).filter((w: any) => w.text_template.length > 0);

    const { data: inserted, error: insertErr } = await supabase
      .from('spirit_whispers')
      .insert(insertRows)
      .select();

    if (insertErr) {
      return new Response(
        JSON.stringify({ error: 'Failed to insert whispers: ' + insertErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log cost to compute_costs
    if (aiCost > 0) {
      await supabase.from('compute_costs').insert({
        date: new Date().toISOString().split('T')[0],
        service: provider,
        description: `Whisper Generation Ch${chapter} (${model})`,
        cost_usd: aiCost,
        notes: `Generated ${insertRows.length} whispers. Input: ${aiResult.inputTokens} tokens, Output: ${aiResult.outputTokens} tokens.`,
      });
    }

    console.log(`Generated ${insertRows.length} whispers for Ch${chapter}, cost: $${aiCost.toFixed(4)}`);

    return new Response(
      JSON.stringify({
        success: true,
        chapter,
        count: insertRows.length,
        replaced: replace,
        cost: aiCost,
        inputTokens: aiResult.inputTokens,
        outputTokens: aiResult.outputTokens,
        model,
        provider,
      }),
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
