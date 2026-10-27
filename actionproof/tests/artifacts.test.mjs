import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildStandalone, buildStatic } from '../scripts/bundle.mjs';

test('every browser control referenced by the app exists exactly once in the document', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../dist/app.mjs', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of app.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(id), `Missing control: ${id}`);
});

test('evidence embedding cannot terminate its JSON script element', () => {
  const directory = mkdtempSync(join(tmpdir(), 'actionproof-build-'));
  try {
    mkdirSync(join(directory, 'dist'));
    writeFileSync(join(directory, 'dist/index.html'), '<script id="adapter-evidence" type="application/json">null</script>');
    const report = { name: '</script><script>untrusted()</script>' };
    writeFileSync(join(directory, 'dist/adapter-evidence.json'), JSON.stringify(report));
    const html = buildStatic(pathToFileURL(directory + '/'));
    assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
    assert.deepEqual(JSON.parse(html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>'))), report);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('missing evidence clears stale embedded claims', () => {
  const directory = mkdtempSync(join(tmpdir(), 'actionproof-build-'));
  try {
    mkdirSync(join(directory, 'dist'));
    writeFileSync(join(directory, 'dist/index.html'), '<script id="adapter-evidence" type="application/json">{"claim":"stale"}</script>');
    const html = buildStatic(pathToFileURL(directory + '/'));
    assert.ok(html.endsWith('>null</script>'));
    assert.doesNotMatch(html, /stale/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
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
