# Localization algorithm spec

This is the highest-weighted part of the assignment (25% of score). Implement
exactly this logic; don't simplify away the 60%-missing-topology handling or
the dead-sensor distinction — both are explicitly graded.

## Physical model (why this algorithm works)
The network is a strict tree: substation -> feeder -> DT -> LT line of poles
(with branches). No loops. A fault occurs on an EDGE (a span between two
poles, or at the DT/feeder itself). Sensors only report on NODES (pole
liveness). The signature of a span fault is a live/dark BOUNDARY: the last
live pole and the first dark pole beyond it — everything downstream of that
edge is dark, everything upstream stays live.

## Step 1 — Debounce raw events into pole state
Do not act on a single raw telemetry event immediately. Hold each pole in a
`stale` state for a debounce window (~90s, matching the documented clock
skew bound) before committing a state transition to `dark` or `live`. This
absorbs late arrivals, duplicates, and out-of-order messages. Ordering and
dedup within one device use `seq`, not `ts` (ts is not trustworthy for
ordering across devices).

## Step 2 — Distinguish real outage from dead sensor
A pole is marked `offline_ambiguous`, NOT `dark`, when it stops
heartbeating/reporting but no `power_lost` was received (covers: firmware
1.2.x devices, which never send power_lost; the ~30% of dying messages that
never arrive even on firmware >= 1.3).

Resolve the ambiguity using the tree structure once neighbor state is known:
- If a pole is offline_ambiguous but its known DOWNSTREAM children are still
  reporting live, this is physically impossible as a real outage (power
  can't skip a pole and re-appear downstream). Classify it as a dead sensor
  / device health issue, NOT a fault.
- If a pole is offline_ambiguous and its downstream children are also
  dark/offline, treat it as part of the same dark subtree as its children —
  fold it into whatever incident that subtree produces.
- A single isolated dark pole with no dark descendants and live children is
  ALWAYS a sensor fault, never a line fault. Route it to a separate "device
  health" list, not the incident/ticket list.

## Step 3 — Build or infer topology, per DT
For each DT, build a rooted tree (root = the DT itself):

- **Recorded case (~40% of DTs)**: build directly from `parent_pole_id` /
  `seq_on_line`. Edge confidence = 1.0.
- **Inferred case (~60% of DTs, seq_on_line/parent_pole_id null)**: compute
  a minimum spanning tree over that DT's poles using Haversine distance
  between GPS coordinates, with the DT's own coordinates forced as the root.
  (Prim's algorithm starting from the DT node is the simplest correct
  implementation.) Assign each inferred edge a confidence score inversely
  related to how much closer the chosen parent was vs. the second-nearest
  candidate parent (a clear geometric winner = high confidence; a close
  call between two similarly-distant poles = low confidence).

Store both recorded and inferred edges in a topology table tagged with
`source` (recorded|inferred) and `confidence`, so the UI can render them
differently (solid vs dashed line on the map) and so re-computation doesn't
require re-deriving from scratch each time.

Known failure mode to document, not hide: geometric MST inference will be
wrong wherever the true physical line deviates from straight-line proximity
(routing around a building, a lake, a road) such that the nearest pole by
GPS isn't the actual electrically-adjacent one. State this in
ARCHITECTURE.md as the named limitation of the 60% case.

## Step 4 — Find the frontier / boundary
For each DT's tree (recorded or inferred), do a breadth-first walk from the
root (DT). At each edge, check parent state vs child state:
- parent = live, child = dark -> this edge is a boundary. Everything in the
  child's subtree that is also dark belongs to ONE incident rooted at this
  edge.
- Multiple disjoint dark subtrees under the same DT -> multiple separate
  incidents (this is how simultaneous faults on the same line are kept
  separate rather than merged).
- If the DT node itself is effectively dark with no live pole beneath it at
  all -> classify as a DT-level fault (root cause is the transformer/HT
  fuse), not a span fault.
- If ALL DTs on a feeder show this pattern simultaneously -> classify as a
  feeder-level fault.

This single walk naturally produces: span faults (boundary partway down a
line), DT faults (root-level), feeder faults (cross-DT pattern), and correct
separation of multiple simultaneous faults (each disjoint dark subtree =
its own incident, so N independent snapped wires produce N tickets, not 1
and not 40).

## Step 5 — Compute confidence
```
confidence = topology_confidence x sensor_coverage x corroboration
```
- topology_confidence: 1.0 if all edges on the path to the boundary are
  recorded; the minimum inferred-edge confidence along that path otherwise.
- sensor_coverage: fraction of poles in the affected subtree that actually
  have a device fitted (a subtree with many no-device poles is a less
  certain incident boundary/extent).
- corroboration: 1.0 if an explicit power_lost was received from at least
  one pole in the subtree; lower (e.g. 0.6) if the incident is inferred
  purely from heartbeat silence (firmware 1.2 case, or missed dying
  message).

Store a short human-readable `confidence_reason` string alongside the
number (e.g. "boundary falls on an inferred-topology edge; low geometric
confidence" or "no explicit power_lost received, inferred from silence").
This is what the UI and the AI briefing feature both read from.

## Step 6 — Cross-check against scheduled outages
Before creating a ticket, check the scheduled-outage feed for the affected
dt_id/feeder_id. Use a tolerance window of (start - 10min) to (end + 40min),
not the literal stated window, since overruns of 20-40 min are routine.
If the dark pattern is within this tolerated window and matches the
scheduled scope, suppress ticket creation but still show it in the UI
tagged "expected (scheduled outage)" — visible, not silently dropped.
If poles are STILL dark more than ~30 minutes past the tolerance window's
end, escalate to a real ticket even though a schedule technically covers
it (handles the ~1-in-10 stale/cancelled-feed case).

## Step 7 — Auto-verify restoration
When every pole in an incident's affected set reports power_restored (or
re-establishes heartbeat) within the debounce window, automatically
transition the ticket to `verified` — no manual click required.
If a human marks a ticket `resolved` while telemetry still shows any
affected pole dark, reject the transition and surface a clear warning in
the UI rather than silently accepting it.

## Complexity
Each new telemetry event triggers a localized re-walk of only the affected
pole's DT subtree — O(poles in that DT), not O(whole network). At the given
scale (max ~240 poles per DT) this is trivial; measure actual latency and
report it against the <120s p95 target rather than assuming it's fine.

## AI feature (kept separate from localization — do not let a model do the
## graph walk above)
After an incident is created, one LLM call generates a plain-language
briefing string from the structured incident fields (type, dt/feeder,
affected pole count, confidence, confidence_reason). Cache the result on
the incident row — do not regenerate on every poll. If the call fails or
times out, the UI falls back to showing the raw structured fields; nothing
blocks on this call. This is the one AI-shaped feature in the product;
justify it in ARCHITECTURE.md (what/why here/cost per call/fallback
behavior).

## Tests to write (minimum bar for the 5% engineering-craft score)
- Known recorded-topology fixture + injected span fault -> exactly the
  expected boundary and affected-pole set.
- Known inferred-topology (MST) fixture + injected span fault -> boundary
  found, confidence reflects inferred-edge uncertainty.
- Isolated dark pole with live children -> classified as device health, not
  an incident.
- Two simultaneous span faults on the same DT -> two separate incidents,
  not one merged or one split into more than two.
- Scheduled outage within tolerance window -> suppressed; same pattern
  outside tolerance window -> ticket created.
- Full restore telemetry -> incident auto-verifies without manual action.
- Manual "resolved" while poles still dark -> rejected.