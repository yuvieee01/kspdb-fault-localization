import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from "react-leaflet";
import { Incident, NetworkData } from "../types";

const statusColor = {
  live: "#22c55e",
  dark: "#ef4444",
  stale: "#f59e0b",
  unknown: "#64748b",
};

interface Props {
  network: NetworkData | null;
  selectedIncident: Incident | null;
}

export function NetworkMap({ network, selectedIncident }: Props) {
  const center: [number, number] = network?.transformers.length
    ? [network.transformers[0].lat, network.transformers[0].lon]
    : [12.9716, 77.5946];
  const poles = network?.poles ?? [];
  const poleById = new Map(poles.map((pole) => [pole.pole_id, pole]));
  const affected = new Set(selectedIncident?.incident_poles ?? []);

  return (
    <div className="h-[58vh] min-h-[460px] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
      <MapContainer center={center} zoom={14} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {(network?.topology_edges ?? []).map((edge) => {
          const parent = poleById.get(edge.parent_pole_id);
          const child = poleById.get(edge.child_pole_id);
          if (!parent || !child) return null;
          const isBoundary =
            selectedIncident?.boundary_pole_id === edge.parent_pole_id &&
            selectedIncident?.first_dark_pole_id === edge.child_pole_id;
          return (
            <Polyline
              key={`${edge.dt_id}-${edge.child_pole_id}`}
              positions={[[parent.lat, parent.lon], [child.lat, child.lon]]}
              pathOptions={{
                color: isBoundary ? "#f43f5e" : edge.source === "inferred" ? "#64748b" : "#94a3b8",
                weight: isBoundary ? 5 : 1,
                opacity: isBoundary ? 1 : 0.45,
                dashArray: edge.source === "inferred" ? "4 6" : undefined,
              }}
            />
          );
        })}
        {poles.map((pole) => (
          <CircleMarker
            key={pole.pole_id}
            center={[pole.lat, pole.lon]}
            radius={affected.has(pole.pole_id) ? 6 : 3}
            pathOptions={{
              color: affected.has(pole.pole_id) ? "#f43f5e" : "#0f172a",
              fillColor: statusColor[pole.effective_status],
              fillOpacity: 0.95,
              weight: affected.has(pole.pole_id) ? 2 : 0.5,
            }}
          >
            <Tooltip direction="top" offset={[0, -4]}>
              <span className="font-medium">{pole.pole_id}</span><br />
              {pole.effective_status} · {pole.dt_id}
            </Tooltip>
          </CircleMarker>
        ))}
        {(network?.transformers ?? []).map((transformer) => (
          <CircleMarker
            key={transformer.dt_id}
            center={[transformer.lat, transformer.lon]}
            radius={7}
            pathOptions={{ color: "#f8fafc", fillColor: "#2563eb", fillOpacity: 1, weight: 2 }}
          >
            <Tooltip>{transformer.dt_id} · transformer</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

export const statusLegend = [
  ["live", "Live"],
  ["dark", "Dark"],
  ["stale", "Stale"],
  ["unknown", "Unknown"],
] as const;

export { statusColor };
