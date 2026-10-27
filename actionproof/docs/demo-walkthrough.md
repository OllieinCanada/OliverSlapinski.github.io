# A 90-second demo

Open `actionproof-demo.html`. Start with **Committed. Response lost. / Blind retry**.

1. **The failure (20 seconds):** “The server approved the intended invoice, but the response was lost. This policy treats the timeout as permission to retry. The durable log now has two effects even though the agent reports success.” Replay the two `effect.committed` events.
2. **The repair (20 seconds):** Select **Guard + reconcile**. “A status lookup finds the original receipt. There is one effect and one dispatch. If the lookup is down, the same operation key can still deduplicate a retry—but only within the server's retention guarantee.” Switch to **Reconciliation is unavailable** to show that second case.
3. **The boundary (20 seconds):** Select **Retry window has expired**. “Now the safe answer is unknown. The policy refuses another write. I don't score that as completing the task.”
4. **The other failure (15 seconds):** Select **Target changes mid-flight** and compare causal observation with guard-and-reconcile. “Detecting drift after a click doesn't undo the wrong effect. The target precondition has to be enforced at the commit boundary.”
5. **The evidence (15 seconds):** Show the result matrix, download a trace, and open the tests. “These are deterministic protocol counterexamples, not benchmark claims about any particular LLM. The browser and CLI share one engine, and the evaluator checks the server effect log independently of the agent's claim.”

## Honest portfolio description

Built a deterministic fault-injection lab for agent execution, separating dispatch acknowledgements, UI confirmation, durable effects, and success claims. Implemented three policies across eight failure scenarios, an independent invariant evaluator, a replayable browser demo, and a dependency-free CLI. Regression checks catch removal of deduplication protection; the prototype explicitly reports unknown outcomes and documents server-side assumptions.

Use the actual CI result when describing browser validation. Do not present the synthetic counts as production failure rates or claim exactly-once behavior for real distributed systems.

## Real adapter evidence

Scroll to **Real HTTP + SQLite**. Show the measured disconnect, process-restart, and 20-client cases, then the two unsafe controls. Download the report and open its tested source commit. These measurements come from actual local HTTP requests and direct SQL observations; they are separate from the simulated policy counts above. The captioned walkthrough is recorded by `scripts/record-demo.py` after the report and browser checks are generated in CI.
