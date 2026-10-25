import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildStandalone } from '../scripts/bundle.mjs';

test('every browser control referenced by the app exists exactly once in the document', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../dist/app.mjs', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of app.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(id), `Missing control: ${id}`);
});

test('standalone demo is deterministic and has no runtime asset or module imports', () => {
  const html = buildStandalone();
  assert.equal(html, buildStandalone());
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/);
  assert.doesNotMatch(html, /^import .+ from /m);
  assert.ok(html.includes('export function runScenario('));
  assert.ok(html.includes('run();\nrenderSuite();'));
  assert.ok(html.includes('not a benchmark of any LLM'));
});
