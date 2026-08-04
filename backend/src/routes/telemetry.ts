/**
 * Telemetry ingest endpoint.
 *
 * POST /api/telemetry
 * POST /api/telemetry/batch
 *
 * Accepts telemetry payloads exactly matching docs/DATA_CONTRACTS.md section 1.
 * Implements dedup, validation, and writes to the append-only event log +
 * updates PoleState.
 *
 * Dedup strategy (per user decision, NOT a DB unique constraint):
 *   - Track last_seq and last_device_id per pole in PoleState
 *   - If incoming device_id matches last_device_id and seq <= last_seq → discard
 *   - If event == 'boot' → reset last_seq to 0, then accept
 *   - If device_id differs from last_device_id → device swap, accept and reset tracking
 */

import { Router, Request, Response } from "express";
import prisma from "../db";
import { TelemetryEventType, PoleStatus } from "@prisma/client";

const router = Router();

// ── Payload validation ──────────────────────────────────────────────

const VALID_EVENTS: Set<string> = new Set([
  "heartbeat",
  "power_lost",
  "power_restored",
  "boot",
]);

export interface TelemetryPayload {
  device_id: string;
  pole_id: string;
  event: string;
  energized: boolean;
  ts: string;
  seq: number;
  battery_mv: number;
  rssi: number;
  fw: string;
}

interface IngestResult {
  accepted: number;
  rejected: number;
  errors: string[];
}

function validatePayload(
  body: unknown,
  index?: number
): { valid: true; data: TelemetryPayload } | { valid: false; error: string } {
  const prefix = index !== undefined ? `[${index}] ` : "";
  const b = body as Record<string, unknown>;

  if (!b || typeof b !== "object") {
    return { valid: false, error: `${prefix}payload must be an object` };
  }

  // Required string fields
  for (const field of ["device_id", "pole_id", "event", "ts", "fw"]) {
    if (typeof b[field] !== "string" || (b[field] as string).length === 0) {
      return {
        valid: false,
        error: `${prefix}${field} must be a non-empty string`,
      };
    }
  }

  if (!VALID_EVENTS.has(b.event as string)) {
    return {
      valid: false,
      error: `${prefix}event must be one of: ${[...VALID_EVENTS].join(", ")}`,
    };
  }

  if (typeof b.energized !== "boolean") {
    return { valid: false, error: `${prefix}energized must be a boolean` };
  }

  // Validate ts is parseable as ISO8601
  const tsDate = new Date(b.ts as string);
  if (isNaN(tsDate.getTime())) {
    return { valid: false, error: `${prefix}ts must be a valid ISO8601 date` };
  }

  // Required integer fields
  for (const field of ["seq", "battery_mv", "rssi"]) {
    if (typeof b[field] !== "number" || !Number.isInteger(b[field] as number)) {
      return { valid: false, error: `${prefix}${field} must be an integer` };
    }
  }

  if ((b.seq as number) < 0) {
    return { valid: false, error: `${prefix}seq must be >= 0` };
  }

  return {
    valid: true,
    data: {
      device_id: b.device_id as string,
      pole_id: b.pole_id as string,
      event: b.event as string,
      energized: b.energized as boolean,
      ts: b.ts as string,
      seq: b.seq as number,
      battery_mv: b.battery_mv as number,
      rssi: b.rssi as number,
      fw: b.fw as string,
    },
  };
}

// ── Core ingest logic (processes one event) ─────────────────────────

interface ProcessResult {
  accepted: boolean;
  reason?: string;
}

export interface IngestHttpResponse {
  status: number;
  body: { accepted: boolean; reason?: string; error?: string };
}

