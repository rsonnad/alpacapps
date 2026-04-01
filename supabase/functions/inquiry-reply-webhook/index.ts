// Inquiry Reply Webhook — receives inbound email replies from Resend
// When an assignee replies to an inquiry notification email, this function:
// 1. Parses the inquiry ID from the reply-to address
// 2. Saves the reply as the inquiry answer
// 3. Notifies the original submitter via email

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();

    // Resend inbound email webhook payload
    // The reply-to address format: inquiry+{inquiry_id}@alpacaplayhouse.com
    const to = body.to || body.headers?.to || '';
    const from = body.from || body.headers?.from || '';
    const text = body.text || body.stripped_text || '';
    const subject = body.subject || '';

    // Extract inquiry ID from the To address
    const inquiryIdMatch = to.match(/inquiry\+([a-f0-9-]+)@/i);
    if (!inquiryIdMatch) {
      console.error('Could not parse inquiry ID from To address:', to);
      return new Response(JSON.stringify({ error: 'Invalid reply address' }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const inquiryId = inquiryIdMatch[1];
    console.log(`Processing reply for inquiry ${inquiryId} from ${from}`);

    // Clean the reply text — strip quoted text / signature
    const cleanedReply = stripQuotedText(text).trim();
    if (!cleanedReply) {
      return new Response(JSON.stringify({ error: 'Empty reply' }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the inquiry
    const { data: inquiry, error: fetchErr } = await supabase
      .from('project_inquiries')
      .select('*, app_users!project_inquiries_app_user_id_fkey(id, email, first_name, display_name)')
      .eq('id', inquiryId)
      .single();

    if (fetchErr || !inquiry) {
      console.error('Inquiry not found:', inquiryId, fetchErr);
      return new Response(JSON.stringify({ error: 'Inquiry not found' }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up the responder by email
    const senderEmail = from.match(/<([^>]+)>/)?.[1] || from.trim();
    const { data: responder } = await supabase
      .from('app_users')
      .select('id, first_name, last_name, display_name')
      .eq('email', senderEmail)
      .single();

    const responderName = responder
      ? (responder.first_name && responder.last_name
        ? `${responder.first_name} ${responder.last_name}`
        : responder.display_name || senderEmail)
      : senderEmail;

    // Update the inquiry with the answer
    const { error: updateErr } = await supabase
      .from('project_inquiries')
      .update({
        answer: cleanedReply,
        status: 'completed',
        completed_at: new Date().toISOString(),
        responded_by: responder?.id || null,
      })
      .eq('id', inquiryId);

    if (updateErr) {
      console.error('Failed to update inquiry:', updateErr);
      return new Response(JSON.stringify({ error: 'Update failed' }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Inquiry ${inquiryId} answered by ${responderName}`);

    // Notify the original submitter
    const submitter = inquiry.app_users;
    if (submitter?.email) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            type: 'inquiry_answered',
            to: submitter.email,
            data: {
              first_name: submitter.first_name || submitter.display_name || 'there',
              question: inquiry.question || inquiry.caption || 'Project inquiry',
              caption: inquiry.caption || '',
              image_url: inquiry.image_url || '',
              answer: cleanedReply,
              responder_name: responderName,
            },
          }),
        });
        console.log(`Notification sent to submitter: ${submitter.email}`);
      } catch (emailErr) {
        console.error('Failed to send notification to submitter:', emailErr);
      }
    }

    return new Response(JSON.stringify({ success: true, inquiry_id: inquiryId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error('Webhook error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Strip quoted reply text and email signatures from the reply body.
 * Keeps only the new reply content.
 */
function stripQuotedText(text: string): string {
  const lines = text.split('\n');
  const cleanLines: string[] = [];

  for (const line of lines) {
    // Stop at common quote markers
    if (/^On .+ wrote:$/i.test(line.trim())) break;
    if (/^>/.test(line.trim())) break;
    if (/^-{3,}/.test(line.trim())) break;
    if (/^_{3,}/.test(line.trim())) break;
    if (/^From:/.test(line.trim())) break;
    if (/^Sent from my/.test(line.trim())) break;
    cleanLines.push(line);
  }

  return cleanLines.join('\n').trim();
}
