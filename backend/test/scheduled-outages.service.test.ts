import { OutageScope } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { findMatchingOutage } from "../src/scheduled-outages/service";

const outage = {
  id: "SO-test-001",
  scope: OutageScope.dt,
  target_id: "DT-1",
  start: new Date("2026-08-05T10:00:00.000Z"),
  end: new Date("2026-08-05T11:00:00.000Z"),
  reason: "Planned maintenance",
};
const target = { dtId: "DT-1", feederId: "F-1" };

describe("scheduled-outage tolerance", () => {
  it("suppresses during the ten-minute pre-window", () => {
    expect(findMatchingOutage([outage], target, new Date("2026-08-05T09:50:00.000Z"))?.id).toBe(outage.id);
    expect(findMatchingOutage([outage], target, new Date("2026-08-05T09:49:59.999Z"))).toBeNull();
  });

  it("suppresses during the planned outage window", () => {
    expect(findMatchingOutage([outage], target, new Date("2026-08-05T10:30:00.000Z"))?.id).toBe(outage.id);
  });

  it("re-escalates persistent darkness past the forty-minute late tolerance", () => {
    expect(findMatchingOutage([outage], target, new Date("2026-08-05T11:40:00.000Z"))?.id).toBe(outage.id);
    expect(findMatchingOutage([outage], target, new Date("2026-08-05T11:40:00.001Z"))).toBeNull();
  });
});
