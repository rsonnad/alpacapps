import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir, readdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// ============================================
// Configuration
// ============================================
const REPO_DIR = process.env.REPO_DIR || '/opt/instruction-runner/repo';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000');
const MAX_EXEC_TIMEOUT_MS = parseInt(process.env.MAX_EXEC_TIMEOUT_MS || '600000'); // 10 minutes
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const INSTRUCTIONS_DIR = 'instructions';
const REPORTS_DIR = 'dev/test';

// ============================================
// Logging
// ============================================
function log(level, msg, data = {}) {
  const ts = new Date().toISOString();
  const dataStr = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
  console.log(`[${ts}] [${level}] ${msg}${dataStr}`);
}

// ============================================
// Austin time helpers
// ============================================
function getAustinTime() {
  return new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
}

function getVersionDateString() {
  const now = new Date();
  const austin = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const yy = String(austin.getFullYear()).slice(2);
  const mm = String(austin.getMonth() + 1).padStart(2, '0');
  const dd = String(austin.getDate()).padStart(2, '0');
  const hh = String(austin.getHours()).padStart(2, '0');
  const min = String(austin.getMinutes()).padStart(2, '0');
  return `${yy}${mm}${dd}-${hh}${min}`;
}

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
}

// ============================================
// Discord notification
// ============================================
async function notifyDiscord(message) {
  if (!DISCORD_WEBHOOK_URL) {
    log('info', 'Discord webhook not configured, skipping notification');
    return;
  }
  try {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Instruction Runner',
        content: message.substring(0, 2000),
      }),
    });
    if (!res.ok) {
      log('warn', 'Discord notification failed', { status: res.status });
    }
  } catch (err) {
    log('warn', 'Discord notification error', { error: err.message });
  }
}

// ============================================
// Git helpers
// ============================================
async function git(cmd) {
  const { stdout } = await execAsync(`git ${cmd}`, { cwd: REPO_DIR });
  return stdout.trim();
}

async function gitFetchAll() {
  await execAsync('git fetch --all --prune', { cwd: REPO_DIR });
}

async function gitCheckoutMain() {
  await execAsync('git checkout main && git reset --hard origin/main', { cwd: REPO_DIR });
}

// ============================================
// Find new instruction branches
// ============================================
const processedBranches = new Set();

async function findInstructionBranches() {
  await gitFetchAll();

  const branchOutput = await git('branch -r');
  const allBranches = branchOutput.split('\n')
    .map(b => b.trim())
    .filter(b => b.startsWith('origin/claude/'));

  const newBranches = [];
  for (const branch of allBranches) {
    if (processedBranches.has(branch)) continue;

    // Check if this branch has files in instructions/
    try {
      const files = await git(`ls-tree --name-only ${branch} ${INSTRUCTIONS_DIR}/`);
      const instructionFiles = files.split('\n').filter(f => f.endsWith('.md') && !f.includes('/results/'));
      if (instructionFiles.length > 0) {
        newBranches.push({ branch, files: instructionFiles });
      }
    } catch {
      // No instructions/ dir on this branch — skip silently
    }
  }

  return newBranches;
}

// ============================================
// Read instruction content from a branch
// ============================================
async function readInstruction(branch, filePath) {
  return await git(`show ${branch}:${filePath}`);
}

// ============================================
// Build the system prompt for Claude Code
// ============================================
function buildPrompt(instruction) {
  return `You are an autonomous developer working on the AlpacApps codebase.
This is a property management web app deployed to GitHub Pages (static HTML/JS/CSS, no build step).
Backend is Supabase. Read CLAUDE.md for full project context.

You have been given an instruction from the project owner via their phone.
Execute it fully and autonomously. Do NOT ask clarifying questions — make reasonable decisions.

=== INSTRUCTION ===
${instruction}
=== END INSTRUCTION ===

=== AUTONOMOUS WORK RULES ===
1. Read CLAUDE.md first to understand project conventions, file structure, and patterns.
2. Explore the codebase to understand existing code before making changes.
3. Make the changes requested in the instruction.
4. After making changes, verify your work:
   - Re-read modified files to confirm they look correct
   - Check for syntax errors (missing brackets, unclosed strings, etc.)
   - Verify imports reference files that actually exist
   - If you created HTML pages, verify they follow the existing page template pattern
5. If you encounter errors or ambiguity, make your best judgment call and note it in your response.
6. Do NOT run git commands — the runner handles all git operations.
7. Do NOT modify the version string — CI handles that.
8. Do NOT run npm install or any package manager commands.

=== RESPONSE FORMAT ===
When done, provide a clear summary of:
- What you did
- Files created or modified
- Any decisions you made where the instruction was ambiguous
- Any potential issues or things to test manually`;
}

// ============================================
// Run Claude Code with the instruction
// ============================================
async function runClaudeCode(instruction) {
  const prompt = buildPrompt(instruction);

  const args = [
    '-p', prompt,
    '--allowedTools', 'Write,Edit,Read,Glob,Grep,Bash',
    '--max-turns', '30',
    '--output-format', 'json',
    '--dangerously-skip-permissions',
  ];

  log('info', 'Running Claude Code', { prompt_length: prompt.length });

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: REPO_DIR,
      env: {
        ...process.env,
        CI: 'true',
        HOME: process.env.HOME || '/home/bugfixer',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: MAX_EXEC_TIMEOUT_MS,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
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
      reject(new Error(`Claude Code timed out after ${MAX_EXEC_TIMEOUT_MS / 1000}s`));
    }, MAX_EXEC_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timeout);
      log('info', 'Claude Code exited', { code, stdout_length: stdout.length });

      let resultText = '';
      let costUsd = null;
      let numTurns = null;
      try {
        const output = JSON.parse(stdout);
        resultText = output.result || output.summary || stdout.substring(0, 10000);
        if (typeof resultText !== 'string') resultText = JSON.stringify(resultText, null, 2);
        costUsd = output.total_cost_usd || null;
        numTurns = output.num_turns || null;
      } catch {
        resultText = stdout.substring(0, 10000) || `Exit code: ${code}`;
      }

      resolve({ exitCode: code, result: resultText, cost: costUsd, turns: numTurns, stderr });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn Claude Code: ${err.message}`));
    });
  });
}

// ============================================
// Generate HTML report
// ============================================
function generateHtmlReport({ instruction, result, branch, taskName, filesChanged, startTime, endTime }) {
  const duration = Math.round((endTime - startTime) / 1000);
  const status = result.exitCode === 0 ? 'SUCCESS' : 'FAILED';
  const statusColor = result.exitCode === 0 ? '#4caf50' : '#f44336';
  const austinTime = new Date(endTime).toLocaleString('en-US', { timeZone: 'America/Chicago' });

  // Escape HTML in result text
  const escapeHtml = (str) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AutoDev Report: ${escapeHtml(taskName)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'SF Mono', 'Fira Code', monospace; background: #1a1a2e; color: #e0e0e0; padding: 2rem; line-height: 1.6; }
    .header { border-bottom: 2px solid #333; padding-bottom: 1rem; margin-bottom: 2rem; }
    .header h1 { font-size: 1.4rem; color: #d4883a; }
    .header .meta { font-size: 0.85rem; color: #888; margin-top: 0.5rem; }
    .status { display: inline-block; padding: 0.2rem 0.8rem; border-radius: 4px; font-weight: 700; font-size: 0.85rem; background: ${statusColor}22; color: ${statusColor}; border: 1px solid ${statusColor}; }
    .section { margin-bottom: 2rem; }
    .section h2 { font-size: 1.1rem; color: #d4883a; margin-bottom: 0.5rem; border-bottom: 1px solid #333; padding-bottom: 0.3rem; }
    .instruction { background: #16213e; border: 1px solid #0f3460; border-radius: 8px; padding: 1rem; white-space: pre-wrap; }
    .result { background: #1a1a2e; border: 1px solid #333; border-radius: 8px; padding: 1rem; white-space: pre-wrap; overflow-x: auto; max-height: 600px; overflow-y: auto; }
    .files { list-style: none; }
    .files li { padding: 0.3rem 0; font-size: 0.9rem; }
    .files li::before { content: ''; margin-right: 0.5rem; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; }
    .stat { background: #16213e; border-radius: 8px; padding: 1rem; text-align: center; }
    .stat .value { font-size: 1.5rem; font-weight: 700; color: #d4883a; }
    .stat .label { font-size: 0.75rem; color: #888; margin-top: 0.3rem; }
  </style>
</head>
<body>
  <div class="header">
    <h1>AutoDev Report</h1>
    <div class="meta">
      <span class="status">${status}</span>
      &nbsp; ${escapeHtml(austinTime)} &nbsp; | &nbsp; Branch: ${escapeHtml(branch)}
    </div>
  </div>

  <div class="section">
    <div class="stats">
      <div class="stat"><div class="value">${duration}s</div><div class="label">Duration</div></div>
      <div class="stat"><div class="value">${result.turns || '?'}</div><div class="label">Turns</div></div>
      <div class="stat"><div class="value">$${result.cost ? result.cost.toFixed(3) : '?'}</div><div class="label">Cost</div></div>
      <div class="stat"><div class="value">${filesChanged.length}</div><div class="label">Files Changed</div></div>
    </div>
  </div>

  <div class="section">
    <h2>Instruction</h2>
    <div class="instruction">${escapeHtml(instruction)}</div>
  </div>

  ${filesChanged.length > 0 ? `<div class="section">
    <h2>Files Changed</h2>
    <ul class="files">${filesChanged.map(f => `<li>${escapeHtml(f)}</li>`).join('\n')}</ul>
  </div>` : ''}

  <div class="section">
    <h2>Claude Code Output</h2>
    <div class="result">${escapeHtml(result.result)}</div>
  </div>
</body>
</html>`;
}

