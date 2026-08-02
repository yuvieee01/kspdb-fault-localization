# Project context: KSPDB fault localization system

Take-home assignment. Deadline: Aug 5, 2026, 6pm. Read this file first, every
session, before touching code.

## What this is
A system that ingests binary pole-liveness telemetry from a radial LV power
network, localizes faults to a specific span/DT/feeder, tickets them, and
auto-verifies restoration from telemetry. Full spec: `docs/DATA_CONTRACTS.md`
and `docs/ALGORITHM_SPEC.md`. Do not re-derive these from first principles —
they are the ground truth, taken directly from the assignment brief.

## Stack (locked — do not re-decide this)
- Backend: Node.js + TypeScript + Express
- ORM/DB: Prisma + PostgreSQL
- Frontend: React + Vite + Tailwind + MapLibre/Leaflet (free OSM tiles, no
  API key)
- Realtime: polling (5-10s interval), not WebSockets — deliberate choice to
  avoid proxy issues on free-tier deploy hosts
- Background/delayed jobs (simulator telemetry scheduling): in-process
  (setTimeout/node-cron), no separate queue service
- Deploy target: Railway or Render, whole stack via docker-compose

## Non-negotiables
1. `docker compose up` from a clean clone must ALWAYS work. If a change
   breaks it, fix it before doing anything else. This gates the entire
   submission (G2).
2. The app must be seeded on startup with a working synthetic network (G3) —
   no manual seed step.
3. Localization logic gets real tests. This is the highest-weighted part of
   the rubric (25%). Do not skip tests here to move faster on the frontend.
4. Never let an LLM/AI model perform the fault localization itself. The
   localization algorithm is a deterministic graph walk. AI is used
   elsewhere (see docs/ALGORITHM_SPEC.md, section "AI feature").
5. Every non-obvious decision or assumption gets a line in `DECISIONS.md`
   the same day it's made — not reconstructed later.
6. Match field names, event types, and schema shapes to
   `docs/DATA_CONTRACTS.md` exactly. Do not invent plausible-sounding
   alternatives.

## Build order (do not reorder)
1. Repo scaffold + docker-compose booting an empty stack (verify G2 works
   on hour one, before writing any real logic).
2. Prisma schema + migrations + seed script generating synthetic
   poles/transformers/feeders at correct proportions (~9% poles with no
   device, ~60% of DTs with no recorded topology).
3. Telemetry ingest endpoint, writing to the append-only event log.
4. Fault simulator (inject span/DT/feeder fault, inject noise, repair).
   Needed before the algorithm can be tested against anything.
5. Localization algorithm end to end, per `docs/ALGORITHM_SPEC.md`.
   Write tests alongside this, not after.
6. Frontend: map + incident list + ticket detail + simulator control tab.
7. AI incident-briefing feature, with graceful fallback if the model call
   fails.
8. Scheduled-outage suppression with tolerance window.
9. Deploy, fill out README/ARCHITECTURE/DEPLOYMENT docs, record demo video.

## Where things live
- `docs/DATA_CONTRACTS.md` — exact payload/schema specs from the brief.
- `docs/ALGORITHM_SPEC.md` — the localization algorithm, step by step.
- `README.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, `DECISIONS.md`,
  `AI-WORKFLOW.md` — graded deliverables, required at repo root, filled in
  incrementally as each part is built, not batched at the end.

- `SCOPE.md` — out-of-scope list, acceptance gates (G1-G6), evaluation
  weights, code quality expectations. Read this alongside this file, not
  just docs/DATA_CONTRACTS.md and docs/ALGORITHM_SPEC.md.

## Things the agent should flag to the human, not decide alone
- Anything affecting `DECISIONS.md` content (the human should write/edit
  these in their own words — they get asked to defend them on a follow-up
  call).
- Any change to the stack choices above.
- Any deviation from the field names/shapes in `docs/DATA_CONTRACTS.md`.