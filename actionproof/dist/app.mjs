import { SCENARIOS, STRATEGIES, runScenario, runSuite, summarize, VERSION } from './engine.mjs';

const $ = (id) => document.getElementById(id);
let current;
let suite;
let timer;
let adapterReport;
const titleCase = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const kind = (run) => !run.safe ? 'unsafe' : run.completed ? 'complete' : run.outcome;
const label = (run) => !run.safe ? 'Unsafe' : run.completed ? 'Completed' : run.outcome === 'failed' ? 'Rejected safely' : 'Unknown';

function option(parent, value, text) {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = text;
  parent.append(element);
}
for (const scenario of SCENARIOS) option($('scenario'), scenario.id, scenario.name);
for (const strategy of STRATEGIES) option($('strategy'), strategy.id, strategy.name);
$('scenario').value = 'lost-ack';

function stopPlayback() {
  clearInterval(timer);
  timer = undefined;
  $('play').textContent = 'Play trace';
}

function renderTrace() {
  const step = Number($('step').value);
  $('step-label').textContent = `${step}/${current.events.length}`;
  $('back').disabled = step <= 1;
  $('next').disabled = step >= current.events.length;
  const fragment = document.createDocumentFragment();
  for (const [index, event] of current.events.slice(0, step).entries()) {
    const row = document.createElement('li');
    if (event.actor === 'fault') row.classList.add('is-fault');
    if (event.type === 'effect.committed') row.classList.add('is-commit');
    if (index === step - 1) row.classList.add('is-last');
    const time = document.createElement('time'); time.textContent = `t${event.tick}`;
    const actor = document.createElement('span'); actor.className = `actor ${event.actor}`; actor.textContent = event.actor;
    const text = document.createElement('span'); text.className = 'event-text'; text.textContent = event.message;
    if (Object.keys(event.data).length) {
      const data = document.createElement('small'); data.className = 'event-data'; data.textContent = JSON.stringify(event.data); text.append(data);
    }
    row.append(time, actor, text);
    fragment.append(row);
  }
  $('trace').replaceChildren(fragment);
  $('trace').scrollTop = $('trace').scrollHeight;
}

function run() {
  stopPlayback();
  const scenario = SCENARIOS.find((item) => item.id === $('scenario').value);
  const strategy = STRATEGIES.find((item) => item.id === $('strategy').value);
  current = runScenario(scenario.id, strategy.id, { budget: Number($('budget').value) });
  $('scenario-description').textContent = scenario.description;
  $('strategy-description').textContent = strategy.description;
  $('run-title').textContent = `${scenario.name} / ${strategy.short}`;
  $('verdict').className = `verdict ${kind(current)}`;
  $('verdict').textContent = label(current).toUpperCase();
  $('outcome').textContent = titleCase(current.outcome);
  $('effects').textContent = current.effects.length;
  $('effects').className = current.effects.length > 1 ? 'danger' : '';
  $('attempts').textContent = current.attempts;
  $('safety').textContent = current.safe ? 'Held' : 'Violated';
  $('safety').className = current.safe ? 'healthy' : 'danger';
  $('reason').textContent = current.reason + (current.violations.length ? ` Detected: ${current.violations.join(', ')}.` : '');
  $('step').max = current.events.length;
  $('step').value = current.events.length;
  renderTrace();
}

