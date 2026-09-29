// Inquiry Digest — sends daily email reminders for unanswered project inquiries
// Called via cron (pg_cron or external scheduler) at ~9am CT daily
// Sends a single digest email to each assignee with their pending inquiries

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

    // Find all inquiries awaiting response
    const { data: pending, error } = await supabase
      .from('project_inquiries')
      .select('id, question, caption, image_url, inquiry_type, created_at, assigned_to, assigned_to_name, app_user_id')
      .eq('status', 'awaiting_response')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Query failed:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!pending || pending.length === 0) {
      console.log('No pending inquiries — no digest needed');
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by assignee
    const byAssignee = new Map<string, typeof pending>();
    for (const inq of pending) {
      if (!inq.assigned_to) continue;
      const existing = byAssignee.get(inq.assigned_to) || [];
      existing.push(inq);
      byAssignee.set(inq.assigned_to, existing);
    }

    // Look up submitter names in bulk
    const submitterIds = [...new Set(pending.map(p => p.app_user_id).filter(Boolean))];
    const { data: submitters } = await supabase
      .from('app_users')
      .select('id, first_name, last_name, display_name')
      .in('id', submitterIds);

    const submitterMap = new Map<string, string>();
    (submitters || []).forEach((s: any) => {
      const name = s.first_name && s.last_name
        ? `${s.first_name} ${s.last_name}`
        : s.display_name || 'Unknown';
      submitterMap.set(s.id, name);
    });

    let sent = 0;

    for (const [assigneeId, inquiries] of byAssignee) {
      // Look up assignee email
      const { data: assignee } = await supabase
        .from('app_users')
        .select('email, first_name, display_name')
        .eq('id', assigneeId)
        .single();

      if (!assignee?.email) {
        console.warn(`No email for assignee ${assigneeId}, skipping`);
        continue;
      }

      // Build inquiry data with submitter names
      const enrichedInquiries = inquiries.map(inq => ({
        ...inq,
        submitter_name: submitterMap.get(inq.app_user_id) || 'Unknown',
      }));

      // Send digest email
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            type: 'inquiry_digest',
            to: assignee.email,
            data: {
              first_name: assignee.first_name || assignee.display_name || 'there',
              inquiries: enrichedInquiries,
            },
          }),
        });

        if (resp.ok) {
          console.log(`Digest sent to ${assignee.email} (${inquiries.length} inquiries)`);
          sent++;
        } else {
          const text = await resp.text();
          console.error(`Failed to send digest to ${assignee.email}:`, text);
        }
      } catch (emailErr) {
        console.error(`Email error for ${assignee.email}:`, emailErr);
      }
    }

    console.log(`Digest complete: ${sent} email(s) sent for ${pending.length} pending inquiries`);

    return new Response(JSON.stringify({ sent, pending_count: pending.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error('Digest error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
