import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Normalize a phone number for database lookup.
 * Strips everything except digits, then tries multiple formats.
 */
function normalizePhone(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  const variants: string[] = [];

  // Full E.164 with +
  if (digits.length === 11 && digits.startsWith("1")) {
    variants.push(`+${digits}`);
    variants.push(digits.slice(1)); // 10 digits
    const d = digits.slice(1);
    variants.push(`(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`);
    variants.push(`${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`);
    variants.push(`${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`);
  } else if (digits.length === 10) {
    variants.push(`+1${digits}`);
    variants.push(digits);
    variants.push(`(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`);
    variants.push(`${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`);
  }

  // Always include the original
  variants.push(phone);

  return [...new Set(variants)];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Telnyx sends webhooks as JSON
    const webhook = await req.json();

    // Telnyx webhook structure: { data: { event_type, payload: { ... } } }
    const eventType = webhook?.data?.event_type;
    const payload = webhook?.data?.payload;

    if (!payload) {
      console.error("Invalid webhook payload:", JSON.stringify(webhook).substring(0, 200));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Only process inbound messages
    if (eventType !== "message.received") {
      console.log("Ignoring event type:", eventType);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const from = payload.from?.phone_number || "";
    const to = payload.to?.[0]?.phone_number || "";
    const body = payload.text || "";
    const messageId = payload.id || "";
    const media = payload.media || [];

    console.log("Inbound SMS received:", { from, to, body: body.substring(0, 50), messageId });

    // Collect media URLs if any
    const mediaUrls: string[] = media.map((m: any) => m.url).filter(Boolean);
    const numMedia = mediaUrls.length;

    // Look up person by phone number
    let personId: string | null = null;
    let personName: string | null = null;

    const { data: people } = await supabase
      .from("people")
      .select("id, first_name, last_name, phone")
      .not("phone", "is", null);

    if (people) {
      for (const person of people) {
        if (!person.phone) continue;
        const personDigits = person.phone.replace(/\D/g, "");
        const fromDigits = from.replace(/\D/g, "");

        // Compare last 10 digits
        const personLast10 = personDigits.slice(-10);
        const fromLast10 = fromDigits.slice(-10);

        if (personLast10 === fromLast10 && personLast10.length === 10) {
          personId = person.id;
          personName = `${person.first_name || ""} ${person.last_name || ""}`.trim();
          break;
        }
      }
    }

    if (personId) {
      console.log(`Matched inbound SMS to person: ${personName} (${personId})`);
    } else {
      console.log(`No person match found for phone: ${from}`);
    }

    // Store inbound message
    const { error: insertError } = await supabase.from("sms_messages").insert({
      person_id: personId,
      direction: "inbound",
      from_number: from,
      to_number: to,
      body: body,
      telnyx_id: messageId,
      status: "received",
      sms_type: "inbound",
      num_media: numMedia,
      media_urls: mediaUrls.length > 0 ? mediaUrls : null,
    });

    if (insertError) {
      console.error("Error storing inbound SMS:", insertError);
    }

    // Return 200 OK (Telnyx expects JSON response)
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Webhook error:", error.message);

    // Still return 200 to prevent Telnyx retries
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
