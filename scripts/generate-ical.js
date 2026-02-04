#!/usr/bin/env node
/**
 * Generate iCal files for all spaces
 *
 * This script fetches assignments from Supabase and generates static .ics files
 * for each space. Run via cron on your server to keep files updated.
 *
 * Usage: node generate-ical.js
 *
 * Environment variables:
 *   SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_KEY - Service role key (not anon key)
 *   REPO_PATH - Path to the git repo (default: current directory)
 *   GIT_PUSH - Set to "true" to auto-push changes
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const REPO_PATH = process.env.REPO_PATH || process.cwd();
const GIT_PUSH = process.env.GIT_PUSH === 'true';
const ICAL_DIR = path.join(REPO_PATH, 'spaces', 'ical');

// Slug mapping
const NAME_TO_SLUG = {
  'Spartan Fishbowl': 'spartan-fishbowl',
  'Spartan Trailer': 'spartan-trailer',
  'Cabinearo': 'cabinearo',
  'CabinFever': 'cabinfever',
  'Canvas Tent One': 'canvas-tent-one',
  'Canvas Tent Two': 'canvas-tent-two',
  'Cedar Chamber': 'cedar-chamber',
  'Fuego Trailer': 'fuego-trailer',
  "Jon's Room": 'jons-room',
  'Magic Bus': 'magic-bus',
  'Master Pasture Suite': 'master-pasture-suite',
  'Odyssey of Static Van Life': 'odyssey-of-static-van-life',
  'Pequneo Largo Suite': 'pequneo-largo-suite',
  'Playhouse': 'playhouse',
  'Skyloft': 'skyloft',
  'Skyloft Bed 1': 'skyloft-bed-1',
  'Skyloft Bed 2': 'skyloft-bed-2',
  'Skyloft Bed 3': 'skyloft-bed-3',
  'Skyloft Bed 4': 'skyloft-bed-4',
  'Skyloft Bed 5': 'skyloft-bed-5',
};

async function fetchFromSupabase(endpoint) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${endpoint}`);

    const options = {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function formatDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function formatDateUTC(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function generateIcal(spaceName, spaceSlug, assignments) {
  const now = new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//GenAlpaca//${spaceName}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${spaceName}`,
  ];

  for (const assignment of assignments) {
    if (!assignment.start_date) continue;

    const startDate = new Date(assignment.start_date);

    // For end date: use end_date if available, otherwise assume ongoing (1 year from now)
    let endDate;
    if (assignment.end_date) {
      endDate = new Date(assignment.end_date);
      // Add 1 day because iCal DTEND is exclusive for all-day events
      endDate.setDate(endDate.getDate() + 1);
    } else {
      // No end date = ongoing, block for 1 year
      endDate = new Date(startDate);
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    // Skip past assignments (ended before today)
    if (assignment.end_date && new Date(assignment.end_date) < now) {
      continue;
    }

    const uid = `${assignment.id}@genalpaca.com`;
    const dtstamp = formatDateUTC(now);
    const dtstart = formatDateOnly(startDate);
    const dtend = formatDateOnly(endDate);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${dtstart}`);
    lines.push(`DTEND;VALUE=DATE:${dtend}`);
    lines.push(`SUMMARY:Booked - ${spaceName}`);
    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return lines.join('\r\n');
}

async function main() {
  console.log('Generating iCal files...');
  console.log(`ICAL_DIR: ${ICAL_DIR}`);

  if (!SUPABASE_KEY) {
    console.error('Error: SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY environment variable required');
    process.exit(1);
  }

  // Ensure directory exists
  if (!fs.existsSync(ICAL_DIR)) {
    fs.mkdirSync(ICAL_DIR, { recursive: true });
  }

  // Fetch spaces
  const spaces = await fetchFromSupabase('spaces?can_be_dwelling=eq.true&is_archived=eq.false&select=id,name');
  console.log(`Found ${spaces.length} dwelling spaces`);

  // Fetch all active assignments with space links
  const assignments = await fetchFromSupabase(
    'assignments?status=in.(active,pending_contract,contract_sent)&select=id,start_date,end_date,status,assignment_spaces(space_id)'
  );
  console.log(`Found ${assignments.length} active assignments`);

  // Group assignments by space
  const assignmentsBySpace = {};
  for (const assignment of assignments) {
    for (const as of (assignment.assignment_spaces || [])) {
      if (!assignmentsBySpace[as.space_id]) {
        assignmentsBySpace[as.space_id] = [];
      }
      assignmentsBySpace[as.space_id].push(assignment);
    }
  }

  // Generate iCal for each space
  let filesUpdated = 0;
  for (const space of spaces) {
    const slug = NAME_TO_SLUG[space.name];
    if (!slug) {
      console.log(`  Skipping ${space.name} (no slug mapping)`);
      continue;
    }

    const spaceAssignments = assignmentsBySpace[space.id] || [];
    const icalContent = generateIcal(space.name, slug, spaceAssignments);
    const filePath = path.join(ICAL_DIR, `${slug}.ics`);

    // Check if content changed
    let existingContent = '';
    if (fs.existsSync(filePath)) {
      existingContent = fs.readFileSync(filePath, 'utf8');
    }

    // Compare without DTSTAMP (which changes every run)
    const normalize = (s) => s.replace(/DTSTAMP:\d+T\d+Z/g, 'DTSTAMP:NORMALIZED');
    if (normalize(existingContent) !== normalize(icalContent)) {
      fs.writeFileSync(filePath, icalContent);
      console.log(`  Updated: ${slug}.ics (${spaceAssignments.length} bookings)`);
      filesUpdated++;
    } else {
      console.log(`  Unchanged: ${slug}.ics`);
    }
  }

  console.log(`\nGeneration complete. ${filesUpdated} files updated.`);

  // Git push if enabled and files changed
  if (GIT_PUSH && filesUpdated > 0) {
    console.log('\nPushing to git...');
    try {
      execSync('git add spaces/ical/*.ics', { cwd: REPO_PATH, stdio: 'inherit' });
      execSync('git commit -m "Update iCal files [automated]"', { cwd: REPO_PATH, stdio: 'inherit' });
      execSync('git push', { cwd: REPO_PATH, stdio: 'inherit' });
      console.log('Pushed successfully.');
    } catch (err) {
      console.error('Git push failed:', err.message);
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
