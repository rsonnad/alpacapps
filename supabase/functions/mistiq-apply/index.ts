import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action, ...data } = body

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // --- TRACK: page views and button clicks ---
    if (action === 'track') {
      await supabase.from('mistiq_events').insert({
        event_type: data.event_type || 'pageview',
        page: data.page || 'unknown',
        element: data.element || null,
        lang: data.language || 'en',
        referrer: data.referrer || null,
        user_agent: req.headers.get('user-agent') || null,
        metadata: data.metadata || {},
      })

      // Send email notification for button clicks (apply / refer)
      if (data.event_type === 'click' && data.element) {
        const clickLabel: Record<string, string> = {
          apply_btn: '✅ Apply button clicked',
          refer_btn: '📨 Refer button clicked',
          apply_hero: '✅ Apply button clicked (hero)',
          refer_hero: '📨 Refer button clicked (hero)',
          apply_cta: '✅ Apply button clicked (CTA)',
        }
        const label = clickLabel[data.element] || `🖱️ Click: ${data.element}`
        const pageLabel = data.page || 'unknown page'
        const langLabel = data.language === 'th' ? 'Thai 🇹🇭' : 'English 🇺🇸'
        const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'full', timeStyle: 'short' })

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Mistique Journey <noreply@alpacaplayhouse.com>',
            to: ['rahulioson@gmail.com'],
            subject: `${label} — Mistique Journey`,
            html: `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:24px;">
              <h2 style="color:#8b7355;margin:0 0 16px;">${label}</h2>
              <table style="width:100%;border-collapse:collapse;">
                <tr><td style="padding:8px 0;color:#6b6b6b;font-size:13px;">Page</td><td style="padding:8px 0;font-weight:600;">${pageLabel}</td></tr>
                <tr><td style="padding:8px 0;color:#6b6b6b;font-size:13px;">Language</td><td style="padding:8px 0;font-weight:600;">${langLabel}</td></tr>
                <tr><td style="padding:8px 0;color:#6b6b6b;font-size:13px;">Referrer</td><td style="padding:8px 0;">${data.referrer || '—'}</td></tr>
                <tr><td style="padding:8px 0;color:#6b6b6b;font-size:13px;">Time</td><td style="padding:8px 0;">${ts} (Austin)</td></tr>
              </table>
            </div>`,
          }),
        }).catch((e) => console.error('Click email error:', e))
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // --- APPLY: job application submission ---
    if (action === 'apply') {
      // Log the application event
      await supabase.from('mistiq_events').insert({
        event_type: 'application',
        page: data.language === 'th' ? 'apply_th' : 'apply_en',
        lang: data.language || 'en',
        user_agent: req.headers.get('user-agent') || null,
        referrer: data.referrer || null,
        metadata: data,
      })

      // Send email via Resend
      const emailHtml = buildEmailHtml(data)

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Mistique Journey <noreply@alpacaplayhouse.com>',
          to: ['rahulioson@gmail.com'],
          subject: `New Job Application — ${data.full_name || 'Unknown Applicant'}`,
          html: emailHtml,
        }),
      })

      if (!emailRes.ok) {
        const errText = await emailRes.text()
        console.error('Resend error:', errText)
        throw new Error(`Email send failed: ${errText}`)
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('mistiq-apply error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

function field(label: string, value: string | undefined): string {
  const v = value?.trim() || '—'
  return `
    <div style="margin-bottom:14px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#8b7355;margin-bottom:3px;">${label}</div>
      <div style="color:#3d3d3d;font-size:15px;">${v}</div>
    </div>`
}

function buildEmailHtml(d: Record<string, string>): string {
  const submitted = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    dateStyle: 'full',
    timeStyle: 'short',
  })

  const interests = Array.isArray(d.primary_interests)
    ? d.primary_interests.join(', ')
    : d.primary_interests || '—'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Job Application</title>
</head>
<body style="margin:0;padding:0;background:#f0ebe3;font-family:Arial,sans-serif;">
  <div style="max-width:680px;margin:24px auto;background:#f9f6f1;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">

    <!-- Header -->
    <div style="background:#8b7355;padding:28px 32px;text-align:center;">
      <h1 style="margin:0;color:white;font-size:22px;letter-spacing:0.02em;">New Job Application</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Mistique Journey — Global Traveling Massage Therapist</p>
    </div>

    <!-- Personal Information -->
    <div style="background:white;margin:16px;padding:24px;border-radius:8px;">
      <h3 style="margin:0 0 18px;color:#8b7355;font-size:16px;border-bottom:1px solid #e8ddd0;padding-bottom:10px;">Personal Information</h3>
      ${field('Full Name', d.full_name)}
      ${field('Phone / WhatsApp / Line ID', d.phone)}
      ${field('Email Address', d.email)}
      ${field('Current City of Residence', d.city)}
      ${field('Date of Birth', d.dob)}
      ${field('Valid Passport', d.passport)}
      ${field('US / European Visas', d.visas || 'Not specified')}
    </div>

    <!-- Skills -->
    <div style="background:white;margin:16px;padding:24px;border-radius:8px;">
      <h3 style="margin:0 0 18px;color:#8b7355;font-size:16px;border-bottom:1px solid #e8ddd0;padding-bottom:10px;">Skills &amp; Qualifications</h3>
      ${field('Thai Massage Proficiency (1–10)', d.thai_massage_level)}
      ${field('Other Massage Specializations', d.other_massage)}
      ${field('English Communication Skills', d.english_level)}
      ${field('English Learning Interest', d.english_learning)}
      ${field('Walking Ability (5 km)', d.walking_ability)}
      ${field('International Travel Experience', d.travel_experience)}
    </div>

    <!-- Motivations -->
    <div style="background:white;margin:16px;padding:24px;border-radius:8px;">
      <h3 style="margin:0 0 18px;color:#8b7355;font-size:16px;border-bottom:1px solid #e8ddd0;padding-bottom:10px;">Motivations &amp; Fit</h3>
      ${field('Why interested in this role', d.interest_reason)}
      ${field('Primary Interests', interests)}
      ${field('Cultural Comfort Level', d.cultural_comfort)}
      ${field('Tobacco Use', d.tobacco)}
      ${field('Alcohol Consumption', d.alcohol)}
    </div>

    <!-- Availability -->
    <div style="background:white;margin:16px;padding:24px;border-radius:8px;">
      <h3 style="margin:0 0 18px;color:#8b7355;font-size:16px;border-bottom:1px solid #e8ddd0;padding-bottom:10px;">Availability</h3>
      ${field('Earliest Interview Date', d.interview_availability)}
      ${field('Trial Week Availability', d.trial_availability)}
      ${field('International Travel Readiness', d.travel_readiness)}
      ${field('Thailand Return Frequency', d.thailand_return)}
    </div>

    <!-- Additional -->
    <div style="background:white;margin:16px;padding:24px;border-radius:8px;">
      <h3 style="margin:0 0 18px;color:#8b7355;font-size:16px;border-bottom:1px solid #e8ddd0;padding-bottom:10px;">Additional Questions</h3>
      ${field('Questions for us', d.additional_questions)}
    </div>

    <!-- Footer -->
    <div style="padding:20px 32px;text-align:center;color:#6b6b6b;font-size:12px;">
      <p style="margin:0;">Submitted ${submitted} (Austin time) · Language: ${d.language === 'th' ? 'Thai 🇹🇭' : 'English 🇺🇸'}</p>
      <p style="margin:6px 0 0;">Mistique Journey @ Alpaca Playhouse, Austin Texas</p>
    </div>
  </div>
</body>
</html>`
}
