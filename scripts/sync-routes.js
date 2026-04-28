#!/usr/bin/env node
/**
 * sync-routes.js — Keep /shared/routes.js (frontend) and
 * /supabase/functions/_shared/routes.ts (edge functions) in sync.
 *
 * routes.js is the source of truth. routes.ts is regenerated from it by
 * stripping each file's header comment, copying the body, and adding a
 * single TypeScript type annotation to absoluteUrl().
 *
 * Usage:
 *   node scripts/sync-routes.js          # regenerate routes.ts
 *   node scripts/sync-routes.js --check  # exit 1 if regen would change routes.ts
 *
 * CI runs --check on every push (see .github/workflows/bump-version-on-push.yml).
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(REPO_ROOT, 'shared', 'routes.js');
const MIRROR = path.join(REPO_ROOT, 'supabase', 'functions', '_shared', 'routes.ts');

const TS_HEADER = `/**
 * routes.ts — AUTO-GENERATED MIRROR of /shared/routes.js. DO NOT EDIT BY HAND.
 *
 * Edit /shared/routes.js (the source of truth), then run:
 *   node scripts/sync-routes.js
 *
 * CI runs \`node scripts/sync-routes.js --check\` and fails if drift is detected.
 *
 * Edge functions run on Deno and cannot import frontend ESM modules from
 * /shared/, so we maintain this mirror. The body below is byte-identical to
 * the source after stripping each file's header comment block.
 */

`;

// Extract everything after the leading JSDoc header comment.
function stripHeader(src) {
  const m = src.match(/^\/\*\*[\s\S]*?\*\/\s*\n/);
  if (!m) throw new Error('Source file does not start with a /** ... */ header');
  return src.slice(m[0].length);
}

// Add the TypeScript type annotation to absoluteUrl. The body is otherwise
// valid TS as-is.
function jsBodyToTs(body) {
  return body.replace(
    /export function absoluteUrl\(route\)\s*{/,
    'export function absoluteUrl(route: string): string {'
  );
}

function generateMirror() {
  const sourceSrc = fs.readFileSync(SOURCE, 'utf8');
  const body = stripHeader(sourceSrc);
  const tsBody = jsBodyToTs(body);
  return TS_HEADER + tsBody;
}

function main() {
  const checkMode = process.argv.includes('--check');
  const generated = generateMirror();

  if (checkMode) {
    if (!fs.existsSync(MIRROR)) {
      console.error(`✗ Mirror does not exist: ${MIRROR}`);
      console.error('  Run: node scripts/sync-routes.js');
      process.exit(1);
    }
    const current = fs.readFileSync(MIRROR, 'utf8');
    if (current !== generated) {
      console.error('✗ routes.ts is out of sync with routes.js.');
      console.error('  Run: node scripts/sync-routes.js');
      process.exit(1);
    }
    console.log('✓ routes.ts is in sync with routes.js');
    return;
  }

  fs.writeFileSync(MIRROR, generated);
  console.log(`✓ Wrote ${path.relative(REPO_ROOT, MIRROR)}`);
}

main();
