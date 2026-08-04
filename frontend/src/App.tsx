import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { IncidentPanel } from "./components/IncidentPanel";
import { NetworkMap, statusColor, statusLegend } from "./components/NetworkMap";
import { SimulatorPanel } from "./components/SimulatorPanel";
import { Incident, NetworkData, SimulatedFault } from "./types";

function App() {
  const [network, setNetwork] = useState<NetworkData | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [faults, setFaults] = useState<SimulatedFault[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<"operations" | "simulator">("operations");
  const [error, setError] = useState<string>("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextNetwork, nextIncidents, nextFaults] = await Promise.all([
        api.network(), api.incidents(), api.simulatorStatus(),
      ]);
      setNetwork(nextNetwork);
      setIncidents(nextIncidents.incidents);
      setFaults(nextFaults.active_faults);
      setSelectedId((current) => current ?? nextIncidents.incidents[0]?.id ?? null);
      setLastUpdated(new Date());
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to reach the backend.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const selectedIncident = useMemo(
    () => incidents.find((incident) => incident.id === selectedId) ?? null,
    [incidents, selectedId]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/90 px-5 py-4 backdrop-blur lg:px-8">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-300">KSPDB operations</p><h1 className="mt-1 text-xl font-bold text-white">Fault localization console</h1></div>
          <div className="flex items-center gap-3 text-xs text-slate-400"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Polling every 5s {lastUpdated && `· updated ${lastUpdated.toLocaleTimeString()}`}</div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-5 py-6 lg:px-8">
        <nav className="mb-6 flex gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1"><TabButton active={tab === "operations"} onClick={() => setTab("operations")}>Network & tickets</TabButton><TabButton active={tab === "simulator"} onClick={() => setTab("simulator")}>Simulator</TabButton></nav>
        {error && <div className="mb-5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
        {tab === "operations" ? <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-3 text-xs text-slate-300">{statusLegend.map(([status, label]) => <span key={status} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: statusColor[status] }} />{label}</span>)}<span className="ml-2 text-slate-500">Solid = recorded topology · dashed = inferred</span></div><span className="text-xs text-slate-500">{network?.poles.length ?? 0} poles · {network?.transformers.length ?? 0} DTs</span></div>
          <NetworkMap network={network} selectedIncident={selectedIncident} />
          <div className="mt-6"><IncidentPanel incidents={incidents} selectedId={selectedId} onSelect={setSelectedId} onChanged={() => void refresh()} /></div>
        </> : <SimulatorPanel network={network} faults={faults} onChanged={() => void refresh()} />}
      </main>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`rounded-md px-4 py-2 text-sm font-medium transition ${active ? "bg-sky-500 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"}`}>{children}</button>;
}

export default App;
