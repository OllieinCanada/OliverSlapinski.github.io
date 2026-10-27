# Real HTTP and SQLite experiments

The interactive simulator and the real adapter answer related questions using different mechanisms. The simulator is deterministic and uses in-memory state. The adapter uses real loopback TCP connections, separate Python server processes, and SQLite WAL transactions. Its receipts and effects remain in the same database across a process restart.

All approvals and invoices remain synthetic. No model, provider, payment, or production API is called. The fault-injection server binds only to `127.0.0.1` and is never the public site's runtime.

## Reproduce

Python 3.12+ and Node 24 are sufficient; the adapter uses only the Python standard library.

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 -m adapter.benchmark --output dist/adapter-evidence.json
node scripts/bundle.mjs
```

The report is generated only after each assertion succeeds. It includes the source commit when run in GitHub Actions or Render, runtime versions, observation time, per-case durable effects, and the observed restart/concurrency facts. A failed run does not create a success report. The browser embeds that report rather than inventing or simulating its measurements.

## Experiments

| Experiment | Independently checked fact |
|---|---|
| Clean keyed approval | One SQLite effect and a newly created receipt |
| Disconnect after commit, keyed retry | Actual transport disconnect; replay returns the original receipt; one effect |
| Disconnect after commit, unkeyed control | Two SQLite effects reproduce the unsafe retry |
| Process exit after commit | Exit code 86, a new server PID, receipt lookup after restart, and one effect after retry |
| 20 concurrent clients, same key | One HTTP 201, nineteen HTTP 200 responses, one receipt identity, one effect |
| Key reused for different payload | HTTP 409; the key cannot be rebound; no additional effect |
| Target changed before dispatch | HTTP 409; the atomic target precondition prevents any effect |
| Unguarded target-drift control | A real effect on the wrong invoice reproduces the missing-precondition failure |

The controls are expected failures of safety properties. Their successful reproduction is not reported as safe behavior. Guard rejection is not counted as completing an approval.

## Transaction boundary

```mermaid
sequenceDiagram
    participant C as Client
    participant H as HTTP server
    participant D as SQLite WAL
    C->>H: POST command + operation key
    H->>D: BEGIN IMMEDIATE
    H->>D: Existing key? Compare canonical payload
    alt Same key and payload already committed
        D-->>H: Original durable receipt
    else New key
        H->>D: Check intended target
        H->>D: Insert effect and bind key to receipt
        H->>D: COMMIT (synchronous=FULL)
    end
    Note over H: Inject disconnect or os._exit(86) here
    H-->>C: Receipt, if response arrives
    C->>H: Reconcile or retry the same command/key
    H-->>C: Same receipt; no new effect
```

The key table has a primary-key constraint; its effect binding is unique. Key lookup, command fingerprint comparison, target precondition, effect insertion, and receipt binding occur within one writer transaction. A conflicting command returns 409 before another write. The harness counts effects using direct SQL rather than trusting the server's receipt serializer.

## Limits

- This demonstrates idempotent effects for one SQLite database under client concurrency, transport loss, and process restart. It does not establish universal exactly-once delivery.
- SQLite's durability depends on its filesystem and storage implementation. Process exit is not a machine power-loss test.
- Keys do not expire or get evicted in this adapter. The simulator's expired-key scenario remains a separate, explicitly modeled contract.
- There is no replication, multi-region failover, distributed transaction, malicious server, external provider action, or real browser integration.
- The loopback server is an experiment fixture, not a production API. It has no user accounts or public authentication mechanism.
