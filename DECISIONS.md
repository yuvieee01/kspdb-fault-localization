# Decisions

Newest first. One entry per meaningful decision or assumption: what was
chosen, what was rejected, and why. Add entries the day the decision is
made - do not reconstruct this from memory later.

## Template entries to replace as real decisions get made:

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

## Missing topology (the 60% case)
<!-- Fill in once implemented: MST-based geometric inference, confidence
scoring, what the UI shows differently for inferred vs recorded topology. -->

---

## What's currently known-broken or fragile
Pole count is ~2,283, slightly below the ~2,500-3,000 target range; accepted as close enough given time constraints.

## What would be done with two more weeks
<!-- Fill in near the end. -->