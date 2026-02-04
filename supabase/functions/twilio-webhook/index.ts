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
    // Twilio sends webhooks as application/x-www-form-urlencoded
    const formData = await req.formData();

    const from = (formData.get("From") as string) || "";
    const to = (formData.get("To") as string) || "";
    const body = (formData.get("Body") as string) || "";
    const messageSid = (formData.get("MessageSid") as string) || "";
    const numMedia = parseInt((formData.get("NumMedia") as string) || "0", 10);

    console.log("Inbound SMS received:", { from, to, body: body.substring(0, 50), messageSid });

    // Collect media URLs if any
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = formData.get(`MediaUrl${i}`) as string;
      if (url) mediaUrls.push(url);
    }

    // Look up person by phone number
    const phoneVariants = normalizePhone(from);
    let personId: string | null = null;
    let personName: string | null = null;

    // Try to find a matching person
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
      twilio_sid: messageSid,
      status: "received",
      sms_type: "inbound",
      num_media: numMedia,
      media_urls: mediaUrls.length > 0 ? mediaUrls : null,
    });

    if (insertError) {
      console.error("Error storing inbound SMS:", insertError);
    }

    // Return empty TwiML response (no auto-reply)
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        status: 200,
        headers: {
          "Content-Type": "text/xml",
        },
      }
    );

  } catch (error) {
    console.error("Webhook error:", error.message);

    // Still return valid TwiML even on error to prevent Twilio retries
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        status: 200,
        headers: {
          "Content-Type": "text/xml",
        },
      }
    );
  }
});
