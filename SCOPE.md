# Scope, gates, and evaluation priorities

Read alongside AGENTS.md. This file exists so the agent knows the
boundaries of the assignment, not just the technical spec.

## Explicitly out of scope — do not build these
Building any of these instead of/alongside the core is scored as a
scoping failure, not bonus credit:
- Crew routing, vehicle allocation, or scheduling optimization
- Real authentication, SSO, or role-based permissions (a hardcoded/stubbed
  operator identity is sufficient — do not spend time on real auth)
- A mobile app
- Any actual hardware or firmware integration
- Historical analytics, reporting, or predictive maintenance features
- Handling more than one city subdivision / multi-tenancy

If a task seems to require one of these, stop and flag it rather than
building a version of it.

## Acceptance gates (pass/fail — everything else is unscored if these fail)
- **G1** Public GitHub repo, clonable with no access grant.
- **G2** `git clone <repo> && cd <repo> && docker compose up` brings up the
  entire stack (backend, frontend, database, everything) with zero manual
  steps — no migrations run by hand, no config hand-edited, no services
  started separately. This is the single most protected requirement in the
  whole build — never merge/leave a change that breaks it.
- **G3** App is seeded on startup with a usable synthetic network — a
  reviewer must see a working system immediately, not an empty screen.
- **G4** Public URL, opens in a browser with no account, invite, VPN, or
  API key of the reviewer's own. Free-tier cold start is fine if noted in
  README.
- **G5** The fault simulator is runnable from the public URL or one
  documented command, and injecting a fault visibly produces a localized
  ticket end to end.
- **G6** A 5-minute demo video showing: fault injected, detected,
  localized, ticketed, repaired, auto-verified.

## Where effort should go (evaluation weights)
| Weight | Category |
|---|---|
| 25% | Fault localization correctness (boundary detection, grouping, simultaneous faults, the 60%-missing-topology case, robustness to messy telemetry, honest confidence) |
| 20% | Product judgment (right problem solved, false positives taken seriously, AI feature placement defensible) |
| 20% | Architecture and data design (ingestion survives load, topology representation, schema, API design) |
| 15% | Operator experience (usable by a non-engineer, map+list working together, ambiguity communicated clearly) |
| 15% | Documentation and reproducibility (runs and is understandable without the author present) |
| 5% | Engineering craft and AI leverage (tests on the logic that matters, real commit history) |

If forced to choose where to spend limited remaining time, prioritize in
this order: localization correctness > reproducibility (docker compose
never breaks) > noise handling / false-positive story > operator UI >
everything else.

## Code quality expectations
- **No secrets committed, ever** — not even temporarily, not even in a
  since-removed commit. If a `.env` or key gets committed, treat it as a
  blocking issue and rewrite history or rotate the credential immediately.
- **Real incremental commits with meaningful messages.** Never squash the
  whole build into one commit — commit history is itself evidence of how
  the work was done.
- **Tests specifically on localization logic** (given fixture topology +
  injected fault -> expected span/DT/feeder result). Broad
  controller/component test coverage is not the priority — depth on
  localization matters more than breadth elsewhere.
- Consistent formatting; run a linter, don't just configure one.

## Self-check before considering any step "done"
Adapted from the brief's own pre-submission checklist — treat these as
acceptance criteria for the relevant build steps, not just a final pass:
- Injecting a span fault produces exactly one ticket, correctly located,
  with a PIN code.
- Injecting three simultaneous faults produces three tickets — not one,
  not thirty.
- Killing a device's telemetry with power still on does NOT produce a
  fault ticket.
- Running a scheduled outage does NOT produce a fault ticket.
- Repairing a fault auto-verifies the ticket from telemetry, without a
  manual "resolved" click.
- Marking a ticket resolved while poles are still dark is rejected by the
  system, visibly.