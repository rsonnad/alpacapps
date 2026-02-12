#!/usr/bin/env node
/**
 * PAI Test Suite
 * Queries Supabase for real data, generates smart test questions,
 * calls PAI API endpoint, and records results.
 *
 * Usage: node pai-test-suite.js
 * Output: results.json (consumed by report generator)
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const BOT_EMAIL = 'bot@alpacaplayhouse.com';
const BOT_PASSWORD = process.env.BOT_USER_PASSWORD;

if (!SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}
if (!SUPABASE_ANON_KEY) {
  console.error('SUPABASE_ANON_KEY required');
  process.exit(1);
}

// Service role client for DB queries
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Anon client for user auth (service key can't sign in as user)
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// PAI endpoint
const PAI_URL = `${SUPABASE_URL}/functions/v1/alpaca-pai`;

// Auth token (set during init)
let authToken = '';

// =============================================
// Data Fetchers
// =============================================

async function fetchRealData() {
  console.log('Fetching real data from Supabase...');

  const [
    spacesRes,
    goveeRes,
    nestRes,
    vehiclesRes,
    camerasRes,
    faqRes,
    docsRes,
    amenitiesRes,
    assignmentsRes,
    passwordsRes,
  ] = await Promise.all([
    supabase.from('spaces').select('id, name, monthly_rate, can_be_dwelling, parent_id, access_code, description').eq('is_archived', false),
    supabase.from('govee_devices').select('device_id, name, area').eq('is_active', true).eq('is_group', true),
    supabase.from('nest_devices').select('room_name, device_type').eq('is_active', true),
    supabase.from('vehicles').select('id, name, vehicle_make, vehicle_model').eq('is_active', true),
    supabase.from('camera_streams').select('camera_name, location').eq('is_active', true),
    supabase.from('faq_context_entries').select('title, content').eq('is_active', true),
    supabase.from('document_index').select('title, keywords').eq('is_active', true),
    supabase.from('space_amenities').select('space_id, amenity_id, amenities(name)').limit(200),
    supabase.from('assignments').select('id, status, start_date, end_date, assignment_spaces(space_id)').in('status', ['active', 'pending_contract', 'contract_sent']),
    supabase.from('password_vault').select('service, category').eq('is_active', true).limit(20),
  ]);

  const spaces = spacesRes.data || [];
  const govee = goveeRes.data || [];
  const nest = nestRes.data || [];
  const vehicles = vehiclesRes.data || [];
  const cameras = [...new Map((camerasRes.data || []).map(c => [c.camera_name, c])).values()];
  const faq = faqRes.data || [];
  const docs = docsRes.data || [];
  const amenities = amenitiesRes.data || [];
  const assignments = assignmentsRes.data || [];
  const passwords = passwordsRes.data || [];

  // Build amenity map
  const amenityMap = {};
  for (const a of amenities) {
    const spaceName = spaces.find(s => s.id === a.space_id)?.name;
    const amenityName = a.amenities?.name;
    if (spaceName && amenityName) {
      if (!amenityMap[spaceName]) amenityMap[spaceName] = [];
      amenityMap[spaceName].push(amenityName);
    }
  }

  // Build occupancy set (space IDs with active assignments)
  const occupiedSpaceIds = new Set();
  for (const a of assignments) {
    for (const as of a.assignment_spaces || []) {
      if (as.space_id) occupiedSpaceIds.add(as.space_id);
    }
  }

  const dwellings = spaces.filter(s => s.can_be_dwelling && s.monthly_rate)
    .sort((a, b) => b.monthly_rate - a.monthly_rate); // Sort by rate descending
  const availableDwellings = dwellings.filter(s => !occupiedSpaceIds.has(s.id));
  const occupiedDwellings = dwellings.filter(s => occupiedSpaceIds.has(s.id));

  console.log(`  Spaces: ${spaces.length}, Dwellings: ${dwellings.length} (${availableDwellings.length} available)`);
  console.log(`  Govee groups: ${govee.length}, Thermostats: ${nest.length}`);
  console.log(`  Vehicles: ${vehicles.length}, Cameras: ${cameras.length}`);
  console.log(`  FAQ entries: ${faq.length}, Documents: ${docs.length}`);

  return {
    spaces, dwellings, availableDwellings, occupiedDwellings,
    govee, nest, vehicles, cameras, faq, docs, amenityMap, passwords,
  };
}

// =============================================
// Test Question Generator
// =============================================

function generateTestQuestions(data) {
  const questions = [];
  const { dwellings, availableDwellings, govee, nest, vehicles, cameras, faq, docs, amenityMap, passwords } = data;

  // --- Category: General Property Info ---
  questions.push({
    category: 'property_info',
    question: 'What is the address of Alpaca Playhouse?',
    expectedKeywords: ['160', 'Still Forest', 'Cedar Creek', 'TX', '78612'],
    difficulty: 'easy',
  });
  questions.push({
    category: 'property_info',
    question: 'What is the WiFi password?',
    expectedKeywords: ['iiiiiiii', 'Eight Small Eyes'],
    difficulty: 'easy',
  });
  questions.push({
    category: 'property_info',
    question: 'How do I contact the team?',
    expectedKeywords: ['team@alpacaplayhouse.com', '737'],
    difficulty: 'easy',
  });
  questions.push({
    category: 'property_info',
    question: 'What amenities and features does the property have? Think big picture — shared amenities like the sauna, sound system, vehicles.',
    expectedKeywords: ['Sonos', 'sauna', 'Tesla', 'sound'],
    difficulty: 'easy',
  });

  // --- Category: Identity & Personality ---
  questions.push({
    category: 'identity',
    question: 'Who are you?',
    expectedKeywords: ['PAI', 'alpaca'],
    difficulty: 'easy',
  });
  questions.push({
    category: 'identity',
    question: 'Tell me about the Life of PAI',
    expectedKeywords: ['spirit', 'Life of PAI'],
    difficulty: 'medium',
  });

  // --- Category: Spaces & Availability ---
  if (dwellings.length) {
    const topSpace = dwellings[0];
    questions.push({
      category: 'spaces',
      question: `How much does the ${topSpace.name} cost per month?`,
      expectedKeywords: [String(topSpace.monthly_rate), topSpace.name],
      difficulty: 'easy',
    });
  }
  questions.push({
    category: 'spaces',
    question: 'What spaces are available for rent right now?',
    expectedKeywords: availableDwellings.length ? [availableDwellings[0].name, '$'] : ['available', 'space'],
    difficulty: 'medium',
  });
  questions.push({
    category: 'spaces',
    question: 'What is the cheapest space I can rent?',
    expectedKeywords: dwellings.length ? [String(dwellings[dwellings.length - 1].monthly_rate), '$'] : ['space'],
    difficulty: 'medium',
  });
  questions.push({
    category: 'spaces',
    question: 'What is the most expensive space?',
    expectedKeywords: dwellings.length ? [dwellings[0].name] : ['space'],
    difficulty: 'medium',
  });
  questions.push({
    category: 'spaces',
    question: `How many dwelling spaces can someone rent at the property?`,
    expectedKeywords: [String(dwellings.length), 'dwelling'],
    difficulty: 'medium',
  });

  // --- Category: Amenity-based space search ---
  const spacesWithHiFi = Object.entries(amenityMap).filter(([, a]) => a.some(am => am.toLowerCase().includes('hifi') || am.toLowerCase().includes('hi-fi'))).map(([n]) => n);
  if (spacesWithHiFi.length) {
    questions.push({
      category: 'amenities',
      question: 'Which rooms have HiFi Sound systems?',
      expectedKeywords: spacesWithHiFi.slice(0, 2).concat(['sound', 'HiFi']),
      difficulty: 'medium',
    });
  }
  const spacesWithAC = Object.entries(amenityMap).filter(([, a]) => a.includes('A/C')).map(([n]) => n);
  if (spacesWithAC.length) {
    questions.push({
      category: 'amenities',
      question: 'Which spaces have air conditioning?',
      expectedKeywords: spacesWithAC.slice(0, 2),
      difficulty: 'medium',
    });
  }
  questions.push({
    category: 'amenities',
    question: 'Does the property have a sauna?',
    expectedKeywords: ['sauna', 'Sauna', 'yes'],
    difficulty: 'easy',
  });
  questions.push({
    category: 'amenities',
    question: 'Is there a swimming pool or swim spa?',
    expectedKeywords: ['swim spa', 'Swim spa', 'swim'],
    difficulty: 'easy',
  });

  // --- Category: Lighting (read-only queries) ---
  if (govee.length) {
    questions.push({
      category: 'lighting',
      question: 'What lighting groups can you control?',
      expectedKeywords: govee.map(g => g.name),
      difficulty: 'easy',
    });
    questions.push({
      category: 'lighting',
      question: `Tell me about the ${govee[0].name} lights`,
      expectedKeywords: [govee[0].name, govee[0].area],
      difficulty: 'easy',
    });
  }

  // --- Category: Climate ---
  if (nest.length) {
    questions.push({
      category: 'climate',
      question: 'What thermostats are in the house?',
      expectedKeywords: nest.map(n => n.room_name),
      difficulty: 'easy',
    });
    questions.push({
      category: 'climate',
      question: `What is the temperature in the ${nest[0].room_name}?`,
      expectedKeywords: [nest[0].room_name, '°', 'degree', 'temp'],
      difficulty: 'medium',
    });
  }

  // --- Category: Vehicles ---
  if (vehicles.length) {
    questions.push({
      category: 'vehicles',
      question: 'What vehicles are available?',
      expectedKeywords: vehicles.map(v => v.name).slice(0, 3),
      difficulty: 'easy',
    });
    questions.push({
      category: 'vehicles',
      question: `What kind of car is ${vehicles[0].name}?`,
      expectedKeywords: [vehicles[0].vehicle_make, vehicles[0].vehicle_model],
      difficulty: 'easy',
    });
    questions.push({
      category: 'vehicles',
      question: `What is the battery level of ${vehicles[0].name}?`,
      expectedKeywords: ['%', 'battery', 'charge', vehicles[0].name],
      difficulty: 'medium',
    });
  }

  // --- Category: Cameras ---
  if (cameras.length) {
    questions.push({
      category: 'cameras',
      question: 'What cameras are available to view?',
      expectedKeywords: cameras.map(c => c.camera_name).slice(0, 3),
      difficulty: 'easy',
    });
    questions.push({
      category: 'cameras',
      question: 'Where can I see the live camera feeds?',
      expectedKeywords: ['cameras.html', 'cameras', 'alpacaplayhouse.com'],
      difficulty: 'easy',
    });
  }

  // --- Category: House Rules & Policies ---
  if (faq.length) {
    questions.push({
      category: 'policies',
      question: 'What are the house rules?',
      expectedKeywords: ['rule', 'policy', 'Rule'],
      difficulty: 'medium',
    });
    // Ask about specific FAQ topics
    for (const entry of faq.slice(0, 4)) {
      questions.push({
        category: 'policies',
        question: `Tell me about the ${entry.title.toLowerCase()} policy`,
        expectedKeywords: entry.content.split(' ').filter(w => w.length > 5).slice(0, 2),
        difficulty: 'medium',
      });
    }
  }

  // --- Category: Documents ---
  if (docs.length) {
    questions.push({
      category: 'documents',
      question: `Do you have instructions for the ${docs[0].title.replace(' Guide', '').replace(' Manual', '').replace(' (2019)', '')}?`,
      expectedKeywords: [docs[0].title.split(' ')[0]],
      difficulty: 'medium',
    });
  }

  // --- Category: Music ---
  questions.push({
    category: 'music',
    question: 'What Sonos zones are in the house?',
    expectedKeywords: ['Kitchen', 'Living Room', 'zone'],
    difficulty: 'easy',
  });
  questions.push({
    category: 'music',
    question: 'Can you make an announcement on the speakers?',
    expectedKeywords: ['yes', 'message', 'room', 'house'],
    difficulty: 'easy',
  });

  // --- Category: Edge cases & error handling ---
  questions.push({
    category: 'edge_case',
    question: '',
    expectedKeywords: [],
    difficulty: 'edge',
    expectError: true,
  });
  questions.push({
    category: 'edge_case',
    question: 'asdfghjkl xyzzy gibberish',
    expectedKeywords: [],
    difficulty: 'edge',
  });
  questions.push({
    category: 'edge_case',
    question: 'Can you order me a pizza?',
    expectedKeywords: [],
    difficulty: 'medium',
  });
  questions.push({
    category: 'edge_case',
    question: 'What is the meaning of life?',
    expectedKeywords: [],
    difficulty: 'easy',
  });

  // --- Category: Complex / multi-part ---
  questions.push({
    category: 'complex',
    question: 'I want to rent a space with A/C that costs less than $1000/month. What are my options?',
    expectedKeywords: ['A/C', 'available'],
    difficulty: 'hard',
  });
  questions.push({
    category: 'complex',
    question: 'Compare the Skyloft to the Master Pasture Suite — which is better value?',
    expectedKeywords: ['Skyloft', 'Master', 'rate', 'price', '$'],
    difficulty: 'hard',
  });
  questions.push({
    category: 'complex',
    question: 'What smart home features can I use as a resident?',
    expectedKeywords: ['light', 'thermostat', 'Sonos', 'music'],
    difficulty: 'medium',
  });
  questions.push({
    category: 'complex',
    question: 'How do I get to the property from Austin?',
    expectedKeywords: ['Cedar Creek', '30 min', 'east', 'Austin'],
    difficulty: 'medium',
  });

  // --- Category: Conversational / personality ---
  questions.push({
    category: 'personality',
    question: 'Good morning PAI! How are you today?',
    expectedKeywords: [],
    difficulty: 'easy',
  });
  questions.push({
    category: 'personality',
    question: 'Tell me something interesting about the property',
    expectedKeywords: ['Alpaca', 'property'],
    difficulty: 'easy',
  });

  return questions;
}

// =============================================
// PAI API Caller
// =============================================

async function callPai(message) {
  const startTime = Date.now();

  try {
    const response = await fetch(PAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        message,
      }),
    });

    const elapsed = Date.now() - startTime;
    const data = await response.json();

    return {
      success: response.ok,
      statusCode: response.status,
      reply: data.reply || data.error || 'No response',
      actions: data.actions_taken || [],
      responseTimeMs: elapsed,
      error: data.error || null,
    };
  } catch (err) {
    return {
      success: false,
      statusCode: 0,
      reply: '',
      actions: [],
      responseTimeMs: Date.now() - startTime,
      error: err.message,
    };
  }
}

// =============================================
// Scoring
// =============================================

function scoreResponse(question, result) {
  // Empty message edge case — should return error
  if (question.expectError) {
    return {
      score: result.error || !result.success ? 1.0 : 0.5,
      reason: result.error ? 'Correctly returned error for invalid input' : 'Expected error but got response',
    };
  }

  if (!result.success) {
    return { score: 0, reason: `API error: ${result.error || result.statusCode}` };
  }

  if (!result.reply || result.reply.length < 5) {
    return { score: 0.1, reason: 'Response too short or empty' };
  }

  // Keyword matching
  const keywords = question.expectedKeywords || [];
  if (keywords.length === 0) {
    // No keywords to check — just verify we got a reasonable response
    return {
      score: result.reply.length > 20 ? 0.8 : 0.5,
      reason: result.reply.length > 20 ? 'Got a substantive response' : 'Got a short response',
    };
  }

  const reply = result.reply.toLowerCase();
  let matched = 0;
  const matchedKeywords = [];
  const missedKeywords = [];

  for (const kw of keywords) {
    if (reply.includes(kw.toLowerCase())) {
      matched++;
      matchedKeywords.push(kw);
    } else {
      missedKeywords.push(kw);
    }
  }

  const ratio = matched / keywords.length;
  let score;
  if (ratio >= 0.8) score = 1.0;
  else if (ratio >= 0.5) score = 0.7;
  else if (ratio >= 0.25) score = 0.5;
  else if (matched > 0) score = 0.3;
  else score = 0.1;

  // Bonus for longer, more detailed responses
  if (result.reply.length > 200 && score < 1.0) score = Math.min(1.0, score + 0.1);

  const reason = matched > 0
    ? `Matched ${matched}/${keywords.length} keywords: [${matchedKeywords.join(', ')}]${missedKeywords.length ? ` — missed: [${missedKeywords.join(', ')}]` : ''}`
    : `No keywords matched from [${keywords.join(', ')}]`;

  return { score, reason };
}

// =============================================
// Main Runner
// =============================================

async function run() {
  const runStart = new Date();
  console.log(`\n=== PAI Test Suite ===`);
  console.log(`Started: ${runStart.toISOString()}\n`);

  // 0. Authenticate as bot user
  console.log('Authenticating as bot user...');
  if (!BOT_PASSWORD) {
    console.error('BOT_USER_PASSWORD required for authentication');
    process.exit(1);
  }
  const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({
    email: BOT_EMAIL,
    password: BOT_PASSWORD,
  });
  if (authError || !authData?.session) {
    console.error('Authentication failed:', authError?.message || 'No session returned');
    process.exit(1);
  }
  authToken = authData.session.access_token;
  console.log(`  Authenticated as ${BOT_EMAIL} (token expires: ${new Date(authData.session.expires_at * 1000).toISOString()})\n`);

  // 1. Fetch real data
  const data = await fetchRealData();

  // 2. Generate test questions
  const questions = generateTestQuestions(data);
  console.log(`\nGenerated ${questions.length} test questions across categories:\n`);

  const categoryCounts = {};
  for (const q of questions) {
    categoryCounts[q.category] = (categoryCounts[q.category] || 0) + 1;
  }
  for (const [cat, count] of Object.entries(categoryCounts)) {
    console.log(`  ${cat}: ${count}`);
  }

  // 3. Run each question with 20s delay between calls to avoid rate limiting
  const results = [];
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const num = `[${i + 1}/${questions.length}]`;

    if (q.question === '') {
      console.log(`${num} (empty message - edge case)`);
    } else {
      console.log(`${num} ${q.category}: "${q.question.substring(0, 60)}..."`);
    }

    const result = await callPai(q.question);
    const { score, reason } = scoreResponse(q, result);
    const pass = score >= 0.5;

    if (pass) passed++;
    else failed++;

    const emoji = pass ? 'PASS' : 'FAIL';
    console.log(`  ${emoji} (score: ${score.toFixed(1)}, ${result.responseTimeMs}ms) — ${reason}`);
    if (result.error) console.log(`  ERROR: ${result.error}`);

    results.push({
      index: i + 1,
      category: q.category,
      question: q.question,
      difficulty: q.difficulty,
      expectedKeywords: q.expectedKeywords,
      reply: result.reply,
      actions: result.actions,
      responseTimeMs: result.responseTimeMs,
      statusCode: result.statusCode,
      error: result.error,
      score,
      pass,
      scoreReason: reason,
      timestamp: new Date().toISOString(),
    });

    // Delay between calls to avoid rate limiting
    if (i < questions.length - 1) {
      // Use shorter delay for failed requests (no Gemini cost), longer for successful
      const delay = result.success && !result.error ? 12000 : 3000;
      console.log(`  (waiting ${delay / 1000}s before next query...)\n`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  const runEnd = new Date();
  const durationMs = runEnd - runStart;
  const avgResponseTime = results.length
    ? Math.round(results.reduce((sum, r) => sum + r.responseTimeMs, 0) / results.length)
    : 0;

  const summary = {
    runStart: runStart.toISOString(),
    runEnd: runEnd.toISOString(),
    durationMs,
    durationFormatted: `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`,
    totalQueries: results.length,
    passed,
    failed,
    passRate: `${((passed / results.length) * 100).toFixed(1)}%`,
    avgResponseTimeMs: avgResponseTime,
    minResponseTimeMs: Math.min(...results.map(r => r.responseTimeMs)),
    maxResponseTimeMs: Math.max(...results.map(r => r.responseTimeMs)),
    avgScore: (results.reduce((sum, r) => sum + r.score, 0) / results.length).toFixed(2),
    categories: categoryCounts,
    categoryScores: {},
  };

  // Calculate per-category scores
  for (const cat of Object.keys(categoryCounts)) {
    const catResults = results.filter(r => r.category === cat);
    summary.categoryScores[cat] = {
      total: catResults.length,
      passed: catResults.filter(r => r.pass).length,
      avgScore: (catResults.reduce((s, r) => s + r.score, 0) / catResults.length).toFixed(2),
      avgResponseTimeMs: Math.round(catResults.reduce((s, r) => s + r.responseTimeMs, 0) / catResults.length),
    };
  }

  const output = { summary, results };

  // Write results
  const outputPath = path.join(__dirname, 'results.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n=== Test Suite Complete ===`);
  console.log(`Duration: ${summary.durationFormatted}`);
  console.log(`Results: ${passed} passed, ${failed} failed (${summary.passRate})`);
  console.log(`Avg response time: ${avgResponseTime}ms`);
  console.log(`Avg score: ${summary.avgScore}`);
  console.log(`Results saved to: ${outputPath}\n`);
}

run().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
