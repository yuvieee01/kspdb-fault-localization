export type EffectivePoleStatus = "live" | "dark" | "stale" | "unknown";

export interface TopologyNode {
  id: string;
  lat: number;
  lon: number;
}

export interface LocalTopologyEdge {
  dt_id: string;
  parent_pole_id: string;
  child_pole_id: string;
  source: "recorded" | "inferred";
  confidence: number;
  distance_m: number | null;
}

export interface PoleForLocalization {
  pole_id: string;
  device_id: string | null;
  feeder_id: string;
  pole_state: {
    energized: boolean;
    last_event: string | null;
    last_seen_at: Date | null;
  } | null;
}

export interface DetectedIncident {
  type: "span" | "dt" | "feeder";
  dt_id: string | null;
  feeder_id: string;
  boundary_pole_id: string | null;
  first_dark_pole_id: string | null;
  affected_pole_ids: string[];
  boundary_edge: LocalTopologyEdge | null;
  topology_path: LocalTopologyEdge[];
}

export interface DeviceHealthFinding {
  pole_id: string;
  dt_id: string;
  feeder_id: string;
  status: "dark" | "stale";
  reason: string;
}

export interface BoundaryWalkResult {
  incidents: DetectedIncident[];
  deviceHealth: DeviceHealthFinding[];
}

export interface ScoredIncident extends DetectedIncident {
  confidence: number;
  confidence_reason: string;
}
