import { createClient } from '@supabase/supabase-js';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

const execAsync = promisify(exec);

// ============================================
// Configuration
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MzA0MjUsImV4cCI6MjA4NTUwNjQyNX0.yYkdQIq97GQgxK7yT2OQEPi5Tt-a7gM45aF8xjSD6wk';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_EMAIL = 'bot@alpacaplayhouse.com';
const BOT_PASSWORD = process.env.BOT_USER_PASSWORD;
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
    report.screenshot_url ? `Screenshot of the bug (downloaded locally, use Read tool to view): ${screenshotPath}` : '',
    report.screenshot_url ? `Screenshot public URL: ${report.screenshot_url}` : '',
    '',
    'Instructions:',
    '- Read the CLAUDE.md file first for project context',
    '- View the screenshot file to understand the visual bug',
    '- Identify the relevant files based on the page URL and description',
    '- Make the minimal fix needed',
    '- Do NOT push to git (the worker handles that)',
    '- Do NOT update the version number (the worker handles that)',
  ].filter(Boolean).join('\n');

  // Write prompt to temp file to avoid shell escaping issues
  await mkdir(TEMP_DIR, { recursive: true });
  const promptFile = path.join(TEMP_DIR, `prompt-${Date.now()}.txt`);
  await writeFile(promptFile, prompt, 'utf-8');

  const args = [
    '-p', prompt,
    '--allowedTools', 'Edit,Write,Read,Glob,Grep,Bash(git:*)',
    '--max-turns', '25',
    '--output-format', 'json',
    '--dangerously-skip-permissions',
  ];

  log('info', 'Running Claude Code', {
    prompt_length: prompt.length,
    args_count: args.length,
    cwd: REPO_DIR,
  });

  // Use spawn for better control over long-running processes
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: REPO_DIR,
      env: {
        ...process.env,
        CI: 'true',
        HOME: process.env.HOME || '/home/bugfixer',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: MAX_FIX_TIMEOUT_MS,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      // Log stderr in real-time for debugging
      if (chunk.trim()) {
        log('debug', 'Claude stderr', { text: chunk.trim().substring(0, 200) });
      }
    });

    // Close stdin immediately since we're using -p flag
    child.stdin.end();

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Claude Code timed out after ${MAX_FIX_TIMEOUT_MS / 1000}s`));
    }, MAX_FIX_TIMEOUT_MS);

    child.on('close', async (code) => {
      clearTimeout(timeout);

      // Clean up prompt file
      try { await unlink(promptFile); } catch { /* ignore */ }

      log('info', 'Claude Code exited', {
        code,
        stdout_length: stdout.length,
        stderr_length: stderr.length,
        stderr_preview: stderr.substring(0, 500),
      });

      if (code !== 0) {
        const errMsg = stderr || stdout || `Claude Code exited with code ${code}`;
        reject(new Error(`Claude Code failed (exit ${code}): ${errMsg.substring(0, 1000)}`));
        return;
      }

      // Try to parse JSON output for summary
      let summary = 'Fix applied.';
      try {
        const output = JSON.parse(stdout);
        if (output.result) {
          summary = output.result;
        }
      } catch {
        if (stdout) {
          summary = stdout.substring(0, 500);
        }
      }

      resolve(summary);
    });

    child.on('error', async (err) => {
      clearTimeout(timeout);
      try { await unlink(promptFile); } catch { /* ignore */ }
      log('error', 'Claude Code spawn error', { error: err.message });
      reject(new Error(`Failed to spawn Claude Code: ${err.message}`));
    });
  });
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
// Bot authentication for admin page screenshots
// ============================================
let cachedBotSession = null;
let botSessionExpiresAt = 0;

async function getBotSession() {
  // Return cached session if still valid (with 5 min buffer)
  if (cachedBotSession && Date.now() < botSessionExpiresAt - 300000) {
    return cachedBotSession;
  }

  if (!BOT_PASSWORD) {
    log('warn', 'BOT_USER_PASSWORD not set - admin page screenshots will show login page');
    return null;
  }

  try {
    // Create a separate client with anon key for auth (service key can't sign in as a user)
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await anonClient.auth.signInWithPassword({
      email: BOT_EMAIL,
      password: BOT_PASSWORD,
    });

    if (error) {
      log('error', 'Bot sign-in failed', { error: error.message });
      return null;
    }

    cachedBotSession = data.session;
    botSessionExpiresAt = data.session.expires_at * 1000; // convert to ms
    log('info', 'Bot session obtained', {
      expires: new Date(botSessionExpiresAt).toISOString(),
    });
    return cachedBotSession;
  } catch (err) {
    log('error', 'Bot auth error', { error: err.message });
    return null;
  }
}

// ============================================
// Verification screenshot via Puppeteer
// ============================================
const DEPLOY_WAIT_MS = parseInt(process.env.DEPLOY_WAIT_MS || '90000'); // 90 seconds for GitHub Pages

async function takeVerificationScreenshot(pageUrl) {
  if (!pageUrl) {
    log('info', 'No page_url - skipping verification screenshot');
    return null;
  }

  // Only screenshot GitHub Pages URLs (our site)
  if (!pageUrl.includes('rsonnad.github.io')) {
    log('info', 'page_url is not our site - skipping verification screenshot', { url: pageUrl });
    return null;
  }

  log('info', `Waiting ${DEPLOY_WAIT_MS / 1000}s for GitHub Pages deploy...`);
  await new Promise(resolve => setTimeout(resolve, DEPLOY_WAIT_MS));

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // For admin pages, inject bot auth session before navigating
    const isAdminPage = pageUrl.includes('/admin/');
    if (isAdminPage) {
      const botSession = await getBotSession();
      if (botSession) {
        // Build session data for Supabase client localStorage ('genalpaca-auth')
        const supabaseStorageValue = {
          access_token: botSession.access_token,
          refresh_token: botSession.refresh_token,
          expires_at: botSession.expires_at,
          expires_in: botSession.expires_in,
          token_type: botSession.token_type || 'bearer',
          user: botSession.user,
        };

        // Build cached auth for shared/auth.js ('genalpaca-cached-auth')
        const cachedAuth = {
          email: botSession.user.email,
          userId: botSession.user.id,
          appUser: { id: 'bot', role: 'admin', display_name: 'Bug Fixer Bot', email: botSession.user.email },
          role: 'admin',
          timestamp: Date.now(),
        };

        // Use evaluateOnNewDocument to inject localStorage BEFORE any page JS runs
        // This is critical - the Supabase client reads session on initialization
        await page.evaluateOnNewDocument((sessionJson, cachedJson) => {
          localStorage.setItem('genalpaca-auth', sessionJson);
          localStorage.setItem('genalpaca-cached-auth', cachedJson);
        }, JSON.stringify(supabaseStorageValue), JSON.stringify(cachedAuth));

        log('info', 'Bot auth session will be injected via evaluateOnNewDocument');
      } else {
        log('warn', 'No bot session available - admin screenshot may show login page');
      }
    }

    // Add cache-busting to force fresh load
    const bustUrl = pageUrl + (pageUrl.includes('?') ? '&' : '?') + `_t=${Date.now()}`;
    log('info', 'Loading page for screenshot', { url: bustUrl });

    await page.goto(bustUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Extra wait for any JS rendering (admin pages may need more time for data loading)
    await new Promise(resolve => setTimeout(resolve, isAdminPage ? 5000 : 3000));

    // Take screenshot
    await mkdir(TEMP_DIR, { recursive: true });
    const screenshotPath = path.join(TEMP_DIR, `verification-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    log('info', 'Verification screenshot taken', { path: screenshotPath });

    // Upload to Supabase Storage
    const fileBuffer = await readFile(screenshotPath);
    const storagePath = `verification-${Date.now()}.png`;

    const { data, error } = await supabase.storage
      .from('bug-screenshots')
      .upload(storagePath, fileBuffer, {
        contentType: 'image/png',
        upsert: false,
      });

    if (error) {
      log('error', 'Failed to upload verification screenshot', { error: error.message });
      await unlink(screenshotPath).catch(() => {});
      return null;
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('bug-screenshots')
      .getPublicUrl(storagePath);

    log('info', 'Verification screenshot uploaded', { url: publicUrl });

    // Clean up local file
    await unlink(screenshotPath).catch(() => {});

    return publicUrl;
  } catch (err) {
    log('error', 'Verification screenshot failed', { error: err.message });
    return null;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// ============================================
// Send notification email
// ============================================
const ADMIN_EMAIL = 'alpacaautomation@gmail.com';

async function sendEmail(type, report, extraData = {}) {
  // Send to both the reporter and admin
  const recipients = [report.reporter_email];
  if (report.reporter_email !== ADMIN_EMAIL) {
    recipients.push(ADMIN_EMAIL);
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type,
        to: recipients,
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

    // 1b. Send confirmation email
    await sendEmail('bug_report_received', report);

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

      // 9. Take verification screenshot and send follow-up email
      const verificationUrl = await takeVerificationScreenshot(report.page_url);
      if (verificationUrl) {
        await supabase
          .from('bug_reports')
          .update({ verification_screenshot_url: verificationUrl })
          .eq('id', report.id);

        await sendEmail('bug_report_verified', report, {
          fix_summary: fixSummary,
          fix_commit_sha: commitSha,
          verification_screenshot_url: verificationUrl,
        });
        log('info', 'Verification screenshot email sent', { id: report.id });
      }

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
    // Extract a clean error message (truncate long Claude output)
    const errorMsg = err.message.substring(0, 2000);
    log('error', 'Bug fix failed', {
      id: report.id,
      error: errorMsg,
      stderr: err.stderr ? err.stderr.substring(0, 500) : undefined,
    });

    // Update report as failed
    await supabase
      .from('bug_reports')
      .update({
        status: 'failed',
        error_message: errorMsg,
        processed_at: new Date().toISOString(),
      })
      .eq('id', report.id);

    // Email reporter about failure
    await sendEmail('bug_report_failed', report, { error_message: errorMsg });

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
let isProcessing = false;

async function pollForReports() {
  if (isProcessing) {
    log('debug', 'Skipping poll - already processing a report');
    return;
  }

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
      isProcessing = true;
      try {
        await processBugReport(reports[0]);
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
    const { stdout: claudePath } = await execAsync('which claude');
    const { stdout: claudeVer } = await execAsync('claude --version 2>/dev/null || echo unknown');
    log('info', 'Claude Code CLI found', {
      path: claudePath.trim(),
      version: claudeVer.trim(),
      home: process.env.HOME,
      user: process.env.USER || process.env.LOGNAME || 'unknown',
    });
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
