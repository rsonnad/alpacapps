/**
 * Tesla Battery Reminder
 * Sends nightly email to vehicle owners when battery < 50% and not charging.
 * Includes current battery level, estimated range, and odometer.
 *
 * Trigger: Nightly via pg_cron (9 PM CT / 02:00 UTC)
 * Deploy: supabase functions deploy tesla-battery-reminder
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { getCorsHeaders } from "../_shared/api-helpers.ts";
import { SENDER_MAP } from "../_shared/template-engine.ts";
import { wrapEmailHtml } from "../_shared/email-brand-wrapper.ts";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'RESEND_API_KEY not configured' }),
        { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // Fetch active vehicles with owner + drivers info
    const { data: vehicles, error: vErr } = await supabase
      .from('vehicles')
      .select(`
        id, name, make, model, year, color,
        owner_id, last_state, last_synced_at, vehicle_state,
        owner:owner_id ( id, first_name, last_name, email ),
        vehicle_drivers ( person:person_id ( id, first_name, last_name, email ) )
      `)
      .eq('is_active', true)
      .not('last_state', 'is', null);

    if (vErr) {
      console.error('Error querying vehicles:', vErr);
      throw vErr;
    }

    if (!vehicles?.length) {
      console.log('No active vehicles with state data');
      return new Response(
        JSON.stringify({ message: 'No vehicles to check' }),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    let emailsSent = 0;
    let skipped = 0;

    for (const vehicle of vehicles) {
      const state = vehicle.last_state as Record<string, unknown> | null;
      const owner = vehicle.owner as { id: string; first_name: string; last_name: string; email: string } | null;
      const drivers = ((vehicle as any).vehicle_drivers || [])
        .map((vd: any) => vd.person as { id: string; first_name: string; last_name: string; email: string } | null)
        .filter((p: any) => p?.email && p.id !== owner?.id);

      if (!state || !owner?.email) {
        skipped++;
        continue;
      }

      // Collect all recipients (owner + drivers)
      const allRecipients = [owner.email, ...drivers.map((d: any) => d.email)];

      const batteryLevel = state.battery_level as number | null;
      const chargingState = state.charging_state as string | null;
      const batteryRange = state.battery_range_mi as number | null;
      const odometer = state.odometer_mi as number | null;
      const chargeLimit = state.charge_limit_soc as number | null;

      // Skip if battery >= 50% or currently charging
      if (batteryLevel == null || batteryLevel >= 50) {
        skipped++;
        continue;
      }

      if (chargingState && chargingState !== 'Disconnected' && chargingState !== 'Complete') {
        console.log(`${vehicle.name}: charging (${chargingState}), skipping`);
        skipped++;
        continue;
      }

      console.log(`${vehicle.name}: battery ${batteryLevel}%, ${chargingState} — sending reminder to ${owner.email}`);

      // Build the email
      const vehicleLabel = `${vehicle.year || ''} ${vehicle.make || 'Tesla'} ${vehicle.model || ''} "${vehicle.name}"`.trim();

      const batteryColor = batteryLevel < 20 ? '#dc3545' : batteryLevel < 35 ? '#fd7e14' : '#ffc107';
      const rangeText = batteryRange != null ? `${batteryRange} mi` : 'N/A';
      const odometerText = odometer != null ? `${odometer.toLocaleString()} mi` : 'N/A';
      const chargeLimitText = chargeLimit != null ? `${chargeLimit}%` : 'N/A';
      const lastSyncedText = vehicle.last_synced_at
        ? new Date(vehicle.last_synced_at).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' })
        : 'Unknown';

      const htmlBody = `
        <h2>Low Battery: ${vehicle.name}</h2>
        <p>Hi ${owner.first_name},</p>
        <p>Your <strong>${vehicleLabel}</strong> is at <strong style="color: ${batteryColor}; font-size: 1.2em;">${batteryLevel}%</strong> battery and is not currently charging. You may want to plug it in tonight.</p>

        <div style="background: #f8f9fa; border-radius: 12px; padding: 20px; margin: 20px 0;">
          <table style="border-collapse: collapse; width: 100%; max-width: 400px;">
            <tr>
              <td style="padding: 10px 0; color: #666;">Battery Level</td>
              <td style="padding: 10px 0; text-align: right; font-weight: bold; color: ${batteryColor}; font-size: 1.3em;">${batteryLevel}%</td>
            </tr>
            <tr style="border-top: 1px solid #e0e0e0;">
              <td style="padding: 10px 0; color: #666;">Est. Range</td>
              <td style="padding: 10px 0; text-align: right; font-weight: bold;">${rangeText}</td>
            </tr>
            <tr style="border-top: 1px solid #e0e0e0;">
              <td style="padding: 10px 0; color: #666;">Charge Limit</td>
              <td style="padding: 10px 0; text-align: right; font-weight: bold;">${chargeLimitText}</td>
            </tr>
            <tr style="border-top: 1px solid #e0e0e0;">
              <td style="padding: 10px 0; color: #666;">Odometer</td>
              <td style="padding: 10px 0; text-align: right; font-weight: bold;">${odometerText}</td>
            </tr>
            <tr style="border-top: 1px solid #e0e0e0;">
              <td style="padding: 10px 0; color: #666;">Charging Status</td>
              <td style="padding: 10px 0; text-align: right; font-weight: bold;">${chargingState || 'Unknown'}</td>
            </tr>
            <tr style="border-top: 1px solid #e0e0e0;">
              <td style="padding: 10px 0; color: #666;">Last Updated</td>
              <td style="padding: 10px 0; text-align: right; font-size: 0.9em; color: #888;">${lastSyncedText}</td>
            </tr>
          </table>
        </div>

        <p style="color: #666; font-size: 0.9em;">This is an automated nightly check. You will only receive this email when your vehicle is below 50% and not plugged in.</p>
      `;

      const textBody = `Low Battery: ${vehicle.name}

Hi ${owner.first_name},

Your ${vehicleLabel} is at ${batteryLevel}% battery and is not currently charging.

Battery Level: ${batteryLevel}%
Est. Range: ${rangeText}
Charge Limit: ${chargeLimitText}
Odometer: ${odometerText}
Charging Status: ${chargingState || 'Unknown'}
Last Updated: ${lastSyncedText}

You may want to plug it in tonight.

This is an automated nightly check. You will only receive this email when your vehicle is below 50% and not plugged in.`;

      // Wrap in brand template
      let finalHtml: string;
      try {
        finalHtml = await wrapEmailHtml(htmlBody, supabase);
      } catch (_) {
        finalHtml = htmlBody;
      }

      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: SENDER_MAP.auto.from,
            to: allRecipients,
            reply_to: SENDER_MAP.auto.reply_to,
            subject: `${vehicle.name} is at ${batteryLevel}% battery - plug in tonight?`,
            html: finalHtml,
            text: textBody,
          }),
        });

        if (emailRes.ok) {
          const resData = await emailRes.json();
          console.log(`Email sent to ${owner.email} for ${vehicle.name} (resend_id: ${resData.id})`);
          emailsSent++;

          // Log API usage
          await supabase.from('api_usage_log').insert({
            vendor: 'resend',
            category: 'email_tesla_battery_reminder',
            endpoint: 'POST /emails',
            unit_type: 'email',
            units: 1,
            metadata: {
              resend_id: resData.id,
              vehicle_id: vehicle.id,
              vehicle_name: vehicle.name,
              battery_level: batteryLevel,
              recipient: owner.email,
            },
          });
        } else {
          const errData = await emailRes.json();
          console.error(`Email failed for ${vehicle.name}:`, errData);
        }
      } catch (emailErr) {
        console.error(`Email error for ${vehicle.name}:`, emailErr);
      }
    }

    console.log(`Battery check complete: ${emailsSent} emails sent, ${skipped} skipped`);

    return new Response(
      JSON.stringify({
        success: true,
        vehiclesChecked: vehicles.length,
        emailsSent,
        skipped,
      }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Battery reminder error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});
