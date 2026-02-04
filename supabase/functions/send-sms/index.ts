import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// SMS template types
type SmsType =
  | "payment_reminder"
  | "payment_overdue"
  | "payment_received"
  | "deposit_requested"
  | "deposit_received"
  | "lease_sent"
  | "lease_signed"
  | "move_in_confirmed"
  | "general"
  | "bulk_announcement";

interface SmsRequest {
  type: SmsType;
  to: string;
  data: Record<string, any>;
  person_id?: string;
}

interface TwilioConfig {
  account_sid: string;
  auth_token: string;
  phone_number: string;
  is_active: boolean;
  test_mode: boolean;
}

// SMS template generator - short messages for each type
function getSmsBody(type: SmsType, data: Record<string, any>): string {
  switch (type) {
    case "payment_reminder":
      return `Hi ${data.first_name}, friendly reminder: your ${data.period || 'rent'} of $${data.amount} is due ${data.due_date}. Pay via Venmo @AlpacaPlayhouse or Zelle payments@alpacaplayhouse.com - Alpaca Playhouse`;

    case "payment_overdue":
      return `Hi ${data.first_name}, your rent of $${data.amount} was due ${data.due_date} and is ${data.days_overdue} day(s) overdue.${data.late_fee ? ` Late fee: $${data.late_fee}. Total: $${data.total_due}.` : ''} Please pay ASAP. - Alpaca Playhouse`;

    case "payment_received":
      return `Hi ${data.first_name}, we received your $${data.amount} payment${data.period ? ` for ${data.period}` : ''}. Thank you! - Alpaca Playhouse`;

    case "deposit_requested":
      return `Hi ${data.first_name}, your deposit of $${data.total_due} is due${data.due_date ? ` by ${data.due_date}` : ''}. Pay via Venmo @AlpacaPlayhouse or Zelle payments@alpacaplayhouse.com - Alpaca Playhouse`;

    case "deposit_received":
      return `Hi ${data.first_name}, we received your $${data.amount} deposit.${data.remaining_balance > 0 ? ` Remaining: $${data.remaining_balance}.` : ' All deposits received!'} Thank you! - Alpaca Playhouse`;

    case "lease_sent":
      return `Hi ${data.first_name}, your lease agreement has been sent for e-signature. Please check your email from SignWell and sign at your earliest convenience. - Alpaca Playhouse`;

    case "lease_signed":
      return `Hi ${data.first_name}, your lease has been signed! Next: submit your deposits. Details sent via email. - Alpaca Playhouse`;

    case "move_in_confirmed":
      return `Hi ${data.first_name}, welcome to Alpaca Playhouse! Your move-in is confirmed for ${data.move_in_date}. Rent of $${data.monthly_rate} is due the 1st of each month. - Alpaca Playhouse`;

    case "general":
      return data.message || data.body || "";

    case "bulk_announcement":
      return data.message || data.body || "";

    default:
      throw new Error(`Unknown SMS type: ${type}`);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Parse request
    const body: SmsRequest = await req.json();
    const { type, to, data, person_id } = body;

    if (!type || !to || !data) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: type, to, data" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load Twilio config from database
    const { data: config, error: configError } = await supabase
      .from("twilio_config")
      .select("*")
      .single();

    if (configError || !config) {
      console.error("Twilio config not found:", configError);
      return new Response(
        JSON.stringify({ error: "Twilio not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const twilioConfig = config as TwilioConfig;

    if (!twilioConfig.is_active) {
      return new Response(
        JSON.stringify({ error: "Twilio SMS is disabled" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!twilioConfig.phone_number) {
      return new Response(
        JSON.stringify({ error: "Twilio phone number not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate message body from template
    const messageBody = getSmsBody(type, data);

    if (!messageBody) {
      return new Response(
        JSON.stringify({ error: "Empty message body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Test mode: log but don't send
    if (twilioConfig.test_mode) {
      console.log("TEST MODE - SMS not sent:", { type, to, body: messageBody });

      // Log to sms_messages table
      await supabase.from("sms_messages").insert({
        person_id: person_id || null,
        direction: "outbound",
        from_number: twilioConfig.phone_number,
        to_number: to,
        body: messageBody,
        sms_type: type,
        twilio_sid: `TEST_${Date.now()}`,
        status: "test",
      });

      return new Response(
        JSON.stringify({ success: true, sid: `TEST_${Date.now()}`, test_mode: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send via Twilio API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioConfig.account_sid}/Messages.json`;
    const authHeader = btoa(`${twilioConfig.account_sid}:${twilioConfig.auth_token}`);

    const twilioResponse = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: twilioConfig.phone_number,
        To: to,
        Body: messageBody,
      }),
    });

    const twilioResult = await twilioResponse.json();

    if (!twilioResponse.ok) {
      console.error("Twilio API error:", twilioResult);

      // Log failed message
      await supabase.from("sms_messages").insert({
        person_id: person_id || null,
        direction: "outbound",
        from_number: twilioConfig.phone_number,
        to_number: to,
        body: messageBody,
        sms_type: type,
        status: "failed",
        error_code: twilioResult.code?.toString() || twilioResult.status?.toString(),
        error_message: twilioResult.message || "Twilio API error",
      });

      return new Response(
        JSON.stringify({ error: "Failed to send SMS", details: twilioResult }),
        { status: twilioResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log successful message
    await supabase.from("sms_messages").insert({
      person_id: person_id || null,
      direction: "outbound",
      from_number: twilioConfig.phone_number,
      to_number: to,
      body: messageBody,
      sms_type: type,
      twilio_sid: twilioResult.sid,
      status: twilioResult.status || "sent",
    });

    console.log("SMS sent successfully:", { type, to, sid: twilioResult.sid });

    return new Response(
      JSON.stringify({ success: true, sid: twilioResult.sid }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
