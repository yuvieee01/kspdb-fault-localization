import { describe, expect, it } from "vitest";
import { findBoundaryIncidents } from "../src/localization/engine";
import { buildInferredTopology } from "../src/localization/topology";
import { EffectivePoleStatus, LocalTopologyEdge } from "../src/localization/types";

function recordedEdges(rows: Array<[string, string]>): LocalTopologyEdge[] {
  return rows.map(([parent_pole_id, child_pole_id]) => ({
    dt_id: "DT-1",
    parent_pole_id,
    child_pole_id,
    source: "recorded",
    confidence: 1,
    distance_m: null,
  }));
}

function statuses(values: Record<string, EffectivePoleStatus>) {
  return new Map(Object.entries(values));
}

describe("localization boundary walk", () => {
  it("locates a span fault at the recorded live/dark boundary", () => {
    const result = findBoundaryIncidents(
      "DT-1",
      "F-1",
      recordedEdges([["DT-1", "P-1"], ["P-1", "P-2"], ["P-2", "P-3"]]),
      statuses({ "P-1": "live", "P-2": "dark", "P-3": "dark" })
    );

    expect(result.deviceHealth).toEqual([]);
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0]).toMatchObject({
      boundary_pole_id: "P-1",
      first_dark_pole_id: "P-2",
      affected_pole_ids: ["P-2", "P-3"],
    });
  });

  it("builds a reasonable Prim MST for a DT without recorded topology", () => {
    const edges = buildInferredTopology(
      "DT-1",
      { id: "DT-1", lat: 12.0, lon: 77.0 },
      [
        { id: "P-1", lat: 12.0001, lon: 77.0 },
        { id: "P-2", lat: 12.0002, lon: 77.0 },
        { id: "P-3", lat: 12.0003, lon: 77.0 },
      ]
    );

    expect(edges).toHaveLength(3);
    expect(edges.map((edge) => [edge.parent_pole_id, edge.child_pole_id])).toEqual([
      ["DT-1", "P-1"],
      ["P-1", "P-2"],
      ["P-2", "P-3"],
    ]);
    expect(edges.every((edge) => edge.source === "inferred" && edge.confidence >= 0.3 && edge.confidence <= 0.95)).toBe(true);
  });

  it("classifies an isolated dark pole with live children as device health", () => {
    const result = findBoundaryIncidents(
      "DT-1",
      "F-1",
      recordedEdges([["DT-1", "P-1"], ["P-1", "P-2"]]),
      statuses({ "P-1": "dark", "P-2": "live" })
    );

    expect(result.incidents).toEqual([]);
    expect(result.deviceHealth).toEqual([
      expect.objectContaining({ pole_id: "P-1", status: "dark" }),
    ]);
  });

  it("keeps two simultaneous dark subtrees on one DT as separate incidents", () => {
    const result = findBoundaryIncidents(
      "DT-1",
      "F-1",
      recordedEdges([
        ["DT-1", "P-1"],
        ["P-1", "P-2"],
        ["P-2", "P-5"],
        ["DT-1", "P-3"],
        ["P-3", "P-4"],
        ["P-4", "P-6"],
      ]),
      statuses({
        "P-1": "live",
        "P-2": "dark",
        "P-3": "live",
        "P-4": "stale",
        "P-5": "dark",
        "P-6": "stale",
      })
    );

    expect(result.incidents).toHaveLength(2);
    expect(result.incidents.map((incident) => incident.first_dark_pole_id).sort()).toEqual(["P-2", "P-4"]);
  });
});
