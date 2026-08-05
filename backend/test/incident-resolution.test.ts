import { describe, expect, it } from "vitest";
import { findDeenergizedAffectedPoleIds } from "../src/incidents/resolution";

describe("guarded incident resolution", () => {
  const now = new Date("2026-08-05T12:00:00.000Z");

  it("rejects manual resolution when any affected pole is de-energized", () => {
    const darkPoleIds = findDeenergizedAffectedPoleIds([
      { pole_id: "P-LIVE", pole: { pole_state: { energized: true, last_event: "heartbeat", last_seen_at: now } } },
      { pole_id: "P-DARK", pole: { pole_state: { energized: false, last_event: "power_lost", last_seen_at: now } } },
    ], now);

    expect(darkPoleIds).toEqual(["P-DARK"]);
  });

  it("allows resolution when all affected poles remain energized", () => {
    const darkPoleIds = findDeenergizedAffectedPoleIds([
      { pole_id: "P-LIVE", pole: { pole_state: { energized: true, last_event: "heartbeat", last_seen_at: now } } },
    ], now);

    expect(darkPoleIds).toEqual([]);
  });
});
