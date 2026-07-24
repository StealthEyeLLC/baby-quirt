# ADR 0001: Automated Delivery Is an Orchestration Projection

Status: accepted for Automated Delivery and Self-Extension Lane v1.

## Decision

The delivery capability is a first-class runtime operation family exposed only through the existing `call_quirt` tool. It canonicalizes an exact owner-authorized plan, persists delivery intent in the existing Baby deployment SQLite ledger, and projects the existing release lifecycle into concise delivery states.

The existing durable job manager remains the only job engine. The existing deployment ledger remains the only deployment database. The existing artifact manager remains the only artifact authority. Receipt v2 remains the only runtime receipt authority. The fixed UID-0 deployment controller and independent guard remain the only activation, rollback, and recovery authorities. The Gateway authenticates, validates, signs QRT1, forwards over the private Unix socket, correlates, and verifies; it does not own delivery lifecycle state.

A `DeliveryRun` references the authoritative deployment ID, generation, child job IDs, immutable artifact IDs, event offsets, evidence digests, and receipts. It does not copy or replace their authoritative data. Delivery-only states are orchestration projections. Every phase that already exists in the release state machine maps to that state machine and may not advance independently.

## Authority and confirmation

A delivery plan is strict, canonical, and SHA-256 addressed. Owner authorization binds the exact digest. Any changed field produces a different digest and invalidates prior authorization. Production activation remains high risk and requires that bound authorization. Human labor is not required after authorization.

## Explicitly rejected designs

The lane may not introduce another scheduler, worker queue, job database, state database, artifact store, receipt system, privileged service, public tool, privileged socket, deployment authority, rollback authority, guard, or recovery authority. It may not make Gateway the controller. It may not depend on Fix, the old operator, routine SSH, Termius, pasted commands, or GitHub Actions as its only execution path. Connector-assisted source handoff is a bootstrap adapter, never the permanent source-acquisition architecture.

## Recovery truth

Caller or Gateway loss does not cancel a delivery. Baby restart or host reboot triggers durable readback and bounded reconciliation. Unknown and ambiguous state never become success. Pre-arm cancellation cleans bounded inactive staging; post-arm cancellation records rollback intent. Rollback failure becomes manual recovery required. Repair is explicit and evidence-gated.

## Production boundary

Repository and disposable nspawn certification may exercise the lane. No production service, pointer, OAuth state, Caddy, DNS, firewall, credential, signing key, protected release, or `tool.js` file is changed by this implementation mission.
