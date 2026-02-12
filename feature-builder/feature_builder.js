import { createClient } from '@supabase/supabase-js';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// ============================================
// Configuration
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REPO_DIR = process.env.REPO_DIR || '/opt/feature-builder/repo';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000');
const MAX_BUILD_TIMEOUT_MS = parseInt(process.env.MAX_BUILD_TIMEOUT_MS || '600000'); // 10 minutes
const TEAM_EMAIL = 'team@alpacaplayhouse.com';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const TEMP_DIR = '/tmp/feature-builder';

if (!SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============================================
// Logging
// ============================================
function log(level, msg, data = {}) {
  const ts = new Date().toISOString();
  const dataStr = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
  console.log(`[${ts}] [${level}] ${msg}${dataStr}`);
}

// ============================================
// Discord notification
// ============================================
async function notifyDiscord(message) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Feature Builder', content: message.substring(0, 2000) }),
    });
  } catch (err) {
    log('warn', 'Discord notification error', { error: err.message });
  }
}

// ============================================
// Git helpers
// ============================================
async function gitPull() {
  await execAsync('git fetch origin && git reset --hard origin/main', { cwd: REPO_DIR });
  log('info', 'Git pull complete');
}

async function gitHasChanges() {
  const { stdout } = await execAsync('git status --porcelain', { cwd: REPO_DIR });
  return stdout.trim().length > 0;
}

async function gitDiffNameStatus() {
  // Returns array of {status, file} for all changed files vs HEAD
  const { stdout } = await execAsync('git diff --name-status HEAD', { cwd: REPO_DIR });
  return stdout.trim().split('\n').filter(Boolean).map(line => {
    const [status, ...fileParts] = line.split('\t');
    return { status: status.trim(), file: fileParts.join('\t').trim() };
  });
}

function generateBranchName(requestId) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const shortId = requestId.substring(0, 8);
  return `feature/${date}-${shortId}`;
}

async function gitCreateBranchAndCommit(description, requestId) {
  const branchName = generateBranchName(requestId);
  const shortDesc = description.substring(0, 72);
  const commitMsg = `feat: ${shortDesc}\n\nAutomated feature from PAI request #${requestId}.\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`;

  await execAsync(`git checkout -b ${branchName}`, { cwd: REPO_DIR });
  await execAsync('git add -A', { cwd: REPO_DIR });
  await execAsync(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd: REPO_DIR });
  await execAsync(`git push origin ${branchName}`, { cwd: REPO_DIR });

  const { stdout } = await execAsync('git rev-parse HEAD', { cwd: REPO_DIR });
  return { commitSha: stdout.trim(), branchName };
}

async function gitMergeBranchToMain(branchName) {
  await execAsync('git checkout main', { cwd: REPO_DIR });
  await execAsync('git pull origin main', { cwd: REPO_DIR });
  await execAsync(`git merge ${branchName} --no-ff -m "Merge ${branchName} into main"`, { cwd: REPO_DIR });

  await execAsync('git push origin main', { cwd: REPO_DIR });
  log('info', 'Pushed main; release event will be recorded by CI', {
    source: 'feature_builder',
  });
  const { stdout } = await execAsync('git rev-parse HEAD', { cwd: REPO_DIR });
  return { mainSha: stdout.trim() };
}

// ============================================
// Risk Evaluation
// ============================================

/**
 * Evaluate risk of changes. Returns { safe: boolean, reasons: string[] }
 * Phase 1: Hard rules based on git diff
 * Phase 2: Claude Code's self-assessment
 */
function evaluateRisk(diffFiles, claudeRiskAssessment) {
  const reasons = [];
  let safe = true;

  // Phase 1: Hard rules
  const modified = diffFiles.filter(f => f.status === 'M');
  const deleted = diffFiles.filter(f => f.status === 'D');
  const allFiles = diffFiles.map(f => f.file);

  if (modified.length > 0) {
    safe = false;
    reasons.push(`Modified existing files: ${modified.map(f => f.file).join(', ')}`);
  }

  if (deleted.length > 0) {
    safe = false;
    reasons.push(`Deleted files: ${deleted.map(f => f.file).join(', ')}`);
  }

  // Check for files outside residents/
  const outsideResidents = allFiles.filter(f =>
    !f.startsWith('residents/') ||
    f.startsWith('residents/residents.css') // don't modify shared resident CSS
  );
  // Exclude the CSS check for new files only
  const dangerousOutside = allFiles.filter(f =>
    f.startsWith('shared/') ||
    f.startsWith('supabase/') ||
    f.startsWith('spaces/') ||
    f.startsWith('scripts/') ||
    f.startsWith('.github/')
  );

  if (dangerousOutside.length > 0) {
    safe = false;
    reasons.push(`Touched protected directories: ${dangerousOutside.join(', ')}`);
  }

  // Phase 2: Claude's self-assessment (only if still safe after hard rules)
  if (safe && claudeRiskAssessment) {
    if (claudeRiskAssessment.decision === 'needs_review') {
      safe = false;
      reasons.push(`Claude assessment: ${claudeRiskAssessment.reason || 'needs review'}`);
    }
    if (claudeRiskAssessment.touches_existing_functionality) {
      safe = false;
      reasons.push('Claude flagged: touches existing functionality');
    }
    if (claudeRiskAssessment.could_confuse_users) {
      safe = false;
      reasons.push('Claude flagged: could confuse users');
    }
    if (claudeRiskAssessment.removes_or_changes_features) {
      safe = false;
      reasons.push('Claude flagged: removes or changes existing features');
    }
  }

  // If no assessment and still safe, that's fine — new standalone pages are safe by default
  return { safe, reasons };
}

// ============================================
// Send notification email
// ============================================
async function sendReviewEmail(request, buildResult, branchName, riskReasons) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'feature_review',
        to: TEAM_EMAIL,
        data: {
          requester_name: request.requester_name,
          requester_role: request.requester_role,
          description: request.description,
          build_summary: buildResult.summary || '',
          files_created: buildResult.files_created || [],
          files_modified: buildResult.files_modified || [],
          branch_name: branchName,
          risk_assessment: {
            reason: riskReasons.join('; '),
            ...(buildResult.risk_assessment || {}),
          },
          notes: buildResult.notes || '',
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      log('error', 'Review email send failed', { status: res.status, body });
    } else {
      log('info', 'Review email sent', { to: TEAM_EMAIL });
    }
  } catch (err) {
    log('error', 'Review email error', { error: err.message });
  }
}

// ============================================
// Load prompt from DB
// ============================================
let cachedSystemPrompt = null;
let promptCacheTime = 0;
const PROMPT_CACHE_TTL_MS = 300000; // 5 minutes

async function loadSystemPrompt() {
  const now = Date.now();
  if (cachedSystemPrompt && (now - promptCacheTime) < PROMPT_CACHE_TTL_MS) {
    return cachedSystemPrompt;
  }

  try {
    const { data, error } = await supabase
      .from('prompts')
      .select('content')
      .eq('name', 'feature_builder_system')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!error && data?.content) {
      cachedSystemPrompt = data.content;
      promptCacheTime = now;
      log('info', 'Loaded system prompt from DB', { length: data.content.length });
      return cachedSystemPrompt;
    }
  } catch (err) {
    log('warn', 'Failed to load prompt from DB, using hardcoded fallback', { error: err.message });
  }
  return null;
}

// ============================================
// Send Claudero completion email
// ============================================
async function sendClauderoEmail(request, buildResult, deployDecision, branchName, commitSha) {
  const email = request.requester_email;
  if (!email) {
    log('warn', 'No requester email, skipping notification', { id: request.id });
    return;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'claudero_feature_complete',
        to: email,
        data: {
          requester_name: request.requester_name,
          description: request.description,
          build_summary: buildResult.summary || '',
          design_outline: buildResult.design_outline || '',
          testing_instructions: buildResult.testing_instructions || '',
          files_created: buildResult.files_created || [],
          files_modified: buildResult.files_modified || [],
          page_url: buildResult.page_url || '',
          branch_name: branchName || '',
          commit_sha: commitSha || '',
          deploy_decision: deployDecision,
          risk_assessment: buildResult.risk_assessment || {},
          notes: buildResult.notes || '',
          version: 'Assigned by CI shortly',
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      log('error', 'Claudero email send failed', { status: res.status, body });
    } else {
      log('info', 'Claudero email sent', { to: email });
    }
  } catch (err) {
    log('error', 'Claudero email error', { error: err.message });
  }
}

// ============================================
// Claude Code execution
// ============================================
async function buildPrompt(request) {
  // Try loading from DB first
  const dbPrompt = await loadSystemPrompt();
  if (dbPrompt) {
    // Interpolate {{placeholders}} with request data
    const spec = request.structured_spec || {};
    const context = spec.context || {};
    const vars = {
      requester_name: request.requester_name || 'Unknown',
      requester_role: request.requester_role || 'staff',
      description: request.description || '',
      parent_context: context.parent_request_id ? 'true' : '',
      parent_request_id: context.parent_request_id || '',
      parent_version: context.parent_version || '',
      parent_commit_sha: context.parent_commit_sha || '',
    };

    let prompt = dbPrompt;
    // Handle {{#if variable}}...{{/if}} blocks
    prompt = prompt.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, block) => {
      return vars[key] ? block : '';
    });
    // Handle {{variable}} replacements
    prompt = prompt.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return vars[key] !== undefined ? String(vars[key]) : '';
    });

    log('info', 'Using DB system prompt', { length: prompt.length });
    return prompt;
  }

  // Fallback to hardcoded prompt
  log('info', 'Using hardcoded fallback prompt');
  const spec = request.structured_spec || {};
  const pageName = spec.page_name || 'auto-determine from description';
  const dataSources = (spec.data_sources || []).join(', ') || 'determine from description';

  return `You are building a feature for Alpaca Playhouse, a property management web app.
The site is deployed to GitHub Pages (static HTML/JS, no build step). Backend is Supabase.

FEATURE REQUEST from ${request.requester_name} (${request.requester_role}):
${request.description}

Suggested page name: ${pageName}
Data sources: ${dataSources}

=== ABSOLUTE SECURITY RULES (NEVER VIOLATE) ===

1. Every page MUST use the existing auth system. Import and call:
   import { supabase } from '../shared/supabase.js';
   import { initResidentPage, showToast } from '../shared/resident-shell.js';

   initResidentPage({
     activeTab: null,
     requiredRole: 'resident',
     onReady: async (authState) => {
       // All page logic goes here — only runs after auth succeeds
     }
   });

2. NEVER bypass, weaken, or circumvent authentication or authorization
3. NEVER hardcode API keys, tokens, passwords, or secrets
4. NEVER expose admin-only data to non-admin users
5. NEVER make direct API calls to external services — use Supabase data only
6. Use the Supabase client from shared/supabase.js (it handles auth automatically via RLS)

=== FILE RULES ===

7. STRONGLY PREFER creating new files in the residents/ directory
8. If you must modify existing files, be minimal and careful — modifications trigger team review
9. NEVER modify shared modules (auth.js, supabase.js, resident-shell.js, pai-widget.js)
10. NEVER modify edge functions or anything in supabase/functions/
11. NEVER modify anything in shared/, scripts/, spaces/, or .github/
12. You MUST create at minimum: one .html file and one .js file

=== CONVENTIONS ===

13. Vanilla HTML/CSS/JavaScript only (NO React, NO frameworks, NO build tools)
14. ES modules (import/export)
15. HTML structure — follow this exact template:
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>PAGE TITLE - AlpacAPPs Residents</title>
      <link rel="icon" type="image/png" href="../favicon.png">
      <link rel="apple-touch-icon" href="../apple-touch-icon.png">
      <link rel="stylesheet" href="../spaces/styles.css?v=5">
      <link rel="stylesheet" href="../spaces/admin/styles.css?v=5">
      <link rel="stylesheet" href="../spaces/admin/manage-shared.css?v=5">
      <link rel="stylesheet" href="residents.css?v=5">
    </head>
    <body>
      <div id="toastContainer" class="toast-container"></div>
      <div id="loadingOverlay" class="loading-overlay">
        <div class="spinner"></div><p>Loading...</p>
      </div>
      <div id="unauthorizedOverlay" class="loading-overlay hidden">
        <div class="unauthorized-card">
          <h2>Access Denied</h2>
          <p>Your account is not authorized to access resident features.</p>
          <div class="unauthorized-actions">
            <a href="/spaces/" class="btn-secondary">View Public Spaces</a>
            <button id="signOutBtn" class="btn-secondary">Sign Out</button>
          </div>
        </div>
      </div>
      <div id="appContent" class="hidden">
        <header>
          <div class="header-left">
            <a href="https://alpacaplayhouse.com" class="header-logo">
              <img src="https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos/logos/alpaca-head-black-transparent.png" alt="AlpacAPPs" class="header-logo__icon">
              <img src="https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos/logos/wordmark-black-transparent.png" alt="AlpacAPPs" class="header-logo__wordmark">
            </a>
            <span title="Site version" style="font-size:0.75rem;color:var(--text-muted);font-weight:500;cursor:pointer;align-self:center;margin-left:-0.25rem">v000000.00</span>
            <span id="roleBadge" class="role-badge">Staff</span>
          </div>
          <div class="header-controls">
            <span id="userInfo" class="user-info"></span>
            <button id="headerSignOutBtn" class="btn-secondary">Sign Out</button>
          </div>
        </header>
        <div class="context-switcher hidden" id="contextSwitcher">
          <a class="context-switcher-btn active">Resident</a>
          <a href="/spaces/admin/" class="context-switcher-btn">Staff</a>
        </div>
        <div class="manage-tabs" id="tabNav"></div>
        <main class="manage-content">
          <!-- YOUR CONTENT HERE -->
        </main>
      </div>
      <script src="https://unpkg.com/@supabase/supabase-js@2.39.3"></script>
      <script type="module" src="YOUR_JS_FILE.js"></script>
    </body>
    </html>

16. Use version placeholder: v000000.00 (the bump script will replace it)
17. CSS: use existing variables from the stylesheets:
    --bg-card, --border, --radius, --shadow, --text-muted, --available, --occupied
18. Use showToast(message, type) for notifications, not alert()
19. For polling data: use setInterval at 30s, pause when document.hidden:
    let pollInterval;
    function startPolling() { pollInterval = setInterval(loadData, 30000); }
    function stopPolling() { clearInterval(pollInterval); }
    document.addEventListener('visibilitychange', () => {
      document.hidden ? stopPolling() : (loadData(), startPolling());
    });
    startPolling();

=== DO NOT ===

20. Do NOT modify the tab navigation array (that's in resident-shell.js, a shared module)
21. Do NOT run any git commands or update the version number
22. Do NOT read CLAUDE.md or CLAUDE.local.md
23. Do NOT install packages or run npm commands
24. Do NOT create edge functions

=== OUTPUT (required JSON format) ===

You MUST output a JSON object as your final response with these keys:
{
  "summary": "What you built (1-2 sentences)",
  "files_created": ["residents/my-page.html", "residents/my-page.js"],
  "files_modified": [],
  "page_url": "/residents/my-page.html",
  "risk_assessment": {
    "decision": "auto_merge",
    "reason": "New standalone page, reads only from existing Supabase tables, no changes to existing UI",
    "touches_existing_functionality": false,
    "could_confuse_users": false,
    "removes_or_changes_features": false
  },
  "notes": "Any caveats or things the admin should know"
}

RISK ASSESSMENT GUIDELINES:
- "auto_merge": ONLY if you created new files exclusively, didn't touch any existing pages,
  the feature is purely additive, and there's zero risk of confusing users or breaking anything.
  A new standalone page that reads from existing data is a good example of auto_merge.
- "needs_review": If you modified ANY existing file, if the feature overlaps with existing UI,
  if it could be confusing to users, if you're unsure about anything, or if the change
  removes/alters existing behavior. WHEN IN DOUBT, CHOOSE needs_review.`;
}

async function runClaudeCode(request) {
  const prompt = await buildPrompt(request);

  await mkdir(TEMP_DIR, { recursive: true });

  const args = [
    '-p', prompt,
    '--allowedTools', 'Write,Edit,Read,Glob,Grep',
    '--max-turns', '20',
    '--output-format', 'json',
    '--dangerously-skip-permissions',
  ];

  log('info', 'Running Claude Code', {
    prompt_length: prompt.length,
    cwd: REPO_DIR,
  });

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: REPO_DIR,
      env: {
        ...process.env,
        CI: 'true',
        HOME: process.env.HOME || '/home/bugfixer',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: MAX_BUILD_TIMEOUT_MS,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      if (chunk.trim()) {
        log('debug', 'Claude stderr', { text: chunk.trim().substring(0, 200) });
      }
    });

    child.stdin.end();

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Claude Code timed out after ${MAX_BUILD_TIMEOUT_MS / 1000}s`));
    }, MAX_BUILD_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timeout);

      log('info', 'Claude Code exited', {
        code,
        stdout_length: stdout.length,
        stderr_length: stderr.length,
      });

      if (code !== 0) {
        const errMsg = stderr || stdout || `Claude Code exited with code ${code}`;
        reject(new Error(`Claude Code failed (exit ${code}): ${errMsg.substring(0, 2000)}`));
        return;
      }

      // Parse JSON output
      let result = {
        summary: 'Feature built.',
        files_created: [],
        files_modified: [],
        page_url: '',
        risk_assessment: null,
        notes: '',
      };

      try {
        const output = JSON.parse(stdout);
        // Capture turns from top-level output
        if (output.num_turns) result.num_turns = output.num_turns;
        if (output.total_cost_usd) result.cost_usd = output.total_cost_usd;
        // Claude Code --output-format json wraps in { result: "..." }
        let inner = output.result || output;
        if (typeof inner === 'string') {
          // Strip markdown code fences if present (```json ... ```)
          const fenceMatch = inner.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
          if (fenceMatch) {
            inner = fenceMatch[1].trim();
          }
          // Try parsing the result string as JSON
          try {
            inner = JSON.parse(inner);
          } catch {
            // Maybe the JSON is embedded in a longer text response — try to find it
            const jsonMatch = inner.match(/\{[\s\S]*"summary"[\s\S]*"files_created"[\s\S]*\}/);
            if (jsonMatch) {
              try {
                inner = JSON.parse(jsonMatch[0]);
              } catch {
                // Not JSON, use as summary
                result.summary = inner.substring(0, 500);
                resolve(result);
                return;
              }
            } else {
              // Not JSON at all, use as summary
              result.summary = inner.substring(0, 500);
              resolve(result);
              return;
            }
          }
        }
        if (inner.summary) result.summary = inner.summary;
        if (inner.design_outline) result.design_outline = inner.design_outline;
        if (inner.testing_instructions) result.testing_instructions = inner.testing_instructions;
        if (inner.files_created) result.files_created = inner.files_created;
        if (inner.files_modified) result.files_modified = inner.files_modified;
        if (inner.page_url) result.page_url = inner.page_url;
        if (inner.risk_assessment) result.risk_assessment = inner.risk_assessment;
        if (inner.notes) result.notes = inner.notes;
      } catch {
        if (stdout) {
          result.summary = stdout.substring(0, 500);
        }
      }

      resolve(result);
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn Claude Code: ${err.message}`));
    });
  });
}