function exportJSON(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderSuite() {
  suite = runSuite({ budget: Number($('budget').value) });
  const cards = document.createDocumentFragment();
  for (const row of summarize(suite)) {
    const card = document.createElement('article'); card.className = 'summary';
    const top = document.createElement('div'); top.className = 'summary-top';
    const heading = document.createElement('h3'); heading.textContent = STRATEGIES.find((item) => item.id === row.strategy).name;
    const count = document.createElement('span'); count.className = 'status-label'; count.textContent = `${row.runs} SCENARIOS`;
    top.append(heading, count);
    const stats = document.createElement('div'); stats.className = 'summary-stats';
    for (const [value, text, danger] of [[row.completed, 'completed', false], [row.unsafe, 'unsafe', row.unsafe > 0], [row.unknown, 'unknown', false]]) {
      const stat = document.createElement('div'); const number = document.createElement('strong'); number.textContent = `${value}/8`; if (danger) number.className = 'bad-stat';
      const caption = document.createElement('small'); caption.textContent = text; stat.append(number, caption); stats.append(stat);
    }
    card.append(top, stats); cards.append(card);
  }
  $('summaries').replaceChildren(cards);
  const rows = document.createDocumentFragment();
  for (const scenario of SCENARIOS) {
    const row = document.createElement('tr');
    const name = document.createElement('td'); name.textContent = scenario.name;
    const caption = document.createElement('span'); caption.className = 'fault-label'; caption.textContent = scenario.fault; name.append(caption); row.append(name);
    for (const strategy of STRATEGIES) {
      const result = suite.find((item) => item.scenario === scenario.id && item.strategy === strategy.id);
      const cell = document.createElement('td'); const button = document.createElement('button'); button.className = `result-button ${kind(result)}`;
      const dot = document.createElement('span'); dot.className = 'status-dot'; dot.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span'); text.textContent = label(result); button.append(dot, text);
      button.setAttribute('aria-label', `Inspect ${scenario.name} with ${strategy.name}: ${label(result)}`);
      button.addEventListener('click', () => { $('scenario').value = scenario.id; $('strategy').value = strategy.id; run(); $('lab').scrollIntoView({ behavior: 'smooth' }); });
      cell.append(button); row.append(cell);
    }
    rows.append(row);
  }
  $('matrix').replaceChildren(rows);
  $('corpus-note').textContent = `Recomputed locally · observation budget: ${$('budget').value} logical ticks · 24 runs · illustrative counterexamples, not production failure rates. Rejected actions are listed in the matrix and JSON export.`;
}

function renderAdapterEvidence() {
  try {
    const report = JSON.parse($('adapter-evidence').textContent);
    if (report === null) return;
    if (report.model !== 'real-http-sqlite' || report.schema_version !== 1
      || !Array.isArray(report.cases) || report.cases.length !== report.case_count
      || report.case_count !== 8 || !report.cases.every((row) => row.checks_passed === true
        && Number.isInteger(row.effect_count) && row.effect_count >= 0
        && Array.isArray(row.effects) && row.effects.length === row.effect_count
        && ['guarded', 'unsafe-control'].includes(row.kind))) {
      throw new Error('Unsupported or incomplete evidence report');
    }
    const fragment = document.createDocumentFragment();
    for (const result of report.cases) {
      const row = document.createElement('tr');
      const name = document.createElement('td'); name.textContent = result.name;
      const count = document.createElement('td'); count.textContent = result.effect_count;
      const outcome = document.createElement('td');
      outcome.textContent = result.kind === 'unsafe-control' ? 'Unsafe control reproduced' : 'Invariant preserved';
      outcome.className = result.kind === 'unsafe-control' ? 'evidence-control' : 'evidence-held';
      row.append(name, count, outcome); fragment.append(row);
    }
    $('adapter-matrix').replaceChildren(fragment);
    $('adapter-status').textContent = `${report.case_count} experiments verified against real HTTP and SQLite. Controls expose the failures; guarded cases preserve their specified invariants.`;
    $('adapter-provenance').textContent = `Measured ${new Date(report.generated_at).toISOString()} · Python ${report.runtime.python} · SQLite ${report.runtime.sqlite} · No model or external-system calls.`;
    if (typeof report.source_commit === 'string' && /^[a-f0-9]{40}$/.test(report.source_commit)) {
      $('adapter-source').href = `https://github.com/OllieinCanada/OliverSlapinski.github.io/commit/${report.source_commit}`;
      $('adapter-source').hidden = false;
    }
    adapterReport = report;
    $('adapter-download').disabled = false;
  } catch {
    $('adapter-status').textContent = 'The bundled evidence report could not be validated. No measured results are claimed.';
    $('adapter-matrix').replaceChildren();
  }
}

$('run').addEventListener('click', run);
$('scenario').addEventListener('change', run);
$('strategy').addEventListener('change', run);
$('budget').addEventListener('input', () => { $('budget-value').textContent = `${$('budget').value} ticks`; run(); renderSuite(); });
$('download').addEventListener('click', () => exportJSON(`actionproof-${current.scenario}-${current.strategy}.json`, current));
$('adapter-download').addEventListener('click', () => { if (adapterReport) exportJSON('actionproof-real-adapter.json', adapterReport); });
$('download-suite').addEventListener('click', (event) => { event.preventDefault(); exportJSON('actionproof-suite.json', { version: VERSION, model: 'deterministic-simulation', budget: Number($('budget').value), summary: summarize(suite), results: suite }); });
$('compare').addEventListener('click', renderSuite);
$('step').addEventListener('input', () => { stopPlayback(); renderTrace(); });
$('back').addEventListener('click', () => { stopPlayback(); $('step').value = Math.max(1, Number($('step').value) - 1); renderTrace(); });
$('next').addEventListener('click', () => { stopPlayback(); $('step').value = Math.min(current.events.length, Number($('step').value) + 1); renderTrace(); });
$('play').addEventListener('click', () => {
  if (timer) { stopPlayback(); return; }
  if (Number($('step').value) >= current.events.length) $('step').value = 1;
  $('play').textContent = 'Pause'; renderTrace();
  timer = setInterval(() => { $('step').value = Number($('step').value) + 1; renderTrace(); if (Number($('step').value) >= current.events.length) stopPlayback(); }, 600);
});
run();
renderSuite();
renderAdapterEvidence();
