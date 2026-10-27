import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, runSuite, summarize, evaluate, SCENARIOS, STRATEGIES } from '../dist/engine.mjs';
import { main } from '../cli.mjs';

test('clean execution completes once with each policy', () => {
  for (const strategy of STRATEGIES) {
    const run = runScenario('clean', strategy.id);
    assert.equal(run.completed, true);
    assert.equal(run.effects.length, 1);
    assert.equal(run.effects[0].target, 'invoice-1042');
    assert.deepEqual(run.violations, []);
  }
});

test('a lost acknowledgement makes an unkeyed retry duplicate a committed action', () => {
  const run = runScenario('lost-ack', 'retry');
  assert.equal(run.attempts, 2);
  assert.equal(run.effects.length, 2);
  assert.equal(run.outcome, 'success');
  assert.deepEqual(run.violations, ['duplicate-effect', 'false-success']);
  assert.equal(run.completed, false);
});

test('authoritative reconciliation finds the first commit without redispatch', () => {
  const run = runScenario('lost-ack', 'guarded');
  assert.equal(run.attempts, 1);
  assert.equal(run.effects.length, 1);
  assert.equal(run.outcome, 'success');
  assert.ok(run.events.some((event) => event.type === 'lookup.result'));
});

test('a retained operation key prevents a second effect during a status outage', () => {
  const run = runScenario('read-outage', 'guarded');
  assert.equal(run.attempts, 2);
  assert.equal(run.effects.length, 1);
  assert.equal(run.completed, true);
  const requests = run.events.filter((event) => event.type === 'request.dispatched');
  assert.equal(requests[0].data.key, 'approve-invoice-1042');
  assert.equal(requests[1].data.key, 'approve-invoice-1042');
  assert.ok(run.events.some((event) => event.type === 'request.deduplicated'));
});

test('a stale success is not evidence for a new operation', () => {
  const optimistic = runScenario('stale-text', 'retry');
  assert.equal(optimistic.effects.length, 0);
  assert.deepEqual(optimistic.violations, ['false-success']);
  const observed = runScenario('stale-text', 'observe');
  assert.equal(observed.outcome, 'unknown');
  assert.equal(observed.completed, false);
  assert.deepEqual(observed.violations, []);
  assert.equal(runScenario('stale-text', 'guarded').outcome, 'failed');
});

test('observing target drift after dispatch cannot undo a wrong-target effect', () => {
  const run = runScenario('target-drift', 'observe');
  assert.equal(run.outcome, 'unknown');
  assert.equal(run.effects[0].target, 'invoice-2088');
  assert.deepEqual(run.violations, ['wrong-target']);
});

test('an atomic target precondition rejects drift before any commit', () => {
  const run = runScenario('target-drift', 'guarded');
  assert.equal(run.outcome, 'failed');
  assert.deepEqual(run.effects, []);
  assert.deepEqual(run.violations, []);
});

test('an expired idempotency window stops retries and preserves uncertainty', () => {
  const run = runScenario('key-expired', 'guarded');
  assert.equal(run.attempts, 1);
  assert.equal(run.outcome, 'unknown');
  assert.equal(run.effects.length, 1);
  assert.deepEqual(run.violations, []);
  assert.ok(run.events.some((event) => event.type === 'decision.stop'));
});

test('a pre-commit loss can be recovered without inventing a first commit', () => {
  const run = runScenario('precommit-drop', 'guarded');
  assert.equal(run.attempts, 2);
  assert.equal(run.effects.length, 1);
  assert.equal(run.effects[0].tick, 3);
  assert.equal(run.completed, true);
});

test('the UI deadline changes evidence availability, not durable ground truth', () => {
  const short = runScenario('delayed-ui', 'observe', { budget: 3 });
  const long = runScenario('delayed-ui', 'observe', { budget: 8 });
  assert.equal(short.outcome, 'unknown');
  assert.equal(long.outcome, 'success');
  assert.deepEqual(short.effects, long.effects);
  assert.equal(short.completed, false);
  assert.equal(long.completed, true);
});

test('ground-truth evaluator catches false success independently of policy decisions', () => {
  assert.deepEqual(evaluate({ outcome: 'success', effects: [] }), {
    violations: ['false-success'], safe: false, completed: false,
  });
  assert.deepEqual(evaluate({ outcome: 'unknown', effects: [] }), {
    violations: [], safe: true, completed: false,
  });
  assert.deepEqual(evaluate({ outcome: 'failed', effects: [{ target: 'invoice-2088' }] }), {
    violations: ['wrong-target'], safe: false, completed: false,
  });
});

test('a claimed success with two correct-target effects is still unsafe', () => {
  const result = evaluate({ outcome: 'success', effects: [{ target: 'invoice-1042' }, { target: 'invoice-1042' }] });
  assert.equal(result.completed, false);
  assert.deepEqual(result.violations, ['duplicate-effect', 'false-success']);
});

test('guarded strategy preserves its safety invariant across every supported observation budget', () => {
  for (let budget = 1; budget <= 50; budget++) {
    for (const scenario of SCENARIOS) {
      const run = runScenario(scenario.id, 'guarded', { budget });
      assert.ok(run.effects.length <= 1, scenario.id);
      assert.ok(run.effects.every((effect) => effect.target === 'invoice-1042'), scenario.id);
      assert.deepEqual(run.violations, [], scenario.id);
    }
  }
});

test('suite has exactly one result per scenario and strategy and is reproducible', () => {
  const first = runSuite();
  assert.equal(first.length, 24);
  assert.equal(new Set(first.map((run) => `${run.scenario}:${run.strategy}`)).size, 24);
  assert.deepEqual(runSuite(), first);
  for (const run of first) {
    assert.equal(run.events[0].sequence, 1);
    assert.equal(run.events.at(-1).type, 'decision.final');
    for (let index = 1; index < run.events.length; index++) {
      assert.equal(run.events[index].sequence, index + 1);
      assert.ok(run.events[index].tick >= run.events[index - 1].tick);
    }
  }
});

test('aggregate counts distinguish safe uncertainty from successful completion', () => {
  const guarded = summarize(runSuite()).find((row) => row.strategy === 'guarded');
  assert.equal(guarded.runs, 8);
  assert.equal(guarded.completed, 5);
  assert.equal(guarded.unsafe, 0);
  assert.equal(guarded.unknown, 1);
  assert.equal(guarded.rejected, 2);
});

test('invalid input fails before a run starts', () => {
  assert.throws(() => runScenario('missing', 'retry'), /Unknown scenario/);
  assert.throws(() => runScenario('clean', 'missing'), /Unknown strategy/);
  for (const budget of [0, 51, -1, 1.5, NaN, Infinity, '3']) {
    assert.throws(() => runScenario('clean', 'retry', { budget }), /budget/);
  }
});

test('CLI emits a complete machine-readable report', () => {
  const lines = [];
  const status = main(['--json'], { log: (line) => lines.push(line), error: assert.fail });
  assert.equal(status, 0);
  const report = JSON.parse(lines.join('\n'));
  assert.equal(report.model, 'deterministic-simulation');
  assert.equal(report.results.length, 24);
  assert.equal(report.summary.length, 3);
});

test('CLI rejects unknown flags and partial scenario selection', () => {
  for (const args of [['--bogus'], ['--scenario', 'clean'], ['--budget', 'NaN'], ['--budget', '2', '--budget', '3']]) {
    const errors = [];
    const status = main(args, { log: assert.fail, error: (line) => errors.push(line) });
    assert.equal(status, 1);
    assert.equal(errors.length, 1);
  }
});
