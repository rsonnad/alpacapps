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
const DEFAULT_REVIEW_EMAIL = 'alpacaautomatic@gmail.com';
let cachedReviewEmail = null;
let reviewEmailCacheTime = 0;
const REVIEW_EMAIL_CACHE_TTL_MS = 300000; // 5 minutes
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
// Dynamic review email from appdev_config
// ============================================
async function getReviewEmail() {
  const now = Date.now();
  if (cachedReviewEmail && (now - reviewEmailCacheTime) < REVIEW_EMAIL_CACHE_TTL_MS) {
    return cachedReviewEmail;
  }
  try {
    const { data } = await supabase
      .from('appdev_config')
      .select('review_notify_email')
      .single();
    if (data?.review_notify_email) {
      cachedReviewEmail = data.review_notify_email;
      reviewEmailCacheTime = now;
      return cachedReviewEmail;
    }
  } catch (err) {
    log('warn', 'Failed to load review email config, using default', { error: err.message });
  }
  return DEFAULT_REVIEW_EMAIL;
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

/**
 * Poll release_events for the version assigned by CI after a push to main.
 * CI typically takes ~60s. We poll every 10s for up to 120s.
 */
async function waitForDeployedVersion(pushSha, requestId) {
  const MAX_WAIT_MS = 120000;
  const POLL_MS = 10000;
  const start = Date.now();

  log('info', 'Waiting for CI version assignment...', { pushSha: pushSha.substring(0, 8), requestId });

  while (Date.now() - start < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));

    try {
      const { data, error } = await supabase
        .from('release_events')
        .select('display_version')
        .eq('push_sha', pushSha)
        .maybeSingle();

      if (!error && data?.display_version) {
        log('info', 'CI version found', { version: data.display_version, elapsed: Date.now() - start });

        // Update the feature request with the deployed version
        await supabase
          .from('feature_requests')
          .update({ deployed_version: data.display_version })
          .eq('id', requestId);

        return data.display_version;
      }
    } catch (err) {
      log('warn', 'Version poll error', { error: err.message });
    }
  }

  log('warn', 'CI version not found within timeout', { pushSha: pushSha.substring(0, 8), elapsed: Date.now() - start });
  return null;
}

// ============================================
// Risk Evaluation
// ============================================

/**
 * Evaluate risk of changes. Returns { safe: boolean, reasons: string[] }
 *
 * Three tiers:
 *   1. BLOCKED — forbidden files (auth modules, edge functions, CI). Fail the build entirely.
 *   2. NEEDS REVIEW — modified existing files, deleted files, or Claude flagged risk. Branch for review.
 *   3. AUTO-MERGE — only new files in safe directories, Claude says auto_merge.
 */
function evaluateRisk(diffFiles, claudeRiskAssessment) {
  const reasons = [];
  let safe = true;
  let blocked = false;

  const modified = diffFiles.filter(f => f.status === 'M');
  const deleted = diffFiles.filter(f => f.status === 'D');
  const allFiles = diffFiles.map(f => f.file);

  // Tier 1: BLOCKED — files that must NEVER be touched
  const forbiddenPatterns = [
    'shared/auth.js',
    'shared/supabase.js',
    'shared/resident-shell.js',
    'shared/admin-shell.js',
    'shared/pai-widget.js',
    'supabase/functions/',
    '.github/',
    'scripts/bump-version',
    'version.json',
    'CLAUDE.md',
    'CLAUDE.local.md',
  ];
  const forbiddenFiles = allFiles.filter(f =>
    forbiddenPatterns.some(p => f === p || f.startsWith(p))
  );
  if (forbiddenFiles.length > 0) {
    blocked = true;
    reasons.push(`BLOCKED — touched forbidden files: ${forbiddenFiles.join(', ')}`);
  }

  // Tier 2: NEEDS REVIEW — only for sensitive file modifications or deletions
  // Non-sensitive file edits (HTML pages, CSS, page-specific JS) are safe to auto-merge.
  const sensitivePatterns = [
    'shared/',           // Shared modules used by many pages
    'mobile/',           // Mobile app code
    'package.json',
    'package-lock.json',
  ];
  const sensitiveModified = modified.filter(f =>
    sensitivePatterns.some(p => f.file === p || f.file.startsWith(p))
  );
  if (sensitiveModified.length > 0) {
    safe = false;
    reasons.push(`Modified sensitive files: ${sensitiveModified.map(f => f.file).join(', ')}`);
  }

  if (deleted.length > 0) {
    safe = false;
    reasons.push(`Deleted files: ${deleted.map(f => f.file).join(', ')}`);
  }

  // Claude's self-assessment — trust it for needs_review decisions
  if (claudeRiskAssessment) {
    if (claudeRiskAssessment.decision === 'needs_review') {
      safe = false;
      reasons.push(`Claude assessment: ${claudeRiskAssessment.reason || 'needs review'}`);
    }
    if (claudeRiskAssessment.removes_or_changes_features) {
      safe = false;
      reasons.push('Claude flagged: removes or changes existing features');
    }
  }

  return { safe, blocked, reasons };
}

// ============================================
// Send notification email
// ============================================
async function sendReviewEmail(request, buildResult, branchName, riskReasons) {
  try {
    const reviewEmail = await getReviewEmail();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'feature_review',
        to: reviewEmail,
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
      log('info', 'Review email sent', { to: reviewEmail });
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
    // Build attachments context string
    const attachments = request.attachments || [];
    const attachmentContext = attachments.length
      ? `\n\nATTACHED FILES (${attachments.length}):\n` + attachments.map((a, i) =>
          `${i + 1}. ${a.name} (${a.type}, ${Math.round(a.size / 1024)}KB): ${a.url}`
        ).join('\n')
      : '';

    const vars = {
      requester_name: request.requester_name || 'Unknown',
      requester_role: request.requester_role || 'staff',
      description: (request.description || '') + attachmentContext,
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

  return `You are Claudero, an AI developer for Alpaca Playhouse — a property management web app hosted on GitHub Pages (static HTML/JS, no build step) with a Supabase backend.

FEATURE REQUEST from ${request.requester_name} (${request.requester_role}):
${request.description}
${(request.attachments || []).length ? '\nATTACHED FILES (' + request.attachments.length + '):\n' + request.attachments.map((a, i) => `${i + 1}. ${a.name} (${a.type}): ${a.url}`).join('\n') : ''}

=== SECURITY RULES (NEVER VIOLATE) ===

1. Pages MUST use the existing auth system (initResidentPage or initAdminPage)
2. NEVER bypass, weaken, or circumvent authentication or authorization
3. NEVER hardcode API keys, tokens, passwords, or secrets
4. NEVER expose admin-only data to non-admin users
5. NEVER make direct API calls to external services — use Supabase data only

=== FILE RULES ===

6. For NEW features: prefer creating new files in residents/ or spaces/admin/
7. For MODIFICATIONS to existing pages: edit the relevant existing files directly — this is expected and encouraged when the request asks to fix or improve something that already exists
8. NEVER modify core auth modules: auth.js, supabase.js, resident-shell.js, admin-shell.js, pai-widget.js
9. NEVER modify edge functions (supabase/functions/)
10. NEVER modify CI/deploy files (.github/, scripts/bump-version*, version.json)
11. Keep changes minimal and focused — only change what the request asks for

=== CONVENTIONS ===

12. Vanilla HTML/CSS/JavaScript only — NO frameworks, NO build tools
13. ES modules (import/export)
14. CSS: use existing variables (--bg-card, --border, --radius, --shadow, --text-muted)
15. Use showToast(message, type) for notifications, never alert()

=== DO NOT ===

16. Do NOT run git commands or update version numbers
17. Do NOT read CLAUDE.md or CLAUDE.local.md
18. Do NOT install packages or run npm commands
19. Do NOT create edge functions

=== OUTPUT FORMAT (REQUIRED JSON) ===

You MUST output a JSON object as your FINAL response with these keys:

{
  "summary": "What you built or changed (1-2 sentences)",
  "design_outline": "Brief description of the approach (2-4 sentences)",
  "testing_instructions": "Step-by-step instructions for testing",
  "files_created": [],
  "files_modified": ["spaces/admin/appdev.js"],
  "page_url": "/spaces/admin/appdev.html",
  "risk_assessment": {
    "decision": "auto_merge or needs_review",
    "reason": "Explanation of risk level",
    "touches_existing_functionality": true/false,
    "could_confuse_users": true/false,
    "removes_or_changes_features": true/false
  },
  "notes": "Any caveats"
}

RISK ASSESSMENT:
- "auto_merge": For new standalone files, OR trivial CSS/layout fixes that cannot break functionality.
- "needs_review": If you changed business logic, could confuse users, or are unsure. WHEN IN DOUBT, CHOOSE needs_review.`;
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

    const { safe, blocked, reasons } = evaluateRisk(diffFiles, buildResult.risk_assessment);
    log('info', 'Risk evaluation', { safe, blocked, reasons });

    // Hard block: forbidden files were touched — fail the build
    if (blocked) {
      // Clean up the working tree
      await execAsync('git checkout -- . && git clean -fd', { cwd: REPO_DIR });
      await updateProgress(request.id, {
        status: 'failed',
        build_summary: buildResult.summary,
        error_message: `Build blocked: ${reasons.join('; ')}`,
        completed_at: new Date().toISOString(),
      });
      log('warn', 'Build blocked — forbidden files touched', { id: request.id, reasons });
      await notifyDiscord(`🚫 **Feature Builder: blocked** — "${request.description.substring(0, 100)}"\nReason: ${reasons.join('; ').substring(0, 300)}`);
      return;
    }

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

      // Wait for CI to assign a version number (non-blocking for the overall flow)
      const deployedVersion = await waitForDeployedVersion(mainSha, request.id);
      if (deployedVersion) {
        await updateProgress(request.id, {
          progress_message: `Deployed as ${deployedVersion}! Visit: https://alpacaplayhouse.com${buildResult.page_url || '/residents/'}`,
        });
      }

      // Send Claudero notification email to requester
      await sendClauderoEmail(request, buildResult, 'auto_merged', branchName, mainSha);
      await notifyDiscord(`✅ **Feature Builder: deployed** — "${request.description.substring(0, 100)}"\nBranch: \`${branchName}\` → merged to main${deployedVersion ? `\nVersion: ${deployedVersion}` : ''}\nFiles: ${(buildResult.files_created || []).join(', ')}`);

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
// Handle admin-approved merges
// ============================================
async function handleApprovedMerge(request) {
  log('info', '=== Admin-approved merge starting ===', {
    id: request.id,
    branch: request.branch_name,
  });

  try {
    // Mark as processing
    await supabase
      .from('feature_requests')
      .update({
        status: 'processing',
        progress_message: 'Merging approved branch to main...',
      })
      .eq('id', request.id);

    if (!request.branch_name) {
      throw new Error('No branch_name set on approved request');
    }

    // Merge the branch
    await gitPull();
    const { mainSha } = await gitMergeBranchToMain(request.branch_name);

    // Wait for CI to assign version
    const deployedVersion = await waitForDeployedVersion(mainSha, request.id);

    // Update to completed
    await supabase
      .from('feature_requests')
      .update({
        status: 'completed',
        deploy_decision: 'admin_approved',
        deployed_version: deployedVersion || null,
        progress_message: deployedVersion
          ? `Approved & deployed as ${deployedVersion}`
          : 'Approved & merged — waiting for version assignment',
      })
      .eq('id', request.id);

    log('info', '=== Admin-approved merge complete ===', {
      id: request.id,
      branch: request.branch_name,
      version: deployedVersion,
    });

    // Send notification email to requester
    await sendClauderoEmail(request, {
      summary: request.build_summary || 'Admin approved merge',
      files_created: request.files_created || [],
    }, 'admin_approved', request.branch_name, mainSha);

    await notifyDiscord(`✅ **Feature Builder: admin-approved merge** — "${request.description?.substring(0, 100)}"\nBranch: \`${request.branch_name}\` → merged to main${deployedVersion ? `\nVersion: ${deployedVersion}` : ''}`);

  } catch (err) {
    log('error', 'Admin-approved merge failed', {
      id: request.id,
      error: err.message,
    });

    // Revert to review status so admin can retry
    await supabase
      .from('feature_requests')
      .update({
        status: 'review',
        progress_message: `Merge failed: ${err.message.substring(0, 500)}`,
      })
      .eq('id', request.id);

    await notifyDiscord(`❌ **Feature Builder: merge failed** — "${request.description?.substring(0, 100)}"\nError: ${err.message.substring(0, 300)}`);

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
    // Check for pending build requests
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
      return; // Process one at a time
    }

    // Check for admin-approved merge requests
    const { data: approved, error: approvedErr } = await supabase
      .from('feature_requests')
      .select('*')
      .eq('status', 'approved')
      .order('approved_at', { ascending: true })
      .limit(1);

    if (approvedErr) {
      log('error', 'Approved poll query failed', { error: approvedErr.message });
      return;
    }

    if (approved && approved.length > 0) {
      isProcessing = true;
      try {
        await handleApprovedMerge(approved[0]);
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