async function processEvent(data: TelemetryPayload): Promise<ProcessResult> {
  const {
    device_id,
    pole_id,
    event,
    energized,
    ts,
    seq,
    battery_mv,
    rssi,
    fw,
  } = data;

  // ── 1. Verify pole exists ───────────────────────────────────────

  const poleState = await prisma.poleState.findUnique({
    where: { pole_id },
  });

  if (!poleState) {
    // Pole not in registry — could be a misconfigured device or a
    // device that was moved to a pole we don't know about. Log but
    // don't crash; the event is lost.
    return { accepted: false, reason: `unknown pole_id: ${pole_id}` };
  }

  // ── 2. Dedup logic ──────────────────────────────────────────────
  //
  // Rules (from DATA_CONTRACTS.md + user decision):
  //   - Dedup key is (device_id, seq)
  //   - If same device and seq <= last_seq → discard (duplicate/stale)
  //   - If event is 'boot' → reset last_seq to 0, then accept this event
  //   - If device_id differs from last_device_id → device swap, reset tracking

  const isSameDevice = poleState.last_device_id === device_id;
  const isBootEvent = event === "boot";

  if (isSameDevice && !isBootEvent) {
    // Same device, not a boot: check seq ordering
    if (seq <= poleState.last_seq) {
      return {
        accepted: false,
        reason: `duplicate: seq ${seq} <= last_seq ${poleState.last_seq} for device ${device_id}`,
      };
    }
  }

  // If it's a boot event from the same device, seq resets — accept regardless.
  // If it's a different device, this is a device swap — accept and start fresh.

  // ── 3. Write to append-only telemetry event log ─────────────────

  await prisma.telemetryEvent.create({
    data: {
      device_id,
      pole_id,
      event: event as TelemetryEventType,
      energized,
      ts: new Date(ts),
      seq,
      battery_mv,
      rssi,
      fw,
    },
  });

  // ── 4. Update PoleState ─────────────────────────────────────────

  // Determine new pole status based on the event type.
  // This is a raw state update — the debounce / ambiguity resolution
  // (algorithm steps 1-2) happens in the localization engine (step 5),
  // not here. The ingest handler just records what we received.
  let newStatus: PoleStatus = poleState.status;

  switch (event) {
    case "heartbeat":
      // Device is alive and reporting
      newStatus = energized ? PoleStatus.live : PoleStatus.dark;
      break;
    case "power_lost":
      newStatus = PoleStatus.dark;
      break;
    case "power_restored":
      newStatus = PoleStatus.live;
      break;
    case "boot":
      // Device rebooted — typically means power was restored
      // power_restored usually follows within ~20s
      newStatus = PoleStatus.live;
      break;
  }

  const newSeq = isBootEvent ? seq : seq; // boot doesn't skip; we just accept the new seq

  await prisma.poleState.update({
    where: { pole_id },
    data: {
      status: newStatus,
      energized,
      last_event: event as TelemetryEventType,
      last_seq: newSeq,
      last_device_id: device_id,
      last_seen_at: new Date(),
    },
  });

  return { accepted: true };
}

/**
 * Shared single-event ingest entry point.
 *
 * The HTTP route and trusted in-process producers (the simulator) both use
 * this function so validation, deduplication, event logging, and pole-state
 * updates cannot diverge. Its return shape is exactly the POST /api/telemetry
 * HTTP response.
 */
export async function ingestTelemetry(
  body: unknown
): Promise<IngestHttpResponse> {
  const validation = validatePayload(body);
  if (!validation.valid) {
    return {
      status: 400,
      body: { accepted: false, error: validation.error },
    };
  }

  try {
    const result = await processEvent(validation.data);
    return result.accepted
      ? { status: 201, body: { accepted: true } }
      : { status: 200, body: { accepted: false, reason: result.reason } };
  } catch (err) {
    console.error("[ingest] Error processing event:", err);
    return {
      status: 500,
      body: { accepted: false, error: "internal server error" },
    };
  }
}

// ── Routes ──────────────────────────────────────────────────────────

/**
 * POST /api/telemetry — single event ingest
 *
 * Body: single telemetry payload object (DATA_CONTRACTS.md section 1)
 * Response: { accepted: boolean, reason?: string }
 */
router.post("/", async (req: Request, res: Response): Promise<void> => {
  const result = await ingestTelemetry(req.body);
  res.status(result.status).json(result.body);
});

/**
 * POST /api/telemetry/batch — batch event ingest
 *
 * Body: array of telemetry payload objects
 * Response: { accepted: number, rejected: number, errors: string[] }
 *
 * Processes each event independently — partial success is possible.
 * This is the high-throughput endpoint for burst handling (5,000 msgs/10s target).
 */
router.post("/batch", async (req: Request, res: Response): Promise<void> => {
  if (!Array.isArray(req.body)) {
    res.status(400).json({
      accepted: 0,
      rejected: 0,
      errors: ["body must be an array of telemetry events"],
    });
    return;
  }

  const result: IngestResult = { accepted: 0, rejected: 0, errors: [] };

  for (let i = 0; i < req.body.length; i++) {
    const validation = validatePayload(req.body[i], i);
    if (!validation.valid) {
      result.rejected++;
      result.errors.push(validation.error);
      continue;
    }

    try {
      const processResult = await processEvent(validation.data);
      if (processResult.accepted) {
        result.accepted++;
      } else {
        result.rejected++;
        if (result.errors.length < 50) {
          // Cap error details to avoid huge responses
          result.errors.push(
            `[${i}] ${processResult.reason || "rejected"}`
          );
        }
      }
    } catch (err) {
      result.rejected++;
      if (result.errors.length < 50) {
        result.errors.push(
          `[${i}] internal error: ${err instanceof Error ? err.message : "unknown"}`
        );
      }
    }
  }

  const status = result.accepted > 0 ? 201 : 200;
  res.status(status).json(result);
});

export default router;
