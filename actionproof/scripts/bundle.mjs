import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Build a self-contained, offline-openable demo from the actual shared engine. */
export function buildStatic(root = new URL('../', import.meta.url)) {
  const html = readFileSync(new URL('dist/index.html', root), 'utf8');
  const evidencePath = new URL('dist/adapter-evidence.json', root);
  const report = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, 'utf8')) : null;
  // Escape '<' so evidence text can never terminate its JSON script element.
  const encoded = JSON.stringify(report).replace(/</g, '\\u003c');
  return html.replace(/<script id="adapter-evidence" type="application\/json">[\s\S]*?<\/script>/,
    () => `<script id="adapter-evidence" type="application/json">${encoded}</script>`);
}

export function buildStandalone(root = new URL('../', import.meta.url)) {
  const html = buildStatic(root);
  const css = readFileSync(new URL('dist/styles.css', root), 'utf8');
  const engine = readFileSync(new URL('dist/engine.mjs', root), 'utf8');
  const app = readFileSync(new URL('dist/app.mjs', root), 'utf8').replace(/^import[^\n]+from '\.\/engine\.mjs';\n/, '');
  const script = `${engine}\n${app}`.replace(/<\/script/gi, '<\\/script');
  return html
    .replace('<link rel="stylesheet" href="styles.css">', () => `<style>${css}</style>`)
    .replace('<script type="module" src="app.mjs"></script>', () => `<script type="module">${script}</script>`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  writeFileSync(new URL('../dist/index.html', import.meta.url), buildStatic());
  writeFileSync(new URL('../actionproof-demo.html', import.meta.url), buildStandalone());
  console.log('Built actionproof-demo.html. Open it directly in a modern browser; no server or network is needed.');
}