// ============================================
// Update progress in DB
// ============================================
async function updateProgress(requestId, updates) {
  await supabase
    .from('feature_requests')
    .update(updates)
    .eq('id', requestId);
}

// ============================================
// Process a single feature request
// ============================================
async function processFeatureRequest(request) {
  log('info', '=== Processing feature request ===', {
    id: request.id,
    requester: request.requester_name,
    description: request.description.substring(0, 100),
  });

  await notifyDiscord(`🔨 **Feature Builder: processing** — "${request.description.substring(0, 150)}" (from ${request.requester_name})`);

  try {
    // 1. Mark as processing
    await updateProgress(request.id, {
      status: 'processing',
      progress_message: 'Pulling latest code...',
      processing_started_at: new Date().toISOString(),
    });

    // 2. Pull latest code
    await gitPull();

    // 3. Mark as building
    await updateProgress(request.id, {
      status: 'building',
      progress_message: 'Claude Code is building your feature...',
    });

    // 4. Run Claude Code
    const buildResult = await runClaudeCode(request);
    log('info', 'Claude Code finished', { summary: buildResult.summary.substring(0, 200) });

    // 5. Check if changes were made
    const hasChanges = await gitHasChanges();

    if (!hasChanges) {
      await updateProgress(request.id, {
        status: 'failed',
        build_summary: buildResult.summary,
        error_message: 'Claude Code ran but produced no file changes.',
        completed_at: new Date().toISOString(),
      });
      log('warn', 'No changes made by Claude Code', { id: request.id });
      return;
    }

    // 6. Analyze changes for risk
    const diffFiles = await gitDiffNameStatus();
    log('info', 'Git diff analysis', { files: diffFiles });

    const { safe, reasons } = evaluateRisk(diffFiles, buildResult.risk_assessment);
    log('info', 'Risk evaluation', { safe, reasons });

    // 7. Create branch and commit
    const { commitSha, branchName } = await gitCreateBranchAndCommit(request.description, request.id);
    log('info', 'Feature pushed to branch', { branch: branchName, commit: commitSha });

    // 8. Deploy decision
    if (safe) {
      // AUTO-MERGE: safe to go live
      log('info', 'Auto-merging to main (safe)', { branch: branchName });
      const { mainSha } = await gitMergeBranchToMain(branchName);

      await updateProgress(request.id, {
        status: 'completed',
        deploy_decision: 'auto_merged',
        branch_name: branchName,
        commit_sha: mainSha,
        files_created: buildResult.files_created || [],
        build_summary: buildResult.summary,
        risk_assessment: buildResult.risk_assessment || { decision: 'auto_merge', reason: 'New files only' },
        claude_turns_used: buildResult.num_turns || null,
        completed_at: new Date().toISOString(),
        progress_message: `Deployed! Release sequence will be assigned by CI. Visit: https://alpacaplayhouse.com${buildResult.page_url || '/residents/'}`,
      });

      log('info', '=== Feature auto-merged and deployed ===', {
        id: request.id,
        branch: branchName,
        release: 'ci-assigned',
        page_url: buildResult.page_url,
      });

      // Send Claudero notification email to requester
      await sendClauderoEmail(request, buildResult, 'auto_merged', branchName, mainSha);
      await notifyDiscord(`✅ **Feature Builder: deployed** — "${request.description.substring(0, 100)}"\nBranch: \`${branchName}\` → merged to main\nFiles: ${(buildResult.files_created || []).join(', ')}`);

    } else {
      // BRANCH FOR REVIEW: needs human approval
      log('info', 'Branching for review (risky)', { branch: branchName, reasons });

      // Send review email
      await sendReviewEmail(request, buildResult, branchName, reasons);

      await updateProgress(request.id, {
        status: 'review',
        deploy_decision: 'branched_for_review',
        branch_name: branchName,
        commit_sha: commitSha,
        files_created: buildResult.files_created || [],
        build_summary: buildResult.summary,
        risk_assessment: {
          ...(buildResult.risk_assessment || {}),
          hard_rule_reasons: reasons,
        },
        claude_turns_used: buildResult.num_turns || null,
        completed_at: new Date().toISOString(),
        review_notified_at: new Date().toISOString(),
        progress_message: `Built on branch ${branchName}. Sent for team review.`,
      });

      log('info', '=== Feature branched for review ===', {
        id: request.id,
        branch: branchName,
        reasons,
      });

      // Send Claudero notification email to requester
      await sendClauderoEmail(request, buildResult, 'branched_for_review', branchName, commitSha);
      await notifyDiscord(`🔍 **Feature Builder: needs review** — "${request.description.substring(0, 100)}"\nBranch: \`${branchName}\`\nReason: ${reasons.join('; ').substring(0, 300)}`);
    }

    // Return to main for next run
    try {
      await execAsync('git checkout main', { cwd: REPO_DIR });
    } catch { /* ignore */ }

  } catch (err) {
    const errorMsg = err.message.substring(0, 2000);
    log('error', 'Feature build failed', {
      id: request.id,
      error: errorMsg,
    });

    await updateProgress(request.id, {
      status: 'failed',
      error_message: errorMsg,
      completed_at: new Date().toISOString(),
    });

    await notifyDiscord(`❌ **Feature Builder: failed** — "${request.description.substring(0, 100)}"\nError: ${errorMsg.substring(0, 300)}`);

    // Clean up git state
    try {
      await execAsync('git checkout main 2>/dev/null; git checkout -- . && git clean -fd', { cwd: REPO_DIR });
    } catch { /* ignore */ }
  }
}

