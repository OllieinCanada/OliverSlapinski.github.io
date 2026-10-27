# Validation record

Local runtime: Node 24.19.0, Python 3.12.14.

## Passed locally

- `node --test --test-isolation=none`: 22 tests pass, zero skips. This includes the simulated scenarios, the guarded-policy invariant at all 50 observation budgets, and safe measured-evidence embedding.
- `node --experimental-vm-modules scripts/check.mjs`: all eight JavaScript modules parse. Node reports that VM Modules remains experimental.
- `node scripts/bundle.mjs`: creates a deterministic standalone demo without runtime asset imports.
- `node cli.mjs`: runs all 24 scenario/policy combinations and prints the documented aggregate counts.
- `node cli.mjs --json`: produces machine-readable traces and results from the same engine as the demo.
- `python -m unittest discover -s tests -p test_store.py -v`: 10 SQLite tests pass, including 20 concurrent writers, reopened-store receipts, target-guard rollback, and conflicting commands.

## Real HTTP verification

The five HTTP integration tests require loopback sockets and separate server processes. They were attempted locally and could not start because the sandbox denies socket creation. No local HTTP pass is claimed. CI runs the complete Python suite, generates the eight-case measured report, builds the demo from that report, tests it in Chromium, and records the captioned walkthrough. Inspect the latest PR run for those results. Render repeats the Python and Node checks and regenerates evidence for the exact deployed commit before serving the static site.

## Regression strength

In a disposable copy, replacing the deduplication-table lookup with `undefined` causes three existing tests to fail: the retained-key regression, the guarded-policy invariant, and aggregate completion. The retained-key regression observes two effects where it requires one. The original project remains unchanged and passes all tests.

This is mutation evidence for the specific protection. It is not a claim of comprehensive mutation-test coverage.

## Environment limits

The environment denies child-process isolation and some local socket operations. Node's default isolated test runner could not start reliably, so the documented command uses its supported in-process mode. CLI behavior is tested through its real exported entry point and also executed directly from the shell.

Local Chromium launch was attempted with Playwright 1.62.0. The browser exited before page creation because its native socket operations were denied. This is a local-environment limitation, not a passing local browser check.

The [GitHub Actions run on the initial published prototype](https://github.com/OllieinCanada/OliverSlapinski.github.io/actions/runs/40162872117) passed the Node suite, syntax checks, standalone build, and real Chromium QA with Playwright 1.62.0. Browser checks exercised controls, replay, download contents, console errors, and responsive overflow at 320, 393, 768, and 1440 pixels. Screenshot artifacts were retrieved and the desktop and tablet renders inspected. Later commits retain these checks; inspect the latest PR checks for the final head's status.

The Sites publishing helper scripts are not installed in this execution environment. No hosted deployment is claimed. The generated standalone HTML works without a host.
