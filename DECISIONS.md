# Decisions

Newest first. One entry per meaningful decision or assumption: what was
chosen, what was rejected, and why. Add entries the day the decision is
made - do not reconstruct this from memory later.

<!--
## <date> - <short title>
Chosen: ...
Rejected: ... (and why)
Assumption (if brief was ambiguous here): ...
-->

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

## Missing topology (the 60% case)
<!-- Fill in once implemented: MST-based geometric inference, confidence
scoring, what the UI shows differently for inferred vs recorded topology. -->

---

## What's currently known-broken or fragile
<!-- Keep an honest running list. Update continuously. -->

## What would be done with two more weeks
<!-- Fill in near the end. -->