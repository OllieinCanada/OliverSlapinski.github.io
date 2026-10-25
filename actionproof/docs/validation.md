# Validation record

Local runtime: Node 24.19.0, Python 3.12.14.

## Passed locally

- `node --test --test-isolation=none`: 20 tests pass, zero skips. This includes all eight scenarios and the guarded-policy invariant checked at all 50 supported observation budgets.
- `node --experimental-vm-modules scripts/check.mjs`: all eight JavaScript modules parse. Node reports that VM Modules remains experimental.
- `node scripts/bundle.mjs`: creates a deterministic standalone demo without runtime asset imports.
- `node cli.mjs`: runs all 24 scenario/policy combinations and prints the documented aggregate counts.
- `node cli.mjs --json`: produces machine-readable traces and results from the same engine as the demo.

## Regression strength

In a disposable copy, replacing the deduplication-table lookup with `undefined` causes three existing tests to fail: the retained-key regression, the guarded-policy invariant, and aggregate completion. The retained-key regression observes two effects where it requires one. The original project remains unchanged and passes all tests.

This is mutation evidence for the specific protection. It is not a claim of comprehensive mutation-test coverage.

## Environment limits

The environment denies child-process isolation and some local socket operations. Node's default isolated test runner could not start reliably, so the documented command uses its supported in-process mode. CLI behavior is tested through its real exported entry point and also executed directly from the shell.

Local Chromium launch was attempted with Playwright 1.62.0. The browser exited before page creation because its native socket operations were denied. No screenshot or visual QA pass is claimed. `tests/browser_smoke.py` is supplied to exercise real controls, replay, download contents, console errors, and layouts at 320, 393, 768, and 1440 pixels in an unrestricted environment. Its execution status must be checked in CI.

The Sites publishing helper scripts are not installed in this execution environment. No hosted deployment is claimed. The generated standalone HTML works without a host.
