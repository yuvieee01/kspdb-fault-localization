# Architecture

## Diagram
<!-- Mermaid or committed image. Pole device -> ingest -> localization ->
ticket -> operator screen. Must match what's actually built - update this
LAST, after the code is done, not first. -->

## Data sourcing and ingestion
<!-- How telemetry arrives (HTTPS endpoint, payload shape). How duplicates,
out-of-order messages, and clock skew (+/-90s) are handled. How bursts
(5,000 msgs/10s) are absorbed. Reference docs/DATA_CONTRACTS.md. -->

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