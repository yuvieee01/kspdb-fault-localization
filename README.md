# KSPDB fault localization system

<!-- One-paragraph plain description: what this system does, for a reviewer
who has 45 minutes and has never seen the code. -->

## What it does
<!-- 3-5 sentences. Fault occurs -> telemetry -> localized ticket -> operator
sees it -> crew fixes -> auto-verified. -->

## Quick start
```bash
git clone <repo-url>
cd fault_localization
docker compose up
```
<!-- Confirm: no manual migration step, no hand-edited config, nothing else
started separately. If this isn't true yet, this doc is lying - fix the
compose file, not this section. -->

## Public URL
<!-- Live deployed link. Note here if the host cold-starts, so the reviewer
waits instead of assuming it's broken. -->

## Demo video
<!-- Link (Loom/YouTube unlisted/Drive). 5 minutes: fault injected, detected,
localized, ticketed, repaired, auto-verified. -->

## Documentation map
- `ARCHITECTURE.md` - how it works, the localization algorithm, the AI feature
- `DEPLOYMENT.md` - how to run it, env vars, troubleshooting
- `DECISIONS.md` - what was chosen/rejected and why, assumptions, known gaps
- `AI-WORKFLOW.md` - how AI tools were used to build this
- `docs/DATA_CONTRACTS.md`, `docs/ALGORITHM_SPEC.md` - implementation specs