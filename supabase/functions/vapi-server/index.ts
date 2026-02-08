import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Vapi Server URL handler.
 *
 * When a call comes in, Vapi sends an "assistant-request" message to this URL.
 * We return a full assistant configuration with the prompt from our database,
 * optionally personalized based on the caller's phone number.
 *
 * This lets us manage prompts in Supabase instead of the Vapi dashboard.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    const messageType = body.message?.type || body.type;

    console.log("Vapi server URL request:", messageType);

    // Only handle assistant-request messages
    if (messageType !== "assistant-request") {
      // Forward other message types (function-call, etc.) with empty response
      return jsonResponse({});
    }

    // Extract caller info
    const callerPhone =
      body.message?.call?.customer?.number ||
      body.call?.customer?.number ||
      null;

    console.log("Incoming call from:", callerPhone);

    // Check if voice system is active
    const { data: config } = await supabase
      .from("vapi_config")
      .select("*")
      .eq("id", 1)
      .single();

    if (!config?.is_active) {
      console.log("Voice system is disabled");
      return jsonResponse({ error: "Voice system is disabled" }, 503);
    }

    // Load the default active assistant
    const { data: assistant, error: assistantError } = await supabase
      .from("voice_assistants")
      .select("*")
      .eq("is_active", true)
      .eq("is_default", true)
      .limit(1)
      .single();

    if (assistantError || !assistant) {
      // Fallback: get any active assistant
      const { data: fallback } = await supabase
        .from("voice_assistants")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      if (!fallback) {
        console.error("No active voice assistant configured");
        return jsonResponse(
          { error: "No voice assistant configured" },
          503
        );
      }

      return jsonResponse(buildAssistantConfig(fallback, callerPhone, null));
    }

    // Try to identify the caller
    let callerName: string | null = null;
    if (callerPhone) {
      const digits = callerPhone.replace(/\D/g, "");
      const last10 = digits.slice(-10);

      if (last10.length === 10) {
        const { data: people } = await supabase
          .from("people")
          .select("id, first_name, last_name, phone")
          .not("phone", "is", null);

        if (people) {
          for (const person of people) {
            if (!person.phone) continue;
            const personLast10 = person.phone.replace(/\D/g, "").slice(-10);
            if (personLast10 === last10) {
              callerName =
                `${person.first_name || ""} ${person.last_name || ""}`.trim();
              console.log(`Identified caller: ${callerName}`);
              break;
            }
          }
        }
      }
    }

    const assistantConfig = buildAssistantConfig(
      assistant,
      callerPhone,
      callerName
    );

    // In test mode, add a note to the system prompt
    if (config.test_mode) {
      assistantConfig.assistant.model.messages[0].content +=
        "\n\n[TEST MODE: This is a test call. Mention that this is a test if asked.]";
      console.log("Test mode: added test notice to prompt");
    }

    return jsonResponse(assistantConfig);
  } catch (error) {
    console.error("Vapi server URL error:", error.message);
    return jsonResponse({ error: error.message }, 500);
  }
});

/**
 * Build the Vapi assistant configuration from our DB assistant record.
 */
function buildAssistantConfig(
  assistant: any,
  callerPhone: string | null,
  callerName: string | null
) {
  // Personalize the prompt if we know the caller
  let systemPrompt = assistant.system_prompt;
  if (callerName) {
    systemPrompt += `\n\nThe caller has been identified as ${callerName}. You may greet them by name.`;
  }

  // Personalize the greeting
  let firstMessage = assistant.first_message;
  if (callerName) {
    firstMessage = `Hi ${callerName.split(" ")[0]}! Thanks for calling. How can I help you today?`;
  }

  // Map model provider to Vapi model config
  const modelConfig: any = {
    provider: assistant.model_provider === "google" ? "google" : "openai",
    model: assistant.model_name,
    temperature: parseFloat(assistant.temperature) || 0.7,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
    ],
  };

  // Build voice config
  const voiceConfig: any = {
    provider: assistant.voice_provider || "11labs",
    voiceId: assistant.voice_id || "sarah",
  };

  return {
    assistant: {
      model: modelConfig,
      voice: voiceConfig,
      firstMessage: firstMessage,
      maxDurationSeconds: assistant.max_duration_seconds || 600,
      // Enable transcription and recording
      transcriber: {
        provider: "deepgram",
        model: "nova-2",
        language: "en",
      },
      // Analysis settings for end-of-call
      analysisPlan: {
        summaryPrompt:
          "Summarize the call in 2-3 sentences. Include what the caller wanted and the outcome.",
      },
      // Silence and end-of-speech detection
      silenceTimeoutSeconds: 30,
      responseDelaySeconds: 0.5,
      ...(assistant.metadata || {}),
    },
  };
}