// ============================================
// Main poll loop
// ============================================
let isProcessing = false;

async function pollForRequests() {
  if (isProcessing) return;

  try {
    const { data: requests, error } = await supabase
      .from('feature_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      log('error', 'Poll query failed', { error: error.message });
      return;
    }

    if (requests && requests.length > 0) {
      isProcessing = true;
      try {
        await processFeatureRequest(requests[0]);
      } finally {
        isProcessing = false;
      }
    }
  } catch (err) {
    log('error', 'Poll loop error', { error: err.message });
    isProcessing = false;
  }
}

// ============================================
// Startup
// ============================================
async function main() {
  log('info', 'Feature Builder starting', {
    repo: REPO_DIR,
    poll_interval: POLL_INTERVAL_MS,
    max_timeout: MAX_BUILD_TIMEOUT_MS,
  });

  if (!existsSync(REPO_DIR)) {
    log('error', `Repo directory does not exist: ${REPO_DIR}`);
    process.exit(1);
  }

  // Verify Claude Code is installed
  try {
    const { stdout: claudeVer } = await execAsync('claude --version 2>/dev/null || echo unknown');
    log('info', 'Claude Code CLI found', {
      version: claudeVer.trim(),
      home: process.env.HOME,
      user: process.env.USER || 'unknown',
    });
  } catch {
    log('error', 'Claude Code CLI not found');
    process.exit(1);
  }

  await gitPull();

  log('info', `Polling every ${POLL_INTERVAL_MS / 1000}s for feature requests...`);
  setInterval(pollForRequests, POLL_INTERVAL_MS);
  await pollForRequests();
}

main().catch(err => {
  log('error', 'Fatal error', { error: err.message });
  process.exit(1);
});
