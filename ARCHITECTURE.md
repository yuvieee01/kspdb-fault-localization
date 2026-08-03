# Architecture

## Diagram
<!-- Mermaid or committed image. Pole device -> ingest -> localization ->
ticket -> operator screen. Must match what's actually built - update this
LAST, after the code is done, not first. -->

## Data sourcing and ingestion

Pole devices push telemetry to `POST /api/telemetry` (single event) or
`POST /api/telemetry/batch` (array of events) over HTTPS. Both endpoints
share the same ingest logic.

Every event is checked against three known sources of unreliable data
before it's accepted:

**Duplicates and stale/out-of-order messages.** Since delivery is
at-least-once and retries can arrive up to 6 hours late, we don't trust
arrival order or the device's own timestamp (`ts` can be off by up to
90 seconds). Instead we track `last_seq` per pole in a `PoleState` table
and only accept an event if its `seq` is strictly greater than the last
one we've seen for that device. Anything at or below that value is
silently discarded as a duplicate or a late retry of something we
already processed.

**Device reboots.** A device's `seq` counter resets to 0 every time it
reboots, so a naive "seq must always increase" rule would incorrectly
reject the first few messages after every restart. When a `boot` event
arrives, we reset our tracked `last_seq` for that device, so its next
sequence of numbers is judged on its own terms instead of against
whatever it was doing before it rebooted.

**Device swaps.** The same physical pole can end up with a different
`device_id` over time (the department replaces faulty hardware without
re-surveying the pole). We track `last_device_id` alongside `last_seq`,
so if an incoming event's `device_id` doesn't match what we last saw for
that pole, we treat it as a fresh device with its own sequence rather
than comparing it against the previous device's counter.

**Unknown poles.** Any event referencing a `pole_id` that isn't in the
seeded pole registry is rejected at the door — the registry is treated
as the closed set of real assets, so an unrecognized pole is either bad
data or out-of-scope hardware, not something worth storing.

Accepted events are written to an append-only `telemetry_events` log —
we never delete or overwrite raw telemetry, only the derived
`PoleState` gets updated in place. This means the full history is always
available to recompute from if the derivation logic changes, and it
keeps the ingest path itself simple: validate, dedup-check, write, done.

The batch endpoint exists specifically for the burst scenario described
in the brief (up to 5,000 messages in the seconds after a large outage):
it validates and processes each event in the array independently,
returning a per-event accept/reject result rather than failing the whole
batch if one message is malformed.

## Storage and internal model
<!-- Schema (poles, transformers, telemetry_events, pole_state, incidents,
etc). How network topology is represented - recorded vs inferred edges.
Why this representation and not another. -->

## The localization algorithm
<!-- Explain well enough to reimplement. Cover: how the fault boundary is
found, how symptoms are grouped into one incident, how simultaneous faults
are handled, how confidence is computed, and explicitly what happens in the
60%-missing-topology case vs the 40% recorded case. State complexity and
known failure modes (e.g. MST inference wrong near geometric obstacles).
Reference docs/ALGORITHM_SPEC.md as the detailed spec this section
summarizes. -->

## Noise handling
<!-- Dead sensor vs real outage. Scheduled outages + tolerance window.
Debouncing. The false-positive story: what specifically prevents "one
alert per dark pole." -->

## API surface
<!-- Table: method, path, purpose, request/response shape. Or generated
OpenAPI (preferred over hand-maintained). -->

## UI reasoning
<!-- What the operator sees first, and why. What was deliberately left off
the main screen. Which UI decision is most likely to be wrong, and why. -->

## The AI feature
<!-- What it is (incident briefing), why this spot and not elsewhere, cost
per call, what happens when the model is unavailable or wrong. -->