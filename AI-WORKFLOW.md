# AI workflow

## Tools used, and for what

Codex (GPT-5) was used as a paired implementation and review tool: it inspected
the supplied data-contract/algorithm documents, scaffolded TypeScript/React
changes, generated focused Vitest fixtures, ran compose and API checks, and
performed browser-based UI verification. The human supplied the build order,
review constraints, acceptance criteria, and final product decisions. No AI
model was used to perform fault localization at runtime.

Anthropic is optional product infrastructure, not a development dependency:
when configured, it turns already-fixed incident metadata into a dispatcher
briefing. Its prompt prohibits changing localization facts and its failure path
is deterministic.

## Delegated wholesale vs written/reviewed by hand

AI assistance produced much of the mechanical implementation: Express routes,
Prisma query wiring, React component plumbing, test skeletons, and initial
documentation drafts. The human-directed parts were the deterministic
algorithm boundaries, API/data-contract conformance, simulator realism,
acceptance checks, and every decision that affects operational semantics. Each
AI-authored change was compiled, exercised through tests, and checked against
the real simulator before it was accepted.

## Cases where the AI was wrong or misleading

1. **Simulator leaked ground truth into `PoleState`.** An early simulator
   implementation directly made firmware-1.2 silent devices dark in derived
   state. Those devices emit no loss event, so this handed the localization
   algorithm the answer. Comparing `telemetry_events` with `pole_states`
   exposed the contradiction. The direct write was removed; silent devices now
   remain a telemetry-inference problem.

2. **Noise bypassed the production ingest path.** Duplicate, out-of-order, and
   stale-late scenarios initially wrote a plausible `telemetry_events` end
   state directly. That did not test sequence deduplication at all. Review of
   `simulator.ts` caught it; all noise now calls the same ingest function as
   `POST /api/telemetry`, and tests/API responses show accept versus reject.

3. **A suppressed outage could stay suppressed forever.** The first outage
   persistence flow checked for an existing incident before reconsidering
   whether the outage had passed `end + 40 min`. That could hide a
   cancelled/stale outage feed. Code review caught the ordering issue. The
   engine now re-evaluates the schedule first and promotes the existing record
   to `active` when persistent darkness is beyond tolerance.

## Roughly how much of the final code is AI-generated

Approximately 70–80% of implementation text was AI-assisted, mostly
boilerplate and integration code. The value of the work was the human-directed
constraints and repeated verification: tests, database inspection, real
simulator traffic, compose rebuilds, and correction of the three issues above.

## Best prompts / session excerpts

- “Confirm whether simulator noise reaches the same ingest function as
  `POST /api/telemetry`; if not, route it through the real code path and show
  accepted/rejected responses.” This converted an end-state test into a real
  behavioral test.
- “Implement localization exactly as the reviewed BFS/MST design; AI must not
  alter boundaries.” This kept the graph walk deterministic and auditable.
- “Treat an LLM only as a summarizer of an existing incident; always return a
  deterministic fallback.” This produced a safe operational AI boundary.
