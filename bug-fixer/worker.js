import { createClient } from '@supabase/supabase-js';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// ============================================
// Configuration
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REPO_DIR = process.env.REPO_DIR || '/opt/bug-fixer/repo';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000');
const MAX_FIX_TIMEOUT_MS = parseInt(process.env.MAX_FIX_TIMEOUT_MS || '300000'); // 5 minutes
const TEMP_DIR = '/tmp/bug-fixer';

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
// Git helpers
// ============================================
async function gitPull() {
  try {
    await execAsync('git fetch origin && git reset --hard origin/main', { cwd: REPO_DIR });
    log('info', 'Git pull complete');
  } catch (err) {
    log('error', 'Git pull failed', { error: err.message });
    throw err;
  }
}

async function gitHasChanges() {
  const { stdout } = await execAsync('git status --porcelain', { cwd: REPO_DIR });
  return stdout.trim().length > 0;
}

async function gitCommitAndPush(description) {
  const shortDesc = description.substring(0, 72);
  const commitMsg = `fix: ${shortDesc}\n\nAutomated fix from bug report.\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`;

  await execAsync('git add -A', { cwd: REPO_DIR });
  await execAsync(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd: REPO_DIR });
  await execAsync('git push origin main', { cwd: REPO_DIR });

  const { stdout } = await execAsync('git rev-parse HEAD', { cwd: REPO_DIR });
  return stdout.trim();
}

// ============================================
// Claude Code execution
// ============================================
async function runClaudeCode(report, screenshotPath) {
  const prompt = [
    `Fix this bug reported by ${report.reporter_name}:`,
    '',
    `Description: ${report.description}`,
    '',
    report.page_url ? `Page URL: ${report.page_url}` : '',
    '',
    'The attached screenshot shows the issue with annotations highlighting the problem.',
    '',
    'Instructions:',
    '- Read the CLAUDE.md file first for project context',
    '- Identify the relevant files based on the page URL and description',
    '- Make the minimal fix needed',
    '- Do NOT push to git (the worker handles that)',
  ].filter(Boolean).join('\n');

  const args = [
    '-p', prompt,
    '--allowedTools', 'Edit,Write,Read,Glob,Grep,Bash',
    '--max-turns', '25',
    '--output-format', 'json',
  ];

  // Add image if we have a screenshot
  if (screenshotPath) {
    args.push('--image', screenshotPath);
  }

  log('info', 'Running Claude Code', { prompt_length: prompt.length });

  const result = await execFileAsync('claude', args, {
    cwd: REPO_DIR,
    timeout: MAX_FIX_TIMEOUT_MS,
    env: {
      ...process.env,
      // Ensure Claude Code doesn't try to use interactive features
      CI: 'true',
    },
    maxBuffer: 10 * 1024 * 1024, // 10MB
  });

  // Try to parse JSON output for summary
  let summary = 'Fix applied.';
  try {
    const output = JSON.parse(result.stdout);
    if (output.result) {
      summary = output.result;
    }
  } catch {
    // If not JSON, use raw stdout (truncated)
    if (result.stdout) {
      summary = result.stdout.substring(0, 500);
    }
  }

  return summary;
}

// ============================================
// Download screenshot
// ============================================
async function downloadScreenshot(url) {
  await mkdir(TEMP_DIR, { recursive: true });
  const filename = `screenshot-${Date.now()}.png`;
  const filepath = path.join(TEMP_DIR, filename);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download screenshot: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(filepath, buffer);

  return filepath;
}

// ============================================
// Send notification email
// ============================================
async function sendEmail(type, report, extraData = {}) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type,
        to: report.reporter_email,
        data: {
          reporter_name: report.reporter_name,
          description: report.description,
          page_url: report.page_url,
          screenshot_url: report.screenshot_url,
          ...extraData,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      log('error', 'Email send failed', { status: res.status, body });
    } else {
      log('info', 'Email sent', { type, to: report.reporter_email });

      // Mark as notified
      await supabase
        .from('bug_reports')
        .update({ notified_at: new Date().toISOString() })
        .eq('id', report.id);
    }
  } catch (err) {
    log('error', 'Email send error', { error: err.message });
  }
}

// ============================================
// Process a single bug report
// ============================================
async function processBugReport(report) {
  log('info', '=== Processing bug report ===', {
    id: report.id,
    reporter: report.reporter_name,
    description: report.description.substring(0, 100),
  });

  let screenshotPath = null;

  try {
    // 1. Mark as processing
    await supabase
      .from('bug_reports')
      .update({ status: 'processing' })
      .eq('id', report.id);

    // 2. Pull latest code
    await gitPull();

    // 3. Download screenshot
    if (report.screenshot_url) {
      screenshotPath = await downloadScreenshot(report.screenshot_url);
      log('info', 'Screenshot downloaded', { path: screenshotPath });
    }

    // 4. Run Claude Code
    const fixSummary = await runClaudeCode(report, screenshotPath);
    log('info', 'Claude Code finished', { summary: fixSummary.substring(0, 200) });

    // 5. Check if changes were made
    const hasChanges = await gitHasChanges();

    if (hasChanges) {
      // 6. Commit and push
      const commitSha = await gitCommitAndPush(report.description);
      log('info', 'Fix pushed', { commit: commitSha });

      // 7. Update report
      await supabase
        .from('bug_reports')
        .update({
          status: 'fixed',
          fix_summary: fixSummary,
          fix_commit_sha: commitSha,
          processed_at: new Date().toISOString(),
        })
        .eq('id', report.id);

      // 8. Email reporter
      await sendEmail('bug_report_fixed', report, {
        fix_summary: fixSummary,
        fix_commit_sha: commitSha,
      });

      log('info', '=== Bug report fixed ===', { id: report.id, commit: commitSha });
    } else {
      // Claude Code ran but made no changes
      const msg = 'Claude Code analyzed the report but determined no code changes were needed. The issue may not be reproducible or may require manual investigation.';

      await supabase
        .from('bug_reports')
        .update({
          status: 'failed',
          fix_summary: fixSummary,
          error_message: msg,
          processed_at: new Date().toISOString(),
        })
        .eq('id', report.id);

      await sendEmail('bug_report_failed', report, { error_message: msg });
      log('warn', 'No changes made by Claude Code', { id: report.id });
    }

  } catch (err) {
    log('error', 'Bug fix failed', { id: report.id, error: err.message });

    // Update report as failed
    await supabase
      .from('bug_reports')
      .update({
        status: 'failed',
        error_message: err.message,
        processed_at: new Date().toISOString(),
      })
      .eq('id', report.id);

    // Email reporter about failure
    await sendEmail('bug_report_failed', report, { error_message: err.message });

    // Clean up any dirty git state
    try {
      await execAsync('git checkout -- . && git clean -fd', { cwd: REPO_DIR });
    } catch {
      // ignore cleanup errors
    }

  } finally {
    // Clean up temp screenshot
    if (screenshotPath) {
      try { await unlink(screenshotPath); } catch { /* ignore */ }
    }
  }
}

// ============================================
// Main poll loop
// ============================================
async function pollForReports() {
  try {
    const { data: reports, error } = await supabase
      .from('bug_reports')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      log('error', 'Poll query failed', { error: error.message });
      return;
    }

    if (reports && reports.length > 0) {
      await processBugReport(reports[0]);
    }
  } catch (err) {
    log('error', 'Poll loop error', { error: err.message });
  }
}

// ============================================
// Startup
// ============================================
async function main() {
  log('info', 'Bug fixer worker starting', {
    repo: REPO_DIR,
    poll_interval: POLL_INTERVAL_MS,
    max_timeout: MAX_FIX_TIMEOUT_MS,
  });

  // Verify repo exists
  if (!existsSync(REPO_DIR)) {
    log('error', `Repo directory does not exist: ${REPO_DIR}`);
    log('info', 'Run install.sh first to set up the repo');
    process.exit(1);
  }

  // Verify Claude Code is installed
  try {
    await execAsync('which claude');
    log('info', 'Claude Code CLI found');
  } catch {
    log('error', 'Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
    process.exit(1);
  }

  // Initial pull
  await gitPull();

  // Start polling
  log('info', `Polling every ${POLL_INTERVAL_MS / 1000}s for new bug reports...`);
  setInterval(pollForReports, POLL_INTERVAL_MS);

  // Also run immediately
  await pollForReports();
}

main().catch(err => {
  log('error', 'Fatal error', { error: err.message });
  process.exit(1);
});
