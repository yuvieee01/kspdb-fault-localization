# Decisions

Newest first. One entry per meaningful decision or assumption: what was
chosen, what was rejected, and why. Add entries the day the decision is
made - do not reconstruct this from memory later.


## Stack
Chosen: Node.js + TypeScript + Express, Prisma + PostgreSQL, React + Vite +
Tailwind + MapLibre/Leaflet.
Rejected: Flask (Python) - considered, moved off it for async-friendly
ingest handling and single-language frontend/backend during a compressed
timeline.

## Realtime updates
Chosen: polling (5-10s).
Rejected: WebSockets - avoids proxy-related deployment risk on free-tier
hosts, and the 120s p95 target has large margin at this event volume.

## Operator Dashboard & Map Interface
Chosen: React + Leaflet with OpenStreetMap tiles, paired with a 5-second client polling loop.
Reasoning: Avoids WebSocket complexity on simple deploy hosts while giving field operators immediate spatial awareness (color-coded pole statuses, topology links, and incident boundaries) alongside actionable ticket metadata and guarded resolution handling.

## Seed data reproducibility
Chosen: a deterministic seeded PRNG (xorshift32, seed=42) for generating
the synthetic pole/transformer network, instead of an unseeded random
generator.
Reasoning: this means every fresh `docker compose up` produces the exact
same network every time. That matters for two reasons — it makes my own
testing consistent (a fault injected against pole P-1042 behaves the same
way every run), and it means a reviewer re-running the system sees the
same data I saw while building and documenting it, rather than a
different random network each time.

## Simulator and real ingest share one code path
Chosen: telemetry.ts and simulator.ts both call the same underlying
ingest function for validation, dedup, and state updates.
Rejected: simulator noise endpoints writing directly to the database.
Reasoning: a simulator that bypasses real ingest logic can only prove
its own output looks plausible, not that the actual dedup/validation
code a real device would hit is correct. Any test using the simulator
is only meaningful if it exercises the same code path production
telemetry does.

## Simulator must not write derived state directly
Chosen: the fault simulator only ever produces (or deliberately withholds)
telemetry events. It never writes to PoleState directly.
Rejected: an earlier version of the simulator set PoleState.energized =
false directly for firmware-1.2.x poles during a fault, since those
devices never send any telemetry when they lose power.
Reasoning: doing this would let the localization algorithm "detect" an
outage that it never actually inferred — the simulator would be handing
it the answer for exactly the ambiguous case (silent device, no
power_lost) the assignment is built around. Caught by checking
telemetry_events after a fault injection and finding it empty for those
poles despite PoleState already showing them dark. Fixed so PoleState
for a silently-failed pole stays at its last known-good value until the
localization algorithm's own debounce/inference logic (step 5) decides
what to do with the silence.

## Telemetry deduplication: application-level, not a database constraint
Chosen: dedup is handled in code, by tracking a `last_seq` value per pole
in `PoleState` and discarding any incoming event where `seq <= last_seq`.
Rejected: a database-level unique constraint on `(device_id, seq)`.
Reasoning: `seq` resets to 0 every time a device reboots (per the data
contract). A unique constraint would treat the first few messages after
every reboot as duplicates of messages from before the previous reboot,
and silently reject real telemetry. The dedup logic explicitly resets its
tracked `last_seq` back to 0 whenever it sees a `boot` event for that
device, so post-reboot sequences are handled correctly instead of being
mistaken for stale duplicates.

## Handling telemetry from an unrecognized pole_id
Chosen: reject the event outright (don't store it, don't create an orphan
record) if the pole_id doesn't match anything in the pole registry.
Reasoning: the pole registry is the authoritative, closed set of assets
the department has told us about. A pole_id we don't recognize is either
a data-entry mistake on the device side or a device reporting from
outside our subdivision — either way, it's not something the localization
algorithm should ever try to reason about, so it's safer to reject at the
door than to let bad data quietly sit in the event log.

## Dedup across device swaps
Verified: when a pole's device is physically replaced (new device_id,
its own seq starting near 0), the old device's last_seq no longer
applies. The ingest handler tracks last_device_id alongside last_seq in
PoleState — if an incoming event's device_id differs from the tracked
one, it's treated as a new device with a fresh sequence, not compared
against the old device's counter. Tested by sending seq=50 from device A,
then seq=3 from device B on the same pole — the second event was
correctly accepted rather than rejected as "stale."

## Missing topology (the 60% case)
Chosen: Prim's Minimum Spanning Tree (MST) based on haversine distance to infer connections.
Reasoning: Computed lazily on the first query for a DT with missing line sequences, caching the result to avoid recomputing on every request. Edge confidence is scored by comparing the chosen parent's distance against the second-closest candidate at insertion time, mathematically clamped between 0.3 and 0.95.

---

## What's currently known-broken or fragile
Pole count is ~2,283, slightly below the ~2,500-3,000 target range; accepted as close enough given time constraints.

## What would be done with two more weeks
<!-- Fill in near the end. -->