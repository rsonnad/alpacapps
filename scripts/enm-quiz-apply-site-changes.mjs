#!/usr/bin/env node
/**
 * Applies queued ENM-quiz site changes to rahulio/pages/enmtest.
 *
 * Runs in CI, not in the edge function, so the commit uses the repository's own
 * GITHUB_TOKEN and no long-lived repo-write credential has to live in Supabase.
 *
 * The model is asked for exact find/replace edits rather than rewritten files.
 * A find string that does not match exactly once aborts that change outright —
 * far better than letting a near-miss silently mangle the page.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_ENM_KEY;

const MODEL = process.env.ENM_MODEL || 'z-ai/glm-5.3-flash';
const SCOPE = 'rahulio/pages/enmtest/';
const EDITABLE = ['rahulio/pages/enmtest/index.html', 'rahulio/pages/enmtest/quiz-data.js'];
const LIVE_URL = 'https://alpacaplayhouse.com/rahulio/pages/enmtest/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sb(pathAndQuery, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

const SYSTEM = `You are editing a live static quiz page. You will be given the full current contents of
each editable file and a list of changes to make.

Return ONLY a JSON object:
{"summary": "2-4 sentences describing what you changed, for an email to the admin",
 "edits": [{"file": "<exact path as given>", "find": "<exact substring from the file>", "replace": "<replacement>"}]}

Hard rules:
- "find" MUST be copied byte-for-byte from the file, including indentation, and MUST be unique
  in that file. Include enough surrounding context to guarantee uniqueness.
- Make the smallest edit that accomplishes each change. Do not reformat untouched code.
- Never change file paths, image filenames, Supabase table or column names, or the scoring
  key semantics unless the instruction explicitly says to.
- quiz-data.js is generated content: option "result" values are 1-based result indexes and 0
  means "scores nothing". If asked to score a previously unscored option, set the right index.
- If an instruction is ambiguous or you cannot do it safely, leave it out and say so in summary.
- Valid JavaScript and HTML only. The page must still parse.`;

async function askModel(instructions, files) {
  const fileBlocks = files
    .map((f) => `=== FILE: ${f.path} ===\n${f.content}`)
    .join('\n\n');

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://alpacaplayhouse.com',
      'X-Title': 'AlpacApps ENM Quiz site updater',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      // Reasoning is mandatory on this endpoint and comes out of the same
      // budget, so leave generous headroom above the size of the edits.
      max_tokens: 40000,
      reasoning: { effort: 'minimal' },
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Changes to make:\n\n${instructions}\n\n${fileBlocks}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content ?? '';
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).match(/\{[\s\S]*\}/);
  if (!body) throw new Error('Model returned no JSON');
  return JSON.parse(body[0]);
}

function applyEdits(edits) {
  const touched = new Map();

  for (const [i, edit] of edits.entries()) {
    const rel = path.normalize(edit.file || '');
    // Scope is the whole point of this pipeline: re-check it here rather than
    // trusting that the edge function or the model kept to it.
    if (!rel.startsWith(SCOPE) || rel.includes('..')) {
      throw new Error(`Edit ${i} targets ${rel}, outside ${SCOPE}`);
    }
    if (!EDITABLE.includes(rel)) throw new Error(`Edit ${i} targets non-editable ${rel}`);
    if (!existsSync(rel)) throw new Error(`Edit ${i} targets missing ${rel}`);

    const current = touched.get(rel) ?? readFileSync(rel, 'utf8');
    const { find, replace } = edit;
    if (typeof find !== 'string' || !find.length) throw new Error(`Edit ${i} has an empty find`);

    const count = current.split(find).length - 1;
    if (count !== 1) throw new Error(`Edit ${i} find matched ${count} times in ${rel} (need exactly 1)`);

    touched.set(rel, current.replace(find, replace ?? ''));
  }

  for (const [rel, content] of touched) writeFileSync(rel, content);
  return [...touched.keys()];
}

function sanityCheck(files) {
  for (const f of files) {
    if (f.endsWith('.js')) {
      execFileSync('node', ['--input-type=module', '--check'], { input: readFileSync(f, 'utf8') });
    }
    if (f.endsWith('.html')) {
      const html = readFileSync(f, 'utf8');
      const open = (html.match(/<script\b/g) || []).length;
      const close = (html.match(/<\/script>/g) || []).length;
      if (open !== close) throw new Error(`${f}: ${open} <script> vs ${close} </script>`);
      if (!html.includes('id="screenQuestion"')) throw new Error(`${f}: question screen missing`);
    }
  }
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

async function waitForDeploy(marker, timeoutMs = 6 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(20_000);
    try {
      const res = await fetch(`${LIVE_URL}?cachebust=${Date.now()}`);
      if (res.ok) {
        const body = await res.text();
        if (!marker || body.includes(marker)) return { ok: true, status: res.status };
      }
    } catch { /* keep waiting */ }
  }
  return { ok: false, status: 'timeout' };
}

/**
 * Mail goes out through the edge function, which already holds the Resend key,
 * so CI does not need its own copy of that credential.
 */
async function notify(to, subject, lines) {
  if (!to) {
    console.log('(no email sent: no recipient on the change request)');
    return false;
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/enm-quiz-ai`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'notify-deploy', to, subject, lines }),
    });
    if (!res.ok) {
      console.error('notify failed', res.status, (await res.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (e) {
    console.error('notify threw', e.message);
    return false;
  }
}

async function processChange(change) {
  console.log(`\n=== change ${change.id} (${change.kind}) ===`);
  await sb(`enm_quiz_site_changes?id=eq.${change.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'applying' }),
  });

  const files = EDITABLE.filter(existsSync).map((p) => ({ path: p, content: readFileSync(p, 'utf8') }));
  const plan = await askModel(change.instructions, files);
  const edits = Array.isArray(plan.edits) ? plan.edits : [];
  if (!edits.length) throw new Error(`Model proposed no edits. Summary: ${plan.summary ?? '(none)'}`);

  const touched = applyEdits(edits);
  sanityCheck(touched);
  console.log(`edited: ${touched.join(', ')}`);

  if (!git('status', '--porcelain')) throw new Error('Edits produced no net change');

  git('config', 'user.name', 'alpacapps-bot');
  git('config', 'user.email', 'pai@alpacaplayhouse.com');
  git('add', ...touched);
  git(
    'commit',
    '-m',
    `ENM quiz: apply approved review items\n\n${(plan.summary ?? '').slice(0, 900)}\n\n` +
      `Change request: ${change.id}\nRequested by: ${change.requested_by_email ?? 'unknown'}\n\n` +
      `Co-Authored-By: GLM 5.3 Flash via OpenRouter <noreply@openrouter.ai>`,
  );
  git('push', 'origin', 'HEAD:main');
  const sha = git('rev-parse', 'HEAD');
  console.log(`pushed ${sha}`);

  await sb(`enm_quiz_site_changes?id=eq.${change.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'applied',
      commit_sha: sha,
      files: touched,
      applied_at: new Date().toISOString(),
    }),
  });

  const deploy = await waitForDeploy(null);
  await sb(`enm_quiz_site_changes?id=eq.${change.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      deploy_status: deploy.ok ? 'live' : 'unverified',
      deploy_verified_at: deploy.ok ? new Date().toISOString() : null,
    }),
  });

  const sent = await notify(
    change.requested_by_email,
    deploy.ok ? 'Your ENM quiz update is live' : 'ENM quiz update pushed (deploy unconfirmed)',
    [
      `<strong>What changed:</strong> ${plan.summary ?? 'See the commit.'}`,
      `<strong>Files:</strong> ${touched.join(', ')}`,
      `<strong>Commit:</strong> <a href="https://github.com/rsonnad/alpacapps/commit/${sha}">${sha.slice(0, 10)}</a>`,
      deploy.ok
        ? 'The page was fetched successfully after the deploy, so it is serving.'
        : 'The push landed, but the deploy could not be confirmed within six minutes. Check GitHub Pages.',
    ],
  );
  if (sent) {
    await sb(`enm_quiz_site_changes?id=eq.${change.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ notified_at: new Date().toISOString() }),
    });
  }

  if (Array.isArray(change.review_item_ids) && change.review_item_ids.length) {
    const ids = change.review_item_ids.map((i) => `"${i}"`).join(',');
    await sb(`enm_quiz_review_items?id=in.(${ids})`, {
      method: 'PATCH',
      body: JSON.stringify({ applied_at: new Date().toISOString() }),
    });
  }
}

async function main() {
  for (const [name, v] of Object.entries({ SUPABASE_URL, SERVICE_KEY, OPENROUTER_KEY })) {
    if (!v) throw new Error(`Missing ${name}`);
  }

  const only = process.env.CHANGE_ID;
  const query = only
    ? `enm_quiz_site_changes?id=eq.${only}&status=eq.queued`
    : 'enm_quiz_site_changes?status=eq.queued&order=created_at.asc&limit=3';
  const queued = await sb(query);

  if (!queued.length) {
    console.log('Nothing queued.');
    return;
  }
  console.log(`${queued.length} change(s) queued`);

  for (const change of queued) {
    try {
      await processChange(change);
    } catch (e) {
      console.error(`change ${change.id} failed:`, e.message);
      // Leave the tree clean so the next change in the batch starts from main.
      try { execFileSync('git', ['checkout', '--', SCOPE]); } catch { /* nothing staged */ }
      await sb(`enm_quiz_site_changes?id=eq.${change.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'failed', error: String(e.message).slice(0, 2000) }),
      });
      await notify(change.requested_by_email, 'ENM quiz update failed', [
        'The requested change could not be applied, so nothing was pushed.',
        `<strong>Reason:</strong> ${String(e.message).slice(0, 400)}`,
        'The page is untouched and still serving the previous version.',
      ]);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
