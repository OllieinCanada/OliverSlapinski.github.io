# Protocol model

## State

A run has an intended target (`invoice-1042`), a logical operation (`approve-invoice-1042`), an active browser target, a UI confirmation, a server effect log, and a server deduplication table. The effect log is the evaluator's ground truth. The policy sees only explicit responses and observations; it cannot inspect the log.

The operation is synthetic. An approval in this model is an append to an in-memory array, never an external write or financial action.

## Event ordering

1. Record the intent and initial UI snapshot.
2. Advance one logical tick at dispatch.
3. Inject target drift, if configured, between snapshot and commit-boundary validation.
4. Enforce the target precondition when requested. A mismatch returns rejection with no side effect.
5. Inject pre-commit request loss, if configured.
6. Reject an application-invalid request, if configured. A provider may still acknowledge input dispatch.
7. If an operation key has an unexpired durable receipt, return that receipt without committing again.
8. Otherwise append a durable effect, store its receipt under the supplied key, and schedule a UI update.
9. Drop the first acknowledgement when configured.
10. Let the policy observe, reconcile, or retry under its rules, then evaluate its claim against the effect log.

UI updates are processed when logical time advances. A `null` UI delay means the update is unavailable for the run. A status-read outage is independent of dispatch; a retry may still return a cached receipt.

## Policy contracts

**Blind retry** uses no operation key or target precondition. It retries one timeout and treats a provider dispatch acknowledgement as success. It is intentionally weak and is not attributed to any production agent.

**Causal observation** dispatches once. It requires a new confirmation with this operation's identifier on the intended target, compared with the pre-dispatch snapshot. It never credits a pre-existing confirmation. It can detect target drift after dispatch but cannot undo an already committed effect. When evidence is absent at the observation deadline it returns unknown.

**Guard + reconcile** requests an atomic target precondition and sends the same operation key on every attempt. It accepts only a receipt bound to the intended operation and target. Following an ambiguous dispatch it asks for authoritative status. If status does not settle the outcome, it retries only while the server's retention guarantee still covers the next dispatch. After expiry it preserves uncertainty.

## Receipt and storage assumptions

Receipts and the deduplication table are durable within the simulated run. Key lookup and effect insertion are atomic, reads are authoritative when available, and receipts cannot be forged. The target precondition is enforced by the server, not by a racy client snapshot. These are explicit assumptions, not properties established for a distributed production service.

The model has one client and at most two dispatches. It does not simulate cross-process persistence, replica lag, split brains, key collisions, malicious servers, cancellation, concurrent requests, or crashes while writing the receipt. A future real adapter must establish those boundaries separately.

## Evaluation

- `duplicate-effect`: more than one durable effect for one intended operation.
- `wrong-target`: any durable effect on a target other than the intended target.
- `false-success`: the policy claims success without exactly one correct effect.
- `safe`: no listed invariant was violated.
- `completed`: success was claimed and exactly one correct effect exists.

Safety does not imply completion. An unknown outcome can still be unsafe. These dimensions remain separate in exports and summaries.
