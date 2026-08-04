import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Incident, IncidentDetail } from "../types";

const statusStyle: Record<Incident["status"], string> = {
  active: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  suppressed: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  verified: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  resolved: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
};

function ScopeLabel({ type }: { type: Incident["type"] }) {
  return <span>{type === "dt" ? "DT" : type === "feeder" ? "Feeder" : "Span"}</span>;
}

interface Props {
  incidents: Incident[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onChanged: () => void;
}

export function IncidentPanel({ incidents, selectedId, onSelect, onChanged }: Props) {
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [message, setMessage] = useState<string>("");
  const selected = incidents.find((incident) => incident.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    api.incident(selectedId).then(({ incident }) => setDetail(incident)).catch((error: Error) => setMessage(error.message));
  }, [selectedId, incidents]);

  async function resolve() {
    if (!detail) return;
    try {
      await api.resolve(detail.id);
      setMessage("Ticket marked resolved.");
      onChanged();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Could not resolve ticket.");
    }
  }

  return (
    <section className="grid min-h-[58vh] grid-cols-1 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 lg:grid-cols-[minmax(260px,0.8fr)_minmax(320px,1.2fr)]">
      <div className="border-b border-slate-700 lg:border-b-0 lg:border-r">
        <div className="border-b border-slate-700 px-4 py-3">
          <h2 className="font-semibold text-white">Incident tickets</h2>
          <p className="text-xs text-slate-400">{incidents.filter((item) => item.status === "active").length} active · newest first</p>
        </div>
        <div className="max-h-[48vh] overflow-y-auto">
          {incidents.length === 0 ? <p className="p-5 text-sm text-slate-400">No tickets yet.</p> : incidents.map((incident) => (
            <button
              key={incident.id}
              onClick={() => onSelect(incident.id)}
              className={`w-full border-b border-slate-800 px-4 py-3 text-left transition ${selectedId === incident.id ? "bg-slate-800" : "hover:bg-slate-800/60"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-white"><ScopeLabel type={incident.type} /> #{incident.id}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ${statusStyle[incident.status]}`}>{incident.status}</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{incident.dt_id ?? incident.feeder_id} · {(incident.confidence * 100).toFixed(0)}% confidence</p>
              <p className="mt-1 text-xs text-slate-500">{incident.affected_pole_count} affected poles · PIN {incident.pin_code}</p>
            </button>
          ))}
        </div>
      </div>
      <div className="p-5">
        {!selected || !detail ? <p className="text-sm text-slate-400">Select a ticket to inspect the location and evidence.</p> : <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">{detail.type} fault</p>
              <h2 className="mt-1 text-xl font-bold text-white">{detail.first_dark_pole_id ?? detail.dt_id ?? detail.feeder_id}</h2>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ring-1 ${statusStyle[detail.status]}`}>{detail.status}</span>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <Info label="Boundary" value={detail.boundary_pole_id ?? "DT / feeder root"} />
            <Info label="Affected" value={`${detail.affected_pole_count} poles`} />
            <Info label="Confidence" value={`${(detail.confidence * 100).toFixed(1)}%`} />
            <Info label="Topology confidence" value={`${(detail.topology_confidence * 100).toFixed(1)}%`} />
            <Info label="Crew PIN" value={detail.pin_code} />
            <Info label="Scope" value={detail.dt_id ?? detail.feeder_id} />
          </dl>
          <div className="mt-5 rounded-lg bg-slate-800 p-3 text-sm text-slate-300">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Root-cause evidence</p>
            <p className="mt-1">{detail.confidence_reason}</p>
          </div>
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Affected assets</p>
            <div className="mt-2 max-h-28 overflow-y-auto rounded-lg border border-slate-700">
              {detail.affected_assets.map((asset) => <div key={asset.pole_id} className="flex justify-between border-b border-slate-800 px-3 py-2 text-xs last:border-0"><span className="text-slate-200">{asset.pole_id}</span><span className={asset.effective_status === "dark" ? "text-rose-300" : "text-slate-400"}>{asset.effective_status}</span></div>)}
            </div>
          </div>
          {detail.status === "active" && <button onClick={resolve} className="mt-5 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400">Mark resolved</button>}
          {message && <p className={`mt-3 text-sm ${message.startsWith("Cannot") ? "text-rose-300" : "text-emerald-300"}`}>{message}</p>}
        </>}
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-800 px-3 py-2"><dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt><dd className="mt-1 truncate font-medium text-slate-200">{value}</dd></div>;
}
