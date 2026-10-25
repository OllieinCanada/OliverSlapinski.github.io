/**
 * ActionProof v0.1 — a discrete-event protocol simulation, not an LLM judge.
 * UI state, dispatch acknowledgement, and durable effects are separate facts.
 * No network or real payment capability exists in this module.
 */
export const VERSION = '0.1.0';

export const STRATEGIES = Object.freeze([
  { id: 'retry', name: 'Blind retry', short: 'Retry', description: 'Trust dispatch acknowledgements; retry once after a timeout.' },
  { id: 'observe', name: 'Causal observation', short: 'Observe', description: 'Dispatch once. Require a new UI confirmation attributable to this action.' },
  { id: 'guarded', name: 'Guard + reconcile', short: 'Reconcile', description: 'Bind the target, reuse an idempotency key, and require a durable receipt.' },
]);

// These are deliberately small, inspectable counterexamples, not a sample of
// production failure frequencies. null UI delay means no visible update.
export const SCENARIOS = Object.freeze([
  { id: 'clean', name: 'Clean execution', fault: 'None', description: 'The action commits and both acknowledgement and confirmation arrive.', uiDelay: 1 },
  { id: 'lost-ack', name: 'Committed. Response lost.', fault: 'Lost acknowledgement', description: 'The server commits, but the first response and UI refresh are lost. A retry can repeat the side effect.', loseAck: true, uiDelay: null },
  { id: 'delayed-ui', name: 'Confirmation arrives late', fault: 'Delayed UI', description: 'The action commits immediately; the UI updates after the observation budget.', uiDelay: 7 },
  { id: 'stale-text', name: 'Yesterday’s “Success”', fault: 'Stale confirmation', description: 'A previous success is already on screen. The new action is rejected after dispatch.', staleUI: true, reject: true, uiDelay: null },
  { id: 'target-drift', name: 'Target changes mid-flight', fault: 'Target drift', description: 'The active invoice changes between the snapshot and dispatch. Only a server-enforced target precondition prevents the wrong effect.', drift: true, uiDelay: 1 },
  { id: 'precommit-drop', name: 'Request never reaches server', fault: 'Pre-commit loss', description: 'The first request is lost before commit. A retry can recover without duplicating an effect.', dropBeforeCommit: true, uiDelay: 1 },
  { id: 'read-outage', name: 'Reconciliation is unavailable', fault: 'Evidence unavailable', description: 'The action commits. Its response, UI update, and authoritative status lookup are all unavailable.', loseAck: true, readUnavailable: true, uiDelay: null },
  { id: 'key-expired', name: 'Retry window has expired', fault: 'Expired idempotency guarantee', description: 'The action committed, but all evidence is unavailable and the server’s deduplication window has elapsed. Retrying would be unsafe.', loseAck: true, readUnavailable: true, retentionTicks: 0, uiDelay: null },
]);

const EXPECTED_TARGET = 'invoice-1042';
const OTHER_TARGET = 'invoice-2088';
const OPERATION = 'approve-invoice-1042';

function scenarioById(id) {
  const scenario = SCENARIOS.find((item) => item.id === id);
  if (!scenario) throw new RangeError(`Unknown scenario: ${id}`);
  return scenario;
}

class World {
  constructor(scenario) {
    this.scenario = scenario;
    this.tick = 0;
    this.events = [];
    this.effects = [];
    this.keys = new Map();
    this.attempts = 0;
    this.target = EXPECTED_TARGET;
    this.ui = scenario.staleUI ? { text: 'Approved', operationId: 'previous-operation' } : { text: 'Pending', operationId: null };
    this.pendingUI = [];
    this.record('intent', 'agent', `Approve ${EXPECTED_TARGET} exactly once.`, { expectedTarget: EXPECTED_TARGET, operationId: OPERATION });
  }

  record(type, actor, message, data = {}) {
    this.events.push({ sequence: this.events.length + 1, tick: this.tick, type, actor, message, data });
  }

  advance() {
    this.tick++;
    for (const pending of this.pendingUI.filter((item) => item.at <= this.tick)) {
      this.ui = { text: 'Approved', operationId: pending.operationId };
      this.record('ui.changed', 'browser', `A new approval confirmation is visible for ${pending.target}.`, { ...this.ui, target: pending.target });
    }
    this.pendingUI = this.pendingUI.filter((item) => item.at > this.tick);
  }

  snapshot() {
    const view = { target: this.target, ...this.ui };
    this.record('ui.observed', 'agent', `Observed “${view.text}” on ${view.target}.`, view);
    return view;
  }

  dispatch({ key = null, guarded = false } = {}) {
    this.advance();
    this.attempts++;
    if (this.scenario.drift && this.attempts === 1) {
      this.target = OTHER_TARGET;
      this.record('fault.target-drift', 'fault', `The active target changed to ${OTHER_TARGET} after the snapshot.`);
    }
    this.record('request.dispatched', 'agent', `Attempt ${this.attempts}: dispatch approval.`, { key, target: this.target, guarded });
    if (guarded && this.target !== EXPECTED_TARGET) {
      this.record('request.rejected', 'server', 'Target precondition failed before any effect.');
      return { kind: 'rejected', reason: 'target-mismatch' };
    }
    if (this.scenario.dropBeforeCommit && this.attempts === 1) {
      this.record('fault.precommit-drop', 'fault', 'The request never reached the commit boundary.');
      return { kind: 'timeout' };
    }
    if (this.scenario.reject) {
      this.record('request.rejected', 'server', 'The application rejected the action after provider dispatch.');
      // Browser automation acknowledged input dispatch, not application success.
      return { kind: 'dispatched' };
    }
    const retention = this.scenario.retentionTicks ?? 20;
    const cached = key ? this.keys.get(key) : undefined;
    if (cached && this.tick - cached.tick <= retention) {
      this.record('request.deduplicated', 'server', 'The same idempotency key returned the original receipt.', { receipt: cached.id });
      return { kind: 'receipt', receipt: { ...cached } };
    }
    const receipt = { id: `receipt-${this.effects.length + 1}`, operationId: OPERATION, target: this.target, tick: this.tick };
    this.effects.push(receipt);
    if (key) this.keys.set(key, receipt);
    this.record('effect.committed', 'server', `Approval committed on ${receipt.target}.`, { ...receipt });
    if (this.scenario.uiDelay !== null) {
      this.pendingUI.push({ at: this.tick + this.scenario.uiDelay, operationId: OPERATION, target: receipt.target });
    }
    if (this.scenario.loseAck && this.attempts === 1) {
      this.record('fault.ack-lost', 'fault', 'The server committed, but the acknowledgement was lost.');
      return { kind: 'timeout' };
    }
    if (guarded) return { kind: 'receipt', receipt: { ...receipt } };
    return { kind: 'dispatched' };
  }

  reconcile() {
    this.advance();
    if (this.scenario.readUnavailable) {
      this.record('lookup.unavailable', 'server', 'Authoritative operation status is unavailable.');
      return { kind: 'unavailable' };
    }
    if (this.scenario.reject) {
      this.record('lookup.rejected', 'server', 'Authoritative status: the operation was rejected.');
      return { kind: 'rejected' };
    }
    const receipt = this.effects.find((item) => item.operationId === OPERATION && item.target === EXPECTED_TARGET);
    this.record('lookup.result', 'server', receipt ? 'Authoritative status: committed on the intended target.' : 'Authoritative status: no committed operation.', { receipt: receipt?.id ?? null });
    return receipt ? { kind: 'receipt', receipt: { ...receipt } } : { kind: 'absent' };
  }

  canRetryKey() {
    const retention = this.scenario.retentionTicks ?? 20;
    // Account for the next dispatch tick. The server contract, not a UI guess,
    // is what makes this retry safe. After expiry, preserve uncertainty.
    return retention >= this.tick + 1 - 1;
  }
}

function provesIntent(response) {
  return response.kind === 'receipt'
    && response.receipt.operationId === OPERATION
    && response.receipt.target === EXPECTED_TARGET;
}

