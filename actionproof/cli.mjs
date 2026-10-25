#!/usr/bin/env node
import { runScenario, runSuite, summarize, VERSION } from './dist/engine.mjs';
import { pathToFileURL } from 'node:url';

const usage = 'Usage: node cli.mjs [--scenario ID --strategy ID] [--budget 1..50] [--json]';
export function parseOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') { options.help = true; continue; }
    if (arg === '--json') { options.json = true; continue; }
    if (!['--scenario', '--strategy', '--budget'].includes(arg) || args[i + 1] === undefined) throw new Error(usage);
    const key = arg.slice(2);
    if (Object.hasOwn(options, key)) throw new Error(`Duplicate option: ${arg}`);
    options[key] = args[++i];
  }
  return options;
}

export function buildReport(options) {
  const budget = options.budget === undefined ? 3 : Number(options.budget);
  if (Boolean(options.scenario) !== Boolean(options.strategy)) throw new Error('--scenario and --strategy must be supplied together');
  const results = options.scenario ? [runScenario(options.scenario, options.strategy, { budget })] : runSuite({ budget });
  return { version: VERSION, model: 'deterministic-simulation', budget, summary: summarize(results), results };
}

export function main(args, output = console) {
  try {
    const options = parseOptions(args);
    if (options.help) { output.log(usage); return 0; }
    const report = buildReport(options);
    if (options.json) output.log(JSON.stringify(report, null, 2));
    else {
      output.log(`ActionProof ${VERSION} · synthetic protocol simulation · budget ${report.budget} logical ticks\n`);
      output.table(report.summary);
      if (report.results.length === 1) for (const event of report.results[0].events) output.log(`t${event.tick} ${event.actor.padEnd(7)} ${event.message}`);
      output.log('\nUnsafe = duplicate effect, wrong target, or false success. Unknown is reported separately.');
    }
    return 0;
  } catch (error) {
    output.error(error.message);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = main(process.argv.slice(2));
