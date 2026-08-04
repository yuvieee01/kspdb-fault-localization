export type EffectiveStatus = "live" | "dark" | "stale" | "unknown";
export type IncidentStatus = "active" | "suppressed" | "verified" | "resolved";
export type IncidentType = "span" | "dt" | "feeder";
export type BriefingSource = "ai" | "fallback";

export interface Pole {
  pole_id: string;
  lat: number;
  lon: number;
  feeder_id: string;
  dt_id: string;
  device_id: string | null;
  effective_status: EffectiveStatus;
}

export interface Transformer {
  dt_id: string;
  feeder_id: string;
  lat: number;
  lon: number;
}

export interface TopologyEdge {
  dt_id: string;
  parent_pole_id: string;
  child_pole_id: string;
  source: "recorded" | "inferred";
  confidence: number;
}

export interface Incident {
  id: number;
  type: IncidentType;
  status: IncidentStatus;
  feeder_id: string;
  dt_id: string | null;
  boundary_pole_id: string | null;
  first_dark_pole_id: string | null;
  confidence: number;
  confidence_reason: string;
  pin_code: string;
  affected_pole_count: number;
  ai_briefing: string | null;
  briefing_source: BriefingSource | null;
  suppression_outage_id: string | null;
  created_at: string;
  updated_at: string;
  verified_at: string | null;
  incident_poles: string[];
}

export interface IncidentDetail extends Incident {
  topology_confidence: number;
  topology_source: "recorded" | "inferred" | "mixed" | "root-level";
  affected_assets: Array<{
    pole_id: string;
    device_id: string | null;
    energized: boolean | null;
    effective_status: EffectiveStatus;
  }>;
}

export interface NetworkData {
  poles: Pole[];
  transformers: Transformer[];
  topology_edges: TopologyEdge[];
  active_incidents: Incident[];
}

export interface SimulatedFault {
  fault_id: string;
  type: "span" | "dt" | "feeder";
  target_id: string;
  affected_pole_count: number;
  created_at: string;
  simulation_kind: "fault" | "scheduled_outage";
  scheduled_outage_id: string | null;
}
