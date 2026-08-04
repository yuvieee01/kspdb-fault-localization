# AI workflow

How this was actually built - fill in honestly as you go, not retroactively.

## Tools used, and for what
<!-- e.g. Claude (chat) for planning/spec docs, Claude/Antigravity agent for
implementation, etc. -->

## Delegated wholesale vs written by hand
<!-- What you let the agent fully own, what you wrote yourself, and why you
drew the line there. -->

## Cases where the AI was wrong or misleading
<!-- 2-3 concrete examples: what it produced, why it was wrong, how you
caught it, what you did instead. This is the section they weight most -
generic answers here read as not having actually reviewed the code. -->

1. **Simulator leaking ground truth into PoleState.** When building the
   fault simulator, the agent's first implementation directly updated
   PoleState.energized for firmware-1.2.x poles during a fault, even
   though those devices produce zero telemetry when they lose power in
   reality. This wasn't obviously wrong from the API response alone -
   the fault injection endpoint reported sensible-looking stats. I caught
   it by manually querying telemetry_events after a fault and noticing
   it was empty for those specific poles, while PoleState already
   showed them as dark. That's a contradiction: nothing had told the
   system those poles lost power, yet the system "knew" anyway. Flagged
   it, and the agent correctly identified the root cause (a leftover
   direct DB write that bypassed the real ingest pipeline) and removed
   it, re-verifying with a before/after query showing PoleState now
   correctly stays stale for silent devices.

2. **Simulator bypassing real ingest logic for noise tests.** The
   duplicate/out-of-order/stale-late noise endpoints in simulator.ts
   inserted rows directly into telemetry_events instead of calling the
   real POST /api/telemetry ingest path. Tests "passed" because the
   simulator constructed an already-correct end state, not because the
   dedup logic was actually exercised - a real bug in the ingest
   handler would never have been caught. Fixed by routing all simulator
   noise events through the same shared validation/dedup/write function
   as the real endpoint, then re-verified with actual HTTP responses
   showing accept/reject decisions per event.

3.

## Roughly how much of the final code is AI-generated
<!-- Honest estimate. Not scored directly, but dishonesty here is obvious
on the follow-up call. -->

## Best prompts / session excerpts
<!-- The ones you're proud of, or that saved real time. -->