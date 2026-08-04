/**
 * Fault Simulator — Step 4 of build order.
 *
 * REST API to inject faults, noise, and repairs into the telemetry pipeline.
 * All actions produce realistic telemetry events that flow through the same
 * ingest endpoint as real devices would, exercising the full pipeline.
 *
 * Endpoints:
 *   POST /api/simulator/fault          — inject a span/DT/feeder fault
 *   POST /api/simulator/repair         — repair a previously injected fault
 *   POST /api/simulator/noise          — inject noise (dead sensor, duplicates, etc.)
 *   GET  /api/simulator/status         — list active simulated faults
 *   POST /api/simulator/heartbeat-all  — send heartbeat for all live poles
 *
 * Behavioral rules modeled (per DATA_CONTRACTS.md):
 *   - fw >= 1.3: sends power_lost ~70% of the time (capacitor reserve)
 *   - fw 1.2.x: sends NOTHING on power loss — goes silent
 *   - ~30% of dying messages never arrive even on fw >= 1.3
 *   - On restore: boot + power_restored within ~20s
 *   - Heartbeat every 15 min +/- 45s jitter
 *   - At-least-once delivery: duplicates happen
 *   - Clock skew up to +/- 90s
 */

import { OutageScope } from "@prisma/client";
import { Router, Request, Response } from "express";
import prisma from "../db";
import { ingestTelemetry, IngestHttpResponse, TelemetryPayload } from "./telemetry";

const router = Router();

// ── Types ───────────────────────────────────────────────────────────

interface FaultRequest {
  type: "span" | "dt" | "feeder";
  target_id: string; // pole_id for span, dt_id for DT, feeder_id for feeder
  boundary_pole_id?: string; // for span faults: last live pole
}

interface RepairRequest {
  fault_id: string; // ID returned from fault injection
}

interface NoiseRequest {
  type: "dead_sensor" | "duplicate" | "out_of_order" | "stale_late";
  target_pole_id: string;
  count?: number; // for duplicates: how many copies
}

interface ScheduledOutageSimulationRequest {
  scope: "dt" | "feeder";
  target_id: string;
  duration_minutes?: number;
}

interface SimulatorIngestResponse {
  message: string;
  status: number;
  body: IngestHttpResponse["body"];
}

// Track active simulated faults
interface ActiveFault {
  id: string;
  type: "span" | "dt" | "feeder";
  target_id: string;
  affected_poles: string[];
  created_at: Date;
  scheduled_outage_id?: string;
}

const activeFaults: Map<string, ActiveFault> = new Map();
let faultCounter = 0;
let scheduledOutageCounter = 0;

// Global seq counter per device for simulator-generated telemetry
const deviceSeqCounters: Map<string, number> = new Map();

function getNextSeq(deviceId: string): number {
  const current = deviceSeqCounters.get(deviceId) || 0;
  const next = current + 1;
  deviceSeqCounters.set(deviceId, next);
  return next;
}

function resetSeq(deviceId: string): void {
  deviceSeqCounters.set(deviceId, 0);
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Add clock skew up to +/- 90s */
function skewedTimestamp(): string {
  const skew = (Math.random() - 0.5) * 180 * 1000; // +/- 90s
  return new Date(Date.now() + skew).toISOString();
}

/** Random jitter for heartbeat timing */
function heartbeatJitter(): number {
  return (Math.random() - 0.5) * 90 * 1000; // +/- 45s in ms
}

/**
 * Send a telemetry event through the same validated ingest entry point used
 * by POST /api/telemetry. The returned value is the exact HTTP response that
 * endpoint would produce for this payload.
 */
async function injectTelemetryEvent(
  event: TelemetryPayload
): Promise<IngestHttpResponse> {
  return ingestTelemetry(event);
}

/**
 * Get all poles downstream of a given pole (inclusive) using the parent_pole_id
 * tree structure. For DTs without topology, returns all poles under the DT.
 */
async function getDownstreamPoles(
  poleId: string,
  dtId: string
): Promise<Array<{ pole_id: string; device_id: string | null; fw: string | null }>> {
  // Get all poles for this DT
  const allPoles = await prisma.pole.findMany({
    where: { dt_id: dtId },
    select: { pole_id: true, device_id: true, fw: true, parent_pole_id: true },
  });

  // Build adjacency list
  const childMap = new Map<string | null, typeof allPoles>();
  for (const p of allPoles) {
    const parent = p.parent_pole_id;
    if (!childMap.has(parent)) childMap.set(parent, []);
    childMap.get(parent)!.push(p);
  }

  // BFS from the target pole
  const result: typeof allPoles = [];
  const queue = [poleId];
  const visited = new Set<string>();

  // Include the target pole itself
  const targetPole = allPoles.find((p) => p.pole_id === poleId);
  if (targetPole) result.push(targetPole);
  visited.add(poleId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = childMap.get(current) || [];
    for (const child of children) {
      if (!visited.has(child.pole_id)) {
        visited.add(child.pole_id);
        result.push(child);
        queue.push(child.pole_id);
      }
    }
  }

  return result;
}

/**
 * Get all poles under a DT.
 */
async function getAllPolesForDT(
  dtId: string
): Promise<Array<{ pole_id: string; device_id: string | null; fw: string | null }>> {
  return prisma.pole.findMany({
    where: { dt_id: dtId },
    select: { pole_id: true, device_id: true, fw: true },
  });
}

/**
 * Get all poles under a feeder (across all DTs).
 */
async function getAllPolesForFeeder(
  feederId: string
): Promise<Array<{ pole_id: string; device_id: string | null; fw: string | null }>> {
  return prisma.pole.findMany({
    where: { feeder_id: feederId },
    select: { pole_id: true, device_id: true, fw: true },
  });
}

/**
 * Simulate power loss telemetry for a set of poles.
 * Models realistic behavior per DATA_CONTRACTS.md:
 *  - fw >= 1.3: attempts power_lost, succeeds ~70%
 *  - fw 1.2.x: sends NOTHING (goes silent)
 *  - No-device poles: no telemetry at all
 */
async function simulatePowerLoss(
  poles: Array<{ pole_id: string; device_id: string | null; fw: string | null }>
): Promise<{ totalAffected: number; powerLostSent: number; silentFw12x: number; noDevice: number; dyingMsgFailed: number }> {
  let powerLostSent = 0;
  let silentFw12x = 0;
  let noDevice = 0;
  let dyingMsgFailed = 0;

  for (const pole of poles) {
    if (!pole.device_id || !pole.fw) {
      // No device fitted — no telemetry possible
      noDevice++;
      continue;
    }

    const isFw12x = pole.fw.startsWith("1.2");

    if (isFw12x) {
      // Firmware 1.2.x: sends NOTHING on power loss, just goes silent.
      // We don't send any event and we DO NOT update PoleState here.
      // The localization algorithm (Step 5) must infer it from heartbeat silence.
      silentFw12x++;
    } else {
      // Firmware >= 1.3: attempts one power_lost from capacitor reserve
      // Succeeds ~70% of the time
      const dyingMsgSucceeds = Math.random() < 0.7;

      if (dyingMsgSucceeds) {
        const seq = getNextSeq(pole.device_id);
        await injectTelemetryEvent({
          device_id: pole.device_id,
          pole_id: pole.pole_id,
          event: "power_lost",
          energized: false,
          ts: skewedTimestamp(),
          seq,
          battery_mv: 2800 + Math.floor(Math.random() * 600), // low battery
          rssi: -80 - Math.floor(Math.random() * 25),
          fw: pole.fw,
        });
        powerLostSent++;
      } else {
        // Dying message failed — device goes silent like fw 1.2.x
        // We do not update PoleState here.
        dyingMsgFailed++;
      }
    }
  }

  return {
    totalAffected: poles.length,
    powerLostSent,
    silentFw12x,
    noDevice,
    dyingMsgFailed,
  };
}

/**
 * Simulate power restoration telemetry for a set of poles.
 * Models: boot event, then power_restored ~20s later.
 */
async function simulatePowerRestore(
  poles: Array<{ pole_id: string; device_id: string | null; fw: string | null }>
): Promise<{ restored: number; noDevice: number }> {
  let restored = 0;
  let noDevice = 0;

  for (const pole of poles) {
    if (!pole.device_id || !pole.fw) {
      noDevice++;
      continue;
    }

    // Reset seq counter (device rebooted)
    resetSeq(pole.device_id);

    // Send boot event
    const bootSeq = getNextSeq(pole.device_id);
    await injectTelemetryEvent({
      device_id: pole.device_id,
      pole_id: pole.pole_id,
      event: "boot",
      energized: true,
      ts: skewedTimestamp(),
      seq: bootSeq,
      battery_mv: 3500 + Math.floor(Math.random() * 200),
      rssi: -70 - Math.floor(Math.random() * 30),
      fw: pole.fw,
    });

    // Send power_restored ~20s later (schedule inline for simplicity)
    const restoreSeq = getNextSeq(pole.device_id);
    const restoreDelay = 15000 + Math.floor(Math.random() * 10000); // 15-25s
    setTimeout(async () => {
      try {
        await injectTelemetryEvent({
          device_id: pole.device_id!,
          pole_id: pole.pole_id,
          event: "power_restored",
          energized: true,
          ts: skewedTimestamp(),
          seq: restoreSeq,
          battery_mv: 3600 + Math.floor(Math.random() * 200),
          rssi: -70 - Math.floor(Math.random() * 25),
          fw: pole.fw!,
        });
      } catch (err) {
        console.error(
          `[simulator] Failed to send power_restored for ${pole.pole_id}:`,
          err
        );
      }
    }, restoreDelay);

    restored++;
  }

  return { restored, noDevice };
}

// ── Routes ──────────────────────────────────────────────────────────

/**
 * POST /api/simulator/fault
 *
 * Inject a fault. Types:
 *   - span:   power loss from a specific pole downstream (target_id = first_dark_pole_id)
 *   - dt:     all poles under a DT go dark (target_id = dt_id)
 *   - feeder: all poles under a feeder go dark (target_id = feeder_id)
 *
 * Body: { type: "span"|"dt"|"feeder", target_id: string }
 */
router.post("/fault", async (req: Request, res: Response): Promise<void> => {
  const { type, target_id } = req.body as FaultRequest;

  if (!type || !target_id) {
    res.status(400).json({ error: "type and target_id are required" });
    return;
  }

  if (!["span", "dt", "feeder"].includes(type)) {
    res.status(400).json({ error: "type must be span, dt, or feeder" });
    return;
  }

  try {
    let affectedPoles: Array<{ pole_id: string; device_id: string | null; fw: string | null }> = [];

    switch (type) {
      case "span": {
        // target_id is the first dark pole — everything downstream goes dark
        const pole = await prisma.pole.findUnique({
          where: { pole_id: target_id },
          select: { pole_id: true, dt_id: true },
        });
        if (!pole) {
          res.status(404).json({ error: `pole ${target_id} not found` });
          return;
        }
        affectedPoles = await getDownstreamPoles(target_id, pole.dt_id);
        break;
      }
      case "dt": {
        // target_id is a dt_id — all poles go dark
        const dt = await prisma.transformer.findUnique({
          where: { dt_id: target_id },
        });
        if (!dt) {
          res.status(404).json({ error: `DT ${target_id} not found` });
          return;
        }
        affectedPoles = await getAllPolesForDT(target_id);
        break;
      }
      case "feeder": {
        // target_id is a feeder_id — all poles across all DTs go dark
        const feeder = await prisma.feeder.findUnique({
          where: { feeder_id: target_id },
        });
        if (!feeder) {
          res.status(404).json({ error: `feeder ${target_id} not found` });
          return;
        }
        affectedPoles = await getAllPolesForFeeder(target_id);
        break;
      }
    }

    // Generate realistic power loss telemetry
    const stats = await simulatePowerLoss(affectedPoles);

    // Track the fault
    faultCounter++;
    const faultId = `SIM-${faultCounter.toString().padStart(4, "0")}`;
    const fault: ActiveFault = {
      id: faultId,
      type,
      target_id,
      affected_poles: affectedPoles.map((p) => p.pole_id),
      created_at: new Date(),
    };
    activeFaults.set(faultId, fault);

    res.status(201).json({
      fault_id: faultId,
      type,
      target_id,
      stats: {
        total_affected: stats.totalAffected,
        power_lost_sent: stats.powerLostSent,
        silent_fw12x: stats.silentFw12x,
        dying_msg_failed: stats.dyingMsgFailed,
        no_device: stats.noDevice,
      },
    });
  } catch (err) {
    console.error("[simulator] Error injecting fault:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

/**
 * POST /api/simulator/scheduled-outage
 *
 * Creates a mock feed record and darkens its DT/feeder during the actual
 * scheduled window. Localization must retain the expected/suppressed record,
 * rather than create a dispatchable fault ticket.
 */
router.post("/scheduled-outage", async (req: Request, res: Response): Promise<void> => {
  const { scope, target_id, duration_minutes = 30 } = req.body as ScheduledOutageSimulationRequest;
  if (!scope || !target_id) {
    res.status(400).json({ error: "scope and target_id are required" });
    return;
  }
  if (scope !== "dt" && scope !== "feeder") {
    res.status(400).json({ error: "scope must be dt or feeder" });
    return;
  }
  if (!Number.isFinite(duration_minutes) || duration_minutes < 1 || duration_minutes > 480) {
    res.status(400).json({ error: "duration_minutes must be between 1 and 480" });
    return;
  }

  try {
    let affectedPoles: Array<{ pole_id: string; device_id: string | null; fw: string | null }>;
    if (scope === "dt") {
      const transformer = await prisma.transformer.findUnique({ where: { dt_id: target_id } });
      if (!transformer) {
        res.status(404).json({ error: `DT ${target_id} not found` });
        return;
      }
      affectedPoles = await getAllPolesForDT(target_id);
    } else {
      const feeder = await prisma.feeder.findUnique({ where: { feeder_id: target_id } });
      if (!feeder) {
        res.status(404).json({ error: `feeder ${target_id} not found` });
        return;
      }
      affectedPoles = await getAllPolesForFeeder(target_id);
    }

    const now = new Date();
    scheduledOutageCounter++;
    const outage = await prisma.scheduledOutage.create({
      data: {
        id: `SIM-SO-${now.getTime()}-${scheduledOutageCounter}`,
        scope: scope === "dt" ? OutageScope.dt : OutageScope.feeder,
        target_id,
        start: now,
        end: new Date(now.getTime() + duration_minutes * 60 * 1000),
        reason: "Simulator: planned outage verification",
      },
    });
    const stats = await simulatePowerLoss(affectedPoles);

    faultCounter++;
    const faultId = `SIM-${faultCounter.toString().padStart(4, "0")}`;
    activeFaults.set(faultId, {
      id: faultId,
      type: scope,
      target_id,
      affected_poles: affectedPoles.map((pole) => pole.pole_id),
      created_at: now,
      scheduled_outage_id: outage.id,
    });
    res.status(201).json({
      fault_id: faultId,
      scheduled_outage: {
        id: outage.id,
        scope: outage.scope,
        target_id: outage.target_id,
        start: outage.start.toISOString(),
        end: outage.end.toISOString(),
      },
      expected_ticket_status: "suppressed",
      stats: {
        total_affected: stats.totalAffected,
        power_lost_sent: stats.powerLostSent,
        silent_fw12x: stats.silentFw12x,
        dying_msg_failed: stats.dyingMsgFailed,
        no_device: stats.noDevice,
      },
    });
  } catch (error) {
    console.error("[simulator] Error simulating scheduled outage:", error);
    res.status(500).json({ error: "internal server error" });
  }
});

/**
 * POST /api/simulator/repair
 *
 * Repair a previously injected fault. Sends boot + power_restored for all
 * affected poles (power_restored arrives ~20s after boot per spec).
 *
 * Body: { fault_id: string }
 */
router.post("/repair", async (req: Request, res: Response): Promise<void> => {
  const { fault_id } = req.body as RepairRequest;

  if (!fault_id) {
    res.status(400).json({ error: "fault_id is required" });
    return;
  }

  const fault = activeFaults.get(fault_id);
  if (!fault) {
    res.status(404).json({ error: `fault ${fault_id} not found or already repaired` });
    return;
  }

  try {
    // Get pole details for restoration
    const poles = await prisma.pole.findMany({
      where: { pole_id: { in: fault.affected_poles } },
      select: { pole_id: true, device_id: true, fw: true },
    });

    const stats = await simulatePowerRestore(poles);

    if (fault.scheduled_outage_id) {
      await prisma.scheduledOutage.deleteMany({ where: { id: fault.scheduled_outage_id } });
    }

    // Remove from active faults
    activeFaults.delete(fault_id);

    res.status(200).json({
      fault_id,
      status: "repaired",
      stats: {
        boot_sent: stats.restored,
        power_restored_pending: stats.restored, // will arrive in ~20s
        no_device: stats.noDevice,
      },
      note: "power_restored events will follow boot events in ~15-25 seconds",
    });
  } catch (err) {
    console.error("[simulator] Error repairing fault:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

/**
 * POST /api/simulator/noise
 *
 * Inject noise events that the localization algorithm must handle correctly.
 *
 * Types:
 *   - dead_sensor: pole's device stops reporting (modem/SIM/vandalism),
 *     but power is fine. No telemetry event — just marks as offline.
 *   - duplicate: sends the same event multiple times (at-least-once delivery)
 *   - out_of_order: sends events with non-monotonic timestamps
 *   - stale_late: sends a power_lost event that arrives hours late (stale retry)
 *
 * Body: { type: string, target_pole_id: string, count?: number }
 */
router.post("/noise", async (req: Request, res: Response): Promise<void> => {
  const { type, target_pole_id, count = 3 } = req.body as NoiseRequest;

  if (!type || !target_pole_id) {
    res.status(400).json({ error: "type and target_pole_id are required" });
    return;
  }

  const pole = await prisma.pole.findUnique({
    where: { pole_id: target_pole_id },
    select: { pole_id: true, device_id: true, fw: true },
  });

  if (!pole) {
    res.status(404).json({ error: `pole ${target_pole_id} not found` });
    return;
  }

  if (!pole.device_id) {
    res.status(400).json({ error: `pole ${target_pole_id} has no device` });
    return;
  }

  try {
    switch (type) {
      case "dead_sensor": {
        // Simulate a device going offline for non-power reasons.
        // The device just stops sending — no explicit event.
        // We DO NOT update PoleState directly here.
        // The localization algorithm (Step 5/debounce) must detect the absence of heartbeats
        // by comparing the pole's existing last_seen_at to the current time.

        res.status(201).json({
          type: "dead_sensor",
          pole_id: target_pole_id,
          note: "Device stopped reporting. The localization engine must detect the stale last_seen_at after the timeout period passes.",
        });
        break;
      }

      case "duplicate": {
        // Send the same event N times (at-least-once delivery)
        const seq = getNextSeq(pole.device_id);
        const ts = skewedTimestamp();
        const eventData = {
          device_id: pole.device_id,
          pole_id: pole.pole_id,
          event: "heartbeat" as const,
          energized: true,
          ts,
          seq,
          battery_mv: 3500,
          rssi: -85,
          fw: pole.fw || "1.4.2",
        };

        const ingestResponses: SimulatorIngestResponse[] = [];
        // Every delivery, including retries, is processed by real ingest logic.
        for (let i = 0; i < count; i++) {
          const result = await injectTelemetryEvent(eventData);
          ingestResponses.push({
            message: `copy ${i + 1}`,
            status: result.status,
            body: result.body,
          });
        }

        res.status(201).json({
          type: "duplicate",
          pole_id: target_pole_id,
          copies: count,
          seq,
          ingest_responses: ingestResponses,
          note: `Sent ${count} copies of the same heartbeat (seq=${seq}). Ingest handler should accept first, reject rest.`,
        });
        break;
      }

      case "out_of_order": {
        // Send events with non-monotonic device timestamps (ts).
        // seq is still monotonic — the system should use seq for ordering.
        const baseTime = Date.now();

        // Event 1: ts = now
        const seq1 = getNextSeq(pole.device_id);
        const ingestResponses: SimulatorIngestResponse[] = [];
        const firstResult = await injectTelemetryEvent({
          device_id: pole.device_id,
          pole_id: pole.pole_id,
          event: "heartbeat",
          energized: true,
          ts: new Date(baseTime).toISOString(),
          seq: seq1,
          battery_mv: 3500,
          rssi: -85,
          fw: pole.fw || "1.4.2",
        });
        ingestResponses.push({
          message: "seq 1 (ts=now)",
          status: firstResult.status,
          body: firstResult.body,
        });

        // Event 2: ts = 2 minutes BEFORE event 1 (out of order),
        // but seq is higher (correct ordering key)
        const seq2 = getNextSeq(pole.device_id);
        const secondResult = await injectTelemetryEvent({
          device_id: pole.device_id,
          pole_id: pole.pole_id,
          event: "heartbeat",
          energized: true,
          ts: new Date(baseTime - 120_000).toISOString(), // 2 min in the past
          seq: seq2,
          battery_mv: 3500,
          rssi: -85,
          fw: pole.fw || "1.4.2",
        });
        ingestResponses.push({
          message: "seq 2 (ts=now-2min)",
          status: secondResult.status,
          body: secondResult.body,
        });

        res.status(201).json({
          type: "out_of_order",
          pole_id: target_pole_id,
          ingest_responses: ingestResponses,
          note: `Sent 2 heartbeats: seq ${seq1} with ts=now, seq ${seq2} with ts=now-2min. System should use seq, not ts, for ordering.`,
        });
        break;
      }

      case "stale_late": {
        // Simulate a power_lost event arriving hours late (stale retry).
        // This is a real scenario: device was offline, retried for up to 6 hours.
        const staleTs = new Date(Date.now() - 4 * 3600 * 1000).toISOString(); // 4 hours ago
        const seq = getNextSeq(pole.device_id);

        const ingestResult = await injectTelemetryEvent({
          device_id: pole.device_id,
          pole_id: pole.pole_id,
          event: "power_lost",
          energized: false,
          ts: staleTs,
          seq,
          battery_mv: 2900,
          rssi: -95,
          fw: pole.fw || "1.4.2",
        });

        res.status(201).json({
          type: "stale_late",
          pole_id: target_pole_id,
          ingest_responses: [{
            message: "stale power_lost (ts=now-4h)",
            status: ingestResult.status,
            body: ingestResult.body,
          }],
          note: `Sent a power_lost with ts from 4 hours ago (stale retry). seq=${seq} is still fresh, so it should be accepted.`,
        });
        break;
      }

      default:
        res.status(400).json({
          error: `Unknown noise type: ${type}. Valid: dead_sensor, duplicate, out_of_order, stale_late`,
        });
    }
  } catch (err) {
    console.error("[simulator] Error injecting noise:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

/**
 * POST /api/simulator/heartbeat-all
 *
 * Send a heartbeat for all poles that currently have a device and are
 * considered "live". Useful for establishing baseline state before
 * injecting faults.
 *
 * Body: {} (no params needed)
 */
router.post(
  "/heartbeat-all",
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const poles = await prisma.pole.findMany({
        where: { device_id: { not: null } },
        select: { pole_id: true, device_id: true, fw: true },
      });

      let sent = 0;
      for (const pole of poles) {
        if (!pole.device_id || !pole.fw) continue;

        const seq = getNextSeq(pole.device_id);
        await injectTelemetryEvent({
          device_id: pole.device_id,
          pole_id: pole.pole_id,
          event: "heartbeat",
          energized: true,
          ts: new Date(Date.now() + heartbeatJitter()).toISOString(),
          seq,
          battery_mv: 3400 + Math.floor(Math.random() * 300),
          rssi: -70 - Math.floor(Math.random() * 30),
          fw: pole.fw,
        });
        sent++;
      }

      res.status(200).json({
        heartbeats_sent: sent,
        note: "All devices with fitted poles sent a heartbeat",
      });
    } catch (err) {
      console.error("[simulator] Error in heartbeat-all:", err);
      res.status(500).json({ error: "internal server error" });
    }
  }
);

/**
 * GET /api/simulator/status
 *
 * List all active simulated faults.
 */
router.get("/status", (_req: Request, res: Response): void => {
  const faults = Array.from(activeFaults.values()).map((f) => ({
    fault_id: f.id,
    type: f.type,
    target_id: f.target_id,
    affected_pole_count: f.affected_poles.length,
    created_at: f.created_at.toISOString(),
    simulation_kind: f.scheduled_outage_id ? "scheduled_outage" : "fault",
    scheduled_outage_id: f.scheduled_outage_id ?? null,
  }));

  res.json({ active_faults: faults });
});

export default router;
