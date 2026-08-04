import { BriefingSource, Incident, IncidentDetail, NetworkData, SimulatedFault } from "./types";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error ?? `Request failed (${response.status})`, response.status);
  return data;
}

export const api = {
  network: () => request<NetworkData>("/api/network"),
  incidents: () => request<{ incidents: Incident[] }>("/api/incidents"),
  incident: (id: number) => request<{ incident: IncidentDetail }>(`/api/incidents/${id}`),
  briefing: (id: number) => request<{ briefing: string; source: BriefingSource; cached: boolean }>(`/api/incidents/${id}/briefing`, { method: "POST" }),
  resolve: (id: number) => request<{ incident: Incident }>(`/api/incidents/${id}/resolve`, { method: "POST" }),
  simulatorStatus: () => request<{ active_faults: SimulatedFault[] }>("/api/simulator/status"),
  injectFault: (type: "span" | "dt" | "feeder", target_id: string) =>
    request("/api/simulator/fault", { method: "POST", body: JSON.stringify({ type, target_id }) }),
  simulateScheduledOutage: (scope: "dt" | "feeder", target_id: string) =>
    request("/api/simulator/scheduled-outage", { method: "POST", body: JSON.stringify({ scope, target_id }) }),
  repairFault: (fault_id: string) => request("/api/simulator/repair", { method: "POST", body: JSON.stringify({ fault_id }) }),
  injectNoise: (type: "duplicate" | "out_of_order" | "stale_late", target_pole_id: string) =>
    request("/api/simulator/noise", { method: "POST", body: JSON.stringify({ type, target_pole_id }) }),
  heartbeatAll: () => request("/api/simulator/heartbeat-all", { method: "POST", body: "{}" }),
  runLocalization: () => request("/api/localization/run", { method: "POST", body: "{}" }),
};
