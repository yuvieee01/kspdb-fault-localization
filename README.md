# KSPDB fault localization system

KSPDB ingests binary liveness telemetry from a synthetic low-voltage power
network, deterministically localizes span/DT/feeder outages, and presents
dispatchable tickets on an operator map. It includes a realistic fault and
telemetry-noise simulator, topology inference for assets without surveyed line
order, scheduled-outage suppression, restoration verification, and an optional
AI-generated incident briefing with a deterministic fallback.

## One-command start

```bash
git clone https://github.com/yuvieee01/kspdb-fault-localization.git
cd kspdb-fault-localization
docker compose up
```

No separate migration, database seed, or frontend command is required. Open
<http://localhost:5173>; the backend health endpoint is
<http://localhost:4000/api/health>. The first boot seeds a usable synthetic
network. Later restarts preserve a non-empty database.

## Public URL

Deployment URL: [KSPDB-fault-localization](https://kspdb-fault-localization-0nzp.onrender.com/)

## Demo video

Demo video: **TBD — add the final unlisted video link here.**

## Documentation map

- [Architecture](ARCHITECTURE.md) — data flow, storage, deterministic
  localization, API surface, UI, and AI boundary.
- [Deployment](DEPLOYMENT.md) — local and Render setup, environment variables,
  verification, and real troubleshooting notes.
- [AI workflow](AI-WORKFLOW.md) — how AI assistance was used and audited.
- [Decisions](DECISIONS.md) — human-authored trade-offs and known limitations.
- [Data contracts](docs/DATA_CONTRACTS.md) and
  [algorithm specification](docs/ALGORITHM_SPEC.md) — assignment ground truth.