// ============================================
// Process a single instruction branch
// ============================================
async function processInstructionBranch({ branch, files }) {
  const startTime = Date.now();
  const instructionFile = files[0];
  const taskSlug = slugify(path.basename(instructionFile, '.md'));
  const reportName = `${getVersionDateString()}-${taskSlug}.html`;

  log('info', '=== Processing instruction branch ===', { branch, files });
  await notifyDiscord(`**Instruction received** from \`${branch}\`\nFile: \`${instructionFile}\`\nProcessing now...`);

  try {
    // 1. Start from clean main
    await gitCheckoutMain();

    // 2. Read the instruction
    const instruction = await readInstruction(branch, instructionFile);
    log('info', 'Instruction content', { file: instructionFile, length: instruction.length, preview: instruction.substring(0, 200) });

    await notifyDiscord(`**Task:** ${instruction.substring(0, 300)}\nRunning Claude Code...`);

    // 3. Run Claude Code on main
    const result = await runClaudeCode(instruction);
    const endTime = Date.now();
    log('info', 'Claude Code result', { exitCode: result.exitCode, cost: result.cost, turns: result.turns });

    // 4. Get list of changed files
    const statusOutput = await git('status --porcelain');
    const filesChanged = statusOutput.split('\n').filter(Boolean).map(l => l.trim().replace(/^..\s+/, ''));
    const hasChanges = filesChanged.length > 0;

    // 5. Generate HTML report
    const reportHtml = generateHtmlReport({
      instruction, result, branch, taskName: taskSlug, filesChanged, startTime, endTime,
    });
    const reportsDir = path.join(REPO_DIR, REPORTS_DIR);
    await mkdir(reportsDir, { recursive: true });
    await writeFile(path.join(reportsDir, reportName), reportHtml);

    // 6. Commit and push
    if (hasChanges) {
      const resultBranch = `instruction-result/${getVersionDateString()}-${taskSlug}`;
      await execAsync(`git checkout -b ${resultBranch}`, { cwd: REPO_DIR });
      await execAsync('git add -A', { cwd: REPO_DIR });
      const commitMsg = `autodev: ${instruction.substring(0, 60).replace(/\n/g, ' ')}\n\nFrom: ${branch}\nReport: ${REPORTS_DIR}/${reportName}\nCo-Authored-By: Claude Code <noreply@anthropic.com>`;
      await execAsync(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd: REPO_DIR });
      await execAsync(`git push origin ${resultBranch}`, { cwd: REPO_DIR });

      // Merge to main
      await execAsync('git checkout main', { cwd: REPO_DIR });
      await execAsync('git pull origin main', { cwd: REPO_DIR });
      await execAsync(`git merge ${resultBranch} --no-ff -m "Merge ${resultBranch}"`, { cwd: REPO_DIR });
      await execAsync('git push origin main', { cwd: REPO_DIR });

      const duration = Math.round((endTime - startTime) / 1000);
      const reportUrl = `https://alpacaplayhouse.com/${REPORTS_DIR}/${reportName}`;
      await notifyDiscord(
        `**Task completed** (${duration}s, ${result.turns || '?'} turns, $${result.cost ? result.cost.toFixed(3) : '?'})\n` +
        `Files changed: ${filesChanged.join(', ')}\n` +
        `Report: ${reportUrl}\n` +
        `Result: ${result.result.substring(0, 500)}`
      );

      log('info', '=== Instruction executed and merged to main ===', { branch, report: reportName });
    } else {
      // No code changes — just commit the report
      await execAsync('git add -A', { cwd: REPO_DIR });
      await execAsync(`git commit -m "autodev report: ${taskSlug} (no code changes)"`, { cwd: REPO_DIR });
      await execAsync('git push origin main', { cwd: REPO_DIR });

      const duration = Math.round((endTime - startTime) / 1000);
      const reportUrl = `https://alpacaplayhouse.com/${REPORTS_DIR}/${reportName}`;
      await notifyDiscord(
        `**Task processed** (${duration}s, no code changes)\n` +
        `Report: ${reportUrl}\n` +
        `Result: ${result.result.substring(0, 500)}`
      );

      log('info', '=== Instruction processed (no code changes) ===', { branch, report: reportName });
    }

    // 7. Clean up instruction branch
    const remoteBranch = branch.replace('origin/', '');
    try {
      await execAsync(`git push origin --delete ${remoteBranch}`, { cwd: REPO_DIR });
      log('info', 'Deleted instruction branch', { branch: remoteBranch });
    } catch (err) {
      log('warn', 'Could not delete instruction branch', { branch: remoteBranch, error: err.message });
    }

    processedBranches.add(branch);

  } catch (err) {
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);
    log('error', 'Instruction processing failed', { branch, error: err.message });
    processedBranches.add(branch);

    await notifyDiscord(
      `**Task FAILED** (${duration}s)\n` +
      `Branch: \`${branch}\`\n` +
      `Error: ${err.message.substring(0, 500)}`
    );

    // Write error report
    try {
      await gitCheckoutMain();
      const reportsDir = path.join(REPO_DIR, REPORTS_DIR);
      await mkdir(reportsDir, { recursive: true });
      const errorReport = generateHtmlReport({
        instruction: '(could not read instruction)',
        result: { exitCode: 1, result: err.message, cost: null, turns: null },
        branch, taskName: taskSlug, filesChanged: [], startTime, endTime,
      });
      await writeFile(path.join(reportsDir, reportName), errorReport);
      await execAsync('git add -A', { cwd: REPO_DIR });
      await execAsync(`git commit -m "autodev error report: ${taskSlug}"`, { cwd: REPO_DIR });
      await execAsync('git push origin main', { cwd: REPO_DIR });
    } catch { /* best effort */ }
  }

  // Always return to main
  try { await gitCheckoutMain(); } catch { /* ignore */ }
}

// ============================================
// Main poll loop
// ============================================
let isProcessing = false;

async function poll() {
  if (isProcessing) return;

  try {
    const branches = await findInstructionBranches();

    if (branches.length > 0) {
      log('info', `Found ${branches.length} instruction branch(es)`, {
        branches: branches.map(b => b.branch),
      });

      isProcessing = true;
      try {
        for (const entry of branches) {
          await processInstructionBranch(entry);
        }
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
  log('info', 'Instruction Runner starting', {
    repo: REPO_DIR,
    poll_interval: POLL_INTERVAL_MS,
    max_timeout: MAX_EXEC_TIMEOUT_MS,
    discord: DISCORD_WEBHOOK_URL ? 'configured' : 'not configured',
  });

  if (!existsSync(REPO_DIR)) {
    log('error', `Repo directory does not exist: ${REPO_DIR}`);
    process.exit(1);
  }

  // Verify Claude Code is installed
  try {
    const { stdout: ver } = await execAsync('claude --version 2>/dev/null || echo unknown');
    log('info', 'Claude Code CLI found', { version: ver.trim() });
  } catch {
    log('error', 'Claude Code CLI not found');
    process.exit(1);
  }

  await gitCheckoutMain();
  await notifyDiscord('**Instruction Runner started** — watching for `instructions/*.md` on `claude/*` branches');

  log('info', `Polling every ${POLL_INTERVAL_MS / 1000}s for instruction branches...`);
  setInterval(poll, POLL_INTERVAL_MS);
  await poll();
}

main().catch(err => {
  log('error', 'Fatal error', { error: err.message });
  process.exit(1);
});
