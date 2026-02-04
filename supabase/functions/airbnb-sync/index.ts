/**
 * Airbnb Sync Edge Function
 *
 * Syncs bookings from Airbnb iCal feeds into the assignments table.
 * Can be triggered manually from admin UI or via cron.
 *
 * Usage: POST /functions/v1/airbnb-sync
 *
 * Deploy with: supabase functions deploy airbnb-sync
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ICalEvent {
  uid: string;
  summary: string;
  dtstart: Date;
  dtend: Date;
}

interface BlockedRange {
  start: string;
  end: string;
}

interface SyncResult {
  spaceId: string;
  spaceName: string;
  eventsFound: number;
  created: number;
  updated: number;
  skipped: number;
  blockedRanges: BlockedRange[];
  errors: string[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get all spaces with Airbnb iCal URLs
    const { data: spaces, error: spacesError } = await supabase
      .from('spaces')
      .select('id, name, airbnb_ical_url')
      .not('airbnb_ical_url', 'is', null);

    if (spacesError) {
      throw new Error(`Failed to fetch spaces: ${spacesError.message}`);
    }

    if (!spaces || spaces.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No spaces with Airbnb iCal URLs configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Syncing ${spaces.length} spaces from Airbnb`);

    // Get or create "Airbnb Guest" person for bookings
    let airbnbGuestId: string;
    const { data: existingGuest } = await supabase
      .from('people')
      .select('id')
      .eq('first_name', 'Airbnb')
      .eq('last_name', 'Guest')
      .single();

    if (existingGuest) {
      airbnbGuestId = existingGuest.id;
    } else {
      const { data: newGuest, error: createError } = await supabase
        .from('people')
        .insert({ first_name: 'Airbnb', last_name: 'Guest', type: 'airbnb_guest' })
        .select('id')
        .single();

      if (createError || !newGuest) {
        throw new Error(`Failed to create Airbnb Guest: ${createError?.message}`);
      }
      airbnbGuestId = newGuest.id;
    }

    const results: SyncResult[] = [];

    for (const space of spaces) {
      const result: SyncResult = {
        spaceId: space.id,
        spaceName: space.name,
        eventsFound: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        blockedRanges: [],
        errors: [],
      };

      try {
        // Fetch iCal from Airbnb
        const response = await fetch(space.airbnb_ical_url);
        if (!response.ok) {
          result.errors.push(`Failed to fetch iCal: ${response.status}`);
          results.push(result);
          continue;
        }

        const icalText = await response.text();
        const events = parseIcal(icalText);
        result.eventsFound = events.length;

        // Process each event
        for (const event of events) {
          try {
            // Skip past events
            if (event.dtend < new Date()) {
              result.skipped++;
              continue;
            }

            // Skip "Not available" blocks - these are owner blocks, not real reservations
            // They show up as "Airbnb (Not available)" or just "Not available"
            // But track them so admins can see what dates are blocked
            const summary = (event.summary || '').toLowerCase();
            if (summary.includes('not available') || summary === 'blocked') {
              result.blockedRanges.push({
                start: event.dtstart.toISOString().split('T')[0],
                end: event.dtend.toISOString().split('T')[0],
              });
              result.skipped++;
              continue;
            }

            // Check if assignment already exists with this airbnb_uid
            const { data: existing } = await supabase
              .from('assignments')
              .select('id, start_date, end_date')
              .eq('airbnb_uid', event.uid)
              .single();

            if (existing) {
              // Update if dates changed
              const existingStart = existing.start_date ? new Date(existing.start_date).toISOString().split('T')[0] : null;
              const existingEnd = existing.end_date ? new Date(existing.end_date).toISOString().split('T')[0] : null;
              const newStart = event.dtstart.toISOString().split('T')[0];
              const newEnd = event.dtend.toISOString().split('T')[0];

              if (existingStart !== newStart || existingEnd !== newEnd) {
                await supabase
                  .from('assignments')
                  .update({
                    start_date: newStart,
                    end_date: newEnd,
                  })
                  .eq('id', existing.id);
                result.updated++;
              } else {
                result.skipped++;
              }
            } else {
              // Create new assignment
              const { data: newAssignment, error: createError } = await supabase
                .from('assignments')
                .insert({
                  person_id: airbnbGuestId,
                  type: 'dwelling',
                  start_date: event.dtstart.toISOString().split('T')[0],
                  end_date: event.dtend.toISOString().split('T')[0],
                  status: 'active',
                  airbnb_uid: event.uid,
                  notes: `Imported from Airbnb: ${event.summary}`,
                })
                .select('id')
                .single();

              if (createError || !newAssignment) {
                result.errors.push(`Failed to create assignment: ${createError?.message}`);
                continue;
              }

              // Link assignment to space
              await supabase
                .from('assignment_spaces')
                .insert({
                  assignment_id: newAssignment.id,
                  space_id: space.id,
                });

              result.created++;
            }
          } catch (eventError) {
            result.errors.push(`Event error: ${eventError.message}`);
          }
        }
      } catch (spaceError) {
        result.errors.push(`Space error: ${spaceError.message}`);
      }

      results.push(result);
    }

    // Summary
    const summary = {
      spacesProcessed: results.length,
      totalCreated: results.reduce((sum, r) => sum + r.created, 0),
      totalUpdated: results.reduce((sum, r) => sum + r.updated, 0),
      totalSkipped: results.reduce((sum, r) => sum + r.skipped, 0),
      totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0),
    };

    console.log('Sync complete:', summary);

    return new Response(
      JSON.stringify({ success: true, summary, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Sync error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

function parseIcal(icalText: string): ICalEvent[] {
  const events: ICalEvent[] = [];
  const lines = icalText.replace(/\r\n /g, '').split(/\r?\n/);

  let currentEvent: Partial<ICalEvent> | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      currentEvent = {};
    } else if (line === 'END:VEVENT' && currentEvent) {
      if (currentEvent.uid && currentEvent.dtstart && currentEvent.dtend) {
        events.push(currentEvent as ICalEvent);
      }
      currentEvent = null;
    } else if (currentEvent) {
      if (line.startsWith('UID:')) {
        currentEvent.uid = line.substring(4);
      } else if (line.startsWith('SUMMARY:')) {
        currentEvent.summary = line.substring(8);
      } else if (line.startsWith('DTSTART')) {
        currentEvent.dtstart = parseIcalDate(line);
      } else if (line.startsWith('DTEND')) {
        currentEvent.dtend = parseIcalDate(line);
      }
    }
  }

  return events;
}

function parseIcalDate(line: string): Date {
  // Handle both VALUE=DATE and regular datetime formats
  // DTSTART;VALUE=DATE:20250210
  // DTSTART:20250210T120000Z
  const match = line.match(/:(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})Z?)?/);
  if (!match) {
    throw new Error(`Invalid date format: ${line}`);
  }

  const [, year, month, day, , hour, minute, second] = match;

  if (hour) {
    return new Date(Date.UTC(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second || '0')
    ));
  } else {
    // Date only - use local date
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }
}
