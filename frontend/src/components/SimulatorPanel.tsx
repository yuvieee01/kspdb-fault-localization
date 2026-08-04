import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { NetworkData, SimulatedFault } from "../types";

interface Props {
  network: NetworkData | null;
  faults: SimulatedFault[];
  onChanged: () => void;
}

type FaultType = "span" | "dt" | "feeder";
type NoiseType = "duplicate" | "out_of_order" | "stale_late";
type OutageScope = "dt" | "feeder";

export function SimulatorPanel({ network, faults, onChanged }: Props) {
  const [faultType, setFaultType] = useState<FaultType>("span");
  const targets = useMemo(() => {
    if (!network) return [];
    if (faultType === "span") return network.poles.map((pole) => pole.pole_id);
    if (faultType === "dt") return network.transformers.map((item) => item.dt_id);
    return [...new Set(network.transformers.map((item) => item.feeder_id))];
  }, [faultType, network]);
  const [faultTarget, setFaultTarget] = useState("");
  const [outageScope, setOutageScope] = useState<OutageScope>("dt");
  const outageTargets = useMemo(() => {
    if (!network) return [];
    if (outageScope === "dt") return network.transformers.map((item) => item.dt_id);
    return [...new Set(network.transformers.map((item) => item.feeder_id))];
  }, [outageScope, network]);
  const [outageTarget, setOutageTarget] = useState("");
  const [noiseType, setNoiseType] = useState<NoiseType>("duplicate");
  const [noiseTarget, setNoiseTarget] = useState("");
  const [notice, setNotice] = useState("Ready. Simulator actions flow through the real ingest pipeline.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (targets.length && !targets.includes(faultTarget)) setFaultTarget(targets[0]);
  }, [targets, faultTarget]);
  useEffect(() => {
    if (outageTargets.length && !outageTargets.includes(outageTarget)) setOutageTarget(outageTargets[0]);
  }, [outageTargets, outageTarget]);
  useEffect(() => {
    if (!noiseTarget && network?.poles.length) setNoiseTarget(network.poles[0].pole_id);
  }, [network, noiseTarget]);

  async function action(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      setNotice(`${label} sent. The map and ticket list refresh within 5 seconds.`);
      onChanged();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${label} failed.`);
    } finally {
      setBusy(false);
    }
  }

  function submitFault(event: FormEvent) {
    event.preventDefault();
    void action(`${faultType.toUpperCase()} fault`, () => api.injectFault(faultType, faultTarget));
  }

  function submitNoise(event: FormEvent) {
    event.preventDefault();
    void action(`${noiseType} noise`, () => api.injectNoise(noiseType, noiseTarget));
  }

  function submitScheduledOutage(event: FormEvent) {
    event.preventDefault();
    void action("Scheduled outage", () => api.simulateScheduledOutage(outageScope, outageTarget));
  }

  return (
    <section className="grid gap-5 xl:grid-cols-[1fr_1fr_1.1fr]">
      <ControlCard title="Inject a fault" subtitle="Power-loss telemetry is generated for the affected subtree.">
        <form className="space-y-3" onSubmit={submitFault}>
          <label className="block text-xs font-medium text-slate-300">Scope<select value={faultType} onChange={(event) => setFaultType(event.target.value as FaultType)} className="input mt-1"><option value="span">Span</option><option value="dt">DT</option><option value="feeder">Feeder</option></select></label>
          <label className="block text-xs font-medium text-slate-300">Target<select value={faultTarget} onChange={(event) => setFaultTarget(event.target.value)} className="input mt-1">{targets.map((target) => <option key={target}>{target}</option>)}</select></label>
          <button disabled={busy || !faultTarget} className="button w-full bg-rose-500 hover:bg-rose-400">Inject {faultType} fault</button>
        </form>
      </ControlCard>

      <ControlCard title="Inject telemetry noise" subtitle="Exercises deduplication and sequence-ordering protection.">
        <form className="space-y-3" onSubmit={submitNoise}>
          <label className="block text-xs font-medium text-slate-300">Scenario<select value={noiseType} onChange={(event) => setNoiseType(event.target.value as NoiseType)} className="input mt-1"><option value="duplicate">Duplicate delivery</option><option value="out_of_order">Out-of-order timestamp</option><option value="stale_late">Stale / late retry</option></select></label>
          <label className="block text-xs font-medium text-slate-300">Pole ID<input list="device-poles" value={noiseTarget} onChange={(event) => setNoiseTarget(event.target.value)} className="input mt-1" /></label>
          <datalist id="device-poles">{network?.poles.filter((pole) => pole.device_id).slice(0, 400).map((pole) => <option key={pole.pole_id} value={pole.pole_id} />)}</datalist>
          <button disabled={busy || !noiseTarget} className="button w-full bg-amber-500 text-slate-950 hover:bg-amber-400">Inject noise</button>
        </form>
      </ControlCard>

      <ControlCard title="Simulate scheduled outage" subtitle="Adds a mock feed record, then de-energizes the planned scope. The ticket should be tagged expected.">
        <form className="space-y-3" onSubmit={submitScheduledOutage}>
          <label className="block text-xs font-medium text-slate-300">Scope<select value={outageScope} onChange={(event) => setOutageScope(event.target.value as OutageScope)} className="input mt-1"><option value="dt">DT</option><option value="feeder">Feeder</option></select></label>
          <label className="block text-xs font-medium text-slate-300">Target<select value={outageTarget} onChange={(event) => setOutageTarget(event.target.value)} className="input mt-1">{outageTargets.map((target) => <option key={target}>{target}</option>)}</select></label>
          <button disabled={busy || !outageTarget} className="button w-full bg-violet-500 hover:bg-violet-400">Simulate scheduled outage</button>
        </form>
      </ControlCard>

      <ControlCard title="Active simulations" subtitle="Repairs send boot and power-restored telemetry automatically.">
        <div className="space-y-2">
          {faults.length === 0 ? <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-500">No active simulated faults.</p> : faults.map((fault) => <div key={fault.fault_id} className="rounded-lg bg-slate-800 p-3"><div className="flex justify-between gap-3"><div><p className="font-medium text-white">{fault.type} · {fault.target_id}</p><p className="text-xs text-slate-400">{fault.affected_pole_count} poles · {fault.fault_id}</p>{fault.simulation_kind === "scheduled_outage" && <p className="mt-1 text-xs font-semibold text-violet-300">Scheduled outage · expected / suppressed</p>}</div><button disabled={busy} onClick={() => void action(`Repair ${fault.fault_id}`, () => api.repairFault(fault.fault_id))} className="button bg-emerald-500 px-3 py-1 text-xs hover:bg-emerald-400">Repair</button></div></div>)}
        </div>
        <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy} onClick={() => void action("Heartbeat baseline", api.heartbeatAll)} className="button bg-slate-700 text-xs hover:bg-slate-600">Send heartbeat baseline</button><button disabled={busy} onClick={() => void action("Localization run", api.runLocalization)} className="button bg-sky-500 text-xs hover:bg-sky-400">Run localization now</button></div>
      </ControlCard>
      <p className={`xl:col-span-3 rounded-lg border px-4 py-3 text-sm ${notice.includes("failed") || notice.includes("Cannot") ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-sky-500/30 bg-sky-500/10 text-sky-100"}`}>{notice}</p>
    </section>
  );
}

function ControlCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl"><h2 className="font-semibold text-white">{title}</h2><p className="mt-1 min-h-10 text-xs text-slate-400">{subtitle}</p><div className="mt-4">{children}</div></div>;
}
