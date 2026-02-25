import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const NOTIFY_EMAIL = 'rahulioson@gmail.com';
const FROM_EMAIL = 'Mistique Journey <noreply@alpacaplayhouse.com>';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function sendEmail(subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: NOTIFY_EMAIL, subject, html }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('Resend error:', err);
  }
}

function fieldRow(label: string, value: unknown): string {
  const display = Array.isArray(value) ? (value as string[]).join(', ') : (value ? String(value) : '—');
  return `<tr>
    <td style="padding:8px 12px;background:#faf7f2;font-weight:bold;width:42%;vertical-align:top;border-bottom:1px solid #f0e8d8;">${label}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f0e8d8;">${display || '—'}</td>
  </tr>`;
}

function section(title: string, rows: string): string {
  return `<h2 style="color:#c8a86b;border-bottom:2px solid #f0e8d8;padding-bottom:8px;margin:24px 0 12px;">${title}</h2>
  <table style="width:100%;border-collapse:collapse;">${rows}</table>`;
}

function fullApplicationEmail(data: Record<string, unknown>, lang: string): string {
  const langLabel = lang === 'th' ? 'Thai 🇹🇭' : 'English 🇺🇸';
  const interests = Array.isArray(data.primary_interests)
    ? (data.primary_interests as string[]).join(', ')
    : String(data.primary_interests || '—');

  return `<div style="font-family:Georgia,serif;max-width:640px;margin:0 auto;color:#2d2010;">
    <div style="background:#c8a86b;color:white;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:1.6rem;">✅ New Job Application</h1>
      <p style="margin:8px 0 0;opacity:0.9;">Mistique Journey — ${langLabel}</p>
    </div>
    <div style="background:white;border:1px solid #e8dcc8;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
      ${section('Personal Information',
        fieldRow('Full Name', data.full_name) +
        fieldRow('Phone / WhatsApp / Line', data.phone) +
        fieldRow('Email', data.email) +
        fieldRow('City of Residence', data.city) +
        fieldRow('Date of Birth', data.dob) +
        fieldRow('Has Passport?', data.has_passport) +
        fieldRow('US/EU Visas', data.us_eu_visas)
      )}
      ${section('Massage Skills',
        fieldRow('Thai Massage Level (1–10)', data.thai_massage_level ? `<strong style="font-size:1.3em;color:#c8a86b;">${data.thai_massage_level}/10</strong>` : '—') +
        fieldRow('Other Massage Styles', data.other_massage_styles)
      )}
      ${section('English & Fitness',
        fieldRow('English Level', data.english_level) +
        fieldRow('Motivation to Study English', data.english_study) +
        fieldRow('Can Walk 5 km?', data.can_walk_5km)
      )}
      ${section('Background & Motivation',
        fieldRow('International Travel Experience', data.travel_experience) +
        fieldRow('Why Interested in This Role?', data.why_interested) +
        fieldRow('Primary Interests', interests) +
        fieldRow('Comfortable Socializing with Diverse Cultures?', data.comfortable_socializing)
      )}
      ${section('Lifestyle',
        fieldRow('Smokes Tobacco?', data.smokes) +
        fieldRow('Consumes Alcohol?', data.drinks)
      )}
      ${section('Availability',
        fieldRow('Earliest Interview Date (Bangkok/Chiang Mai)', data.earliest_interview_date) +
        fieldRow('Available for 1-Week Trial', data.trial_availability) +
        fieldRow('Available to Travel Abroad', data.travel_abroad_availability) +
        fieldRow('Times Returning to Thailand/Year', data.thailand_returns)
      )}
      ${data.other_questions ? `<h2 style="color:#c8a86b;border-bottom:2px solid #f0e8d8;padding-bottom:8px;margin:24px 0 12px;">Questions / Comments</h2>
      <p style="background:#faf7f2;padding:12px;border-radius:4px;margin:0;">${data.other_questions}</p>` : ''}
    </div>
    <p style="text-align:center;color:#999;font-size:0.8rem;margin-top:12px;">
      Received ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} Austin time
    </p>
  </div>`;
}

function partialEmail(data: Record<string, unknown>, lang: string): string {
  const langLabel = lang === 'th' ? 'Thai 🇹🇭' : 'English 🇺🇸';
  const filled = Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0));

  const rows = filled.map(([k, v]) => {
    const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const val = Array.isArray(v) ? (v as string[]).join(', ') : String(v);
    return fieldRow(label, val);
  }).join('');

  return `<div style="font-family:Georgia,serif;max-width:640px;margin:0 auto;color:#2d2010;">
    <div style="background:#a07840;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:1.4rem;">📝 Partial Application Started</h1>
      <p style="margin:8px 0 0;opacity:0.9;">Mistique Journey — ${langLabel} — Left without submitting</p>
    </div>
    <div style="background:white;border:1px solid #e8dcc8;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
      <p style="color:#666;margin:0 0 16px;">The following fields were filled before the user left the page:</p>
      <table style="width:100%;border-collapse:collapse;">${rows || '<tr><td style="padding:8px;color:#999;">No fields were filled</td></tr>'}</table>
    </div>
    <p style="text-align:center;color:#999;font-size:0.8rem;margin-top:12px;">
      ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} Austin time
    </p>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json();
    const { type, lang = 'en', event, data = {} } = body as {
      type: string;
      lang?: string;
      event?: string;
      data?: Record<string, unknown>;
    };

    // ── TRACKING EVENTS ──────────────────────────────────────────────────────
    if (type === 'track') {
      const eventType = event || 'unknown';

      await supabase.from('mistiq_events').insert({
        event_type: eventType,
        lang,
        referrer: data?.referrer || null,
        partial_data: eventType === 'partial_completion' ? data : null,
      });

      const langLabel = lang === 'th' ? 'Thai 🇹🇭' : 'English 🇺🇸';
      const time = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

      if (eventType === 'apply_click') {
        await sendEmail(
          `🎯 Mistiq: Apply button clicked (${lang.toUpperCase()})`,
          `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
            <h2 style="color:#c8a86b;">Apply Button Clicked</h2>
            <p><strong>Language:</strong> ${langLabel}</p>
            <p><strong>Time:</strong> ${time} Austin time</p>
            ${data?.referrer ? `<p><strong>Referrer:</strong> ${data.referrer}</p>` : ''}
          </div>`
        );
      } else if (eventType === 'page_view') {
        await sendEmail(
          `👁️ Mistiq: Application page viewed (${lang.toUpperCase()})`,
          `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
            <h2 style="color:#c8a86b;">Application Page Viewed</h2>
            <p><strong>Language:</strong> ${langLabel}</p>
            <p><strong>Time:</strong> ${time} Austin time</p>
            ${data?.referrer ? `<p><strong>Referrer:</strong> ${data.referrer}</p>` : ''}
          </div>`
        );
      } else if (eventType === 'partial_completion') {
        const name = (data?.full_name as string) || 'Unknown';
        await sendEmail(
          `📝 Mistiq: Partial application — ${name} (${lang.toUpperCase()})`,
          partialEmail(data as Record<string, unknown>, lang)
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── FULL SUBMISSION ───────────────────────────────────────────────────────
    if (type === 'submit') {
      const appData = {
        lang,
        full_name: data.full_name || null,
        phone: data.phone || null,
        email: data.email || null,
        city: data.city || null,
        dob: data.dob || null,
        has_passport: data.has_passport || null,
        us_eu_visas: data.us_eu_visas || null,
        thai_massage_level: data.thai_massage_level ? parseInt(String(data.thai_massage_level)) : null,
        other_massage_styles: data.other_massage_styles || null,
        english_level: data.english_level || null,
        english_study: data.english_study || null,
        can_walk_5km: data.can_walk_5km || null,
        travel_experience: data.travel_experience || null,
        why_interested: data.why_interested || null,
        primary_interests: Array.isArray(data.primary_interests) ? data.primary_interests : null,
        comfortable_socializing: data.comfortable_socializing || null,
        smokes: data.smokes || null,
        drinks: data.drinks || null,
        earliest_interview_date: data.earliest_interview_date || null,
        trial_availability: data.trial_availability || null,
        travel_abroad_availability: data.travel_abroad_availability || null,
        thailand_returns: data.thailand_returns || null,
        other_questions: data.other_questions || null,
      };

      const { error: dbError } = await supabase.from('mistiq_applications').insert(appData);
      if (dbError) console.error('DB insert error:', dbError);

      const name = String(data.full_name || 'Unknown');
      await sendEmail(
        `✅ Mistiq Application: ${name} (${lang.toUpperCase()}) — ${new Date().toLocaleDateString('en-US')}`,
        fullApplicationEmail(data, lang)
      );

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown type' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('mistiq-form error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