/** Ground-truth evaluation is independent of the strategy's claimed result. */
export function evaluate({ outcome, effects }) {
  const violations = [];
  if (effects.length > 1) violations.push('duplicate-effect');
  if (effects.some((effect) => effect.target !== EXPECTED_TARGET)) violations.push('wrong-target');
  const correctEffect = effects.length === 1 && effects[0].target === EXPECTED_TARGET;
  if (outcome === 'success' && !correctEffect) violations.push('false-success');
  return { violations, safe: violations.length === 0, completed: outcome === 'success' && correctEffect };
}

/**
 * Run one scenario. budget is a logical observation bound, not real latency.
 * Agent policies see only dispatch responses and explicit observations. They
 * never inspect the ground-truth effect log used by evaluate().
 */
export function runScenario(scenarioId, strategyId, { budget = 3 } = {}) {
  if (!STRATEGIES.some((item) => item.id === strategyId)) throw new RangeError(`Unknown strategy: ${strategyId}`);
  if (!Number.isInteger(budget) || budget < 1 || budget > 50) throw new RangeError('budget must be an integer from 1 to 50');
  const world = new World(scenarioById(scenarioId));
  const before = world.snapshot();
  let outcome = 'unknown';
  let reason = 'No conclusive evidence before the observation deadline.';
  const guarded = strategyId === 'guarded';
  let response = world.dispatch({ key: guarded ? OPERATION : null, guarded });

  if (strategyId === 'retry') {
    if (response.kind === 'timeout') {
      world.record('decision.retry', 'agent', 'Timeout: retry without an idempotency key.');
      response = world.dispatch();
    }
    outcome = response.kind === 'rejected' ? 'failed' : response.kind === 'timeout' ? 'unknown' : 'success';
    reason = outcome === 'success' ? 'Provider dispatch acknowledged; assumed application success.' : 'No successful dispatch acknowledgement.';
  } else if (strategyId === 'observe') {
    for (let i = 0; i < budget; i++) {
      world.advance();
      const view = world.snapshot();
      if (view.target !== EXPECTED_TARGET) {
        reason = 'Target drift detected after dispatch; the effect may already have happened.';
        break;
      }
      if (view.text === 'Approved' && view.operationId === OPERATION && before.operationId !== OPERATION) {
        outcome = 'success';
        reason = 'Observed a new confirmation bound to this operation and target.';
        break;
      }
    }
  } else if (response.kind === 'rejected') {
    outcome = 'failed';
    reason = 'Target precondition rejected the request before the effect.';
  } else {
    if (!provesIntent(response)) response = world.reconcile();
    if (!provesIntent(response) && response.kind !== 'rejected') {
      if (world.canRetryKey()) {
        world.record('decision.retry', 'agent', 'Retry within the server’s retention window, using the original operation key.');
        response = world.dispatch({ key: OPERATION, guarded: true });
        if (!provesIntent(response) && response.kind !== 'rejected') response = world.reconcile();
      } else {
        world.record('decision.stop', 'agent', 'Idempotency guarantee expired. Do not risk a second effect.');
        reason = 'Unknown outcome; retry refused after the deduplication window expired.';
      }
    }
    if (provesIntent(response)) {
      outcome = 'success';
      reason = 'A durable receipt proves this operation committed on its intended target.';
    } else if (response.kind === 'rejected') {
      outcome = 'failed';
      reason = 'Authoritative evidence confirms rejection.';
    }
  }

  world.record('decision.final', 'agent', reason, { outcome });
  const result = { version: VERSION, scenario: scenarioId, strategy: strategyId, budget, outcome, reason, attempts: world.attempts, ticks: world.tick, effects: world.effects.map((effect) => ({ ...effect })), events: world.events };
  return { ...result, ...evaluate(result) };
}

export function runSuite(options = {}) {
  return SCENARIOS.flatMap((scenario) => STRATEGIES.map((strategy) => runScenario(scenario.id, strategy.id, options)));
}

export function summarize(results) {
  return STRATEGIES.map((strategy) => {
    const rows = results.filter((result) => result.strategy === strategy.id);
    return {
      strategy: strategy.id, runs: rows.length,
      completed: rows.filter((result) => result.completed).length,
      unsafe: rows.filter((result) => !result.safe).length,
      unknown: rows.filter((result) => result.outcome === 'unknown').length,
      rejected: rows.filter((result) => result.outcome === 'failed').length,
    };
  });
}
