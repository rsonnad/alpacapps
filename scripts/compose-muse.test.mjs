import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { choose, loadSources } from './compose-muse.mjs';

const R = 'rsonnad/muse-rahulio';
const S = 'rsonnad/muse-sonia';
const claimed = new Map([['warsawapt', R], ['soniabikes', S]]);

test('each repo publishes its own claimed projects', () => {
  assert.deepEqual(choose({ [R]: ['warsawapt'], [S]: ['soniabikes'] }, claimed), { warsawapt: R, soniabikes: S });
});

test('a repo cannot publish a project claimed by another repo', () => {
  assert.deepEqual(choose({ [R]: ['warsawapt', 'soniabikes'], [S]: ['soniabikes'] }, claimed), { warsawapt: R, soniabikes: S });
  assert.deepEqual(choose({ [R]: ['soniabikes'], [S]: [] }, claimed), {});
});

test('unclaimed projects publish only when exactly one repo has them', () => {
  assert.deepEqual(choose({ [R]: ['newpage'], [S]: [] }, claimed), { newpage: R });
  assert.deepEqual(choose({ [R]: ['clash'], [S]: ['clash'] }, claimed), {});
});

test('unsafe project names are never published', () => {
  for (const bad of ['..', '.git', 'Upper', 'a b', '-x', '_x', 'a/b']) {
    assert.deepEqual(choose({ [R]: [bad] }, claimed), {}, bad);
  }
});

test('muse-sources.json is valid and gives every project one owner', () => {
  const { sources, claimed: c } = loadSources();
  assert.ok(sources.length >= 2);
  assert.ok(c.size >= 1);
});

test('a project listed for two repos is rejected', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'muse-src-'));
  const file = path.join(dir, 'muse-sources.json');
  writeFileSync(file, JSON.stringify({ sources: [{ repo: R, projects: ['x'] }, { repo: S, projects: ['x'] }] }));
  assert.throws(() => loadSources('muse', file), /two repos/);
});

test('bots-sources.json is valid and gives Grokbot its own projects', () => {
  const { sources, claimed: c } = loadSources('bots');
  assert.ok(sources.some(s => s.repo === 'rsonnad/grokbot-pages'));
  assert.equal(c.get('hello'), 'rsonnad/grokbot-pages');
});

test('botsy-sources.json is valid and gives Grokbot its own projects', () => {
  const { sources, claimed: c } = loadSources('botsy');
  assert.ok(sources.some(s => s.repo === 'rsonnad/grokbot-pages'));
  assert.equal(c.get('hello'), 'rsonnad/grokbot-pages');
});

test('the bots area applies the same name and ownership rules', () => {
  const G = 'rsonnad/grokbot-pages';
  const bots = new Map([['hello', G]]);
  assert.deepEqual(choose({ [G]: ['hello', 'newbot'] }, bots, 'bots'), { hello: G, newbot: G });
  assert.deepEqual(choose({ [R]: ['hello'] }, bots, 'bots'), {});
  assert.deepEqual(choose({ [G]: ['..', 'Upper'] }, bots, 'bots'), {});
});

test('a project committed to alpacapps itself is never replaced by an agent repo', () => {
  const G = 'rsonnad/grokbot-pages';
  const reserved = new Set(['feedback']);
  assert.deepEqual(choose({ [G]: ['feedback', 'hello'] }, new Map([['feedback', G]]), 'bots', reserved), { hello: G });
});
