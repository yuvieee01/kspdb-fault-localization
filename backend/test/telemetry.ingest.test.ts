import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db", () => ({
  default: {
    poleState: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    telemetryEvent: {
      create: vi.fn(),
    },
  },
}));

import prisma from "../src/db";
import { ingestTelemetry, TelemetryPayload } from "../src/routes/telemetry";

const mockedPrisma = prisma as unknown as {
  poleState: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  telemetryEvent: {
    create: ReturnType<typeof vi.fn>;
  };
};

const existingPoleState = {
  pole_id: "P-000001",
  status: "live",
  energized: true,
  last_event: "heartbeat",
  last_seq: 42,
  last_device_id: "DEVICE-A",
  last_seen_at: new Date("2026-08-04T00:00:00.000Z"),
};

function payload(overrides: Partial<TelemetryPayload> = {}): TelemetryPayload {
  return {
    device_id: "DEVICE-A",
    pole_id: "P-000001",
    event: "heartbeat",
    energized: true,
    ts: "2026-08-04T12:00:00.000Z",
    seq: 43,
    battery_mv: 3500,
    rssi: -85,
    fw: "1.4.2",
    ...overrides,
  };
}

describe("ingestTelemetry deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPrisma.telemetryEvent.create.mockResolvedValue({});
    mockedPrisma.poleState.update.mockResolvedValue({});
    mockedPrisma.poleState.findUnique.mockResolvedValue(existingPoleState);
  });

  it("rejects a duplicate sequence from the same device", async () => {
    const result = await ingestTelemetry(payload({ seq: 42 }));

    expect(result).toEqual({
      status: 200,
      body: {
        accepted: false,
        reason: "duplicate: seq 42 <= last_seq 42 for device DEVICE-A",
      },
    });
    expect(mockedPrisma.telemetryEvent.create).not.toHaveBeenCalled();
    expect(mockedPrisma.poleState.update).not.toHaveBeenCalled();
  });

  it("accepts a boot reset at seq 0 after a higher sequence", async () => {
    const result = await ingestTelemetry(payload({ event: "boot", seq: 0 }));

    expect(result).toEqual({ status: 201, body: { accepted: true } });
    expect(mockedPrisma.poleState.update).toHaveBeenCalledWith({
      where: { pole_id: "P-000001" },
      data: expect.objectContaining({
        last_seq: 0,
        last_device_id: "DEVICE-A",
        last_event: "boot",
      }),
    });
  });

  it("accepts a lower sequence when the pole has a swapped device", async () => {
    const result = await ingestTelemetry(
      payload({ device_id: "DEVICE-B", seq: 1 })
    );

    expect(result).toEqual({ status: 201, body: { accepted: true } });
    expect(mockedPrisma.poleState.update).toHaveBeenCalledWith({
      where: { pole_id: "P-000001" },
      data: expect.objectContaining({
        last_seq: 1,
        last_device_id: "DEVICE-B",
      }),
    });
  });

  it("rejects an out-of-order lower sequence from the same device", async () => {
    const result = await ingestTelemetry(
      payload({ seq: 41, ts: "2026-08-04T11:58:00.000Z" })
    );

    expect(result).toEqual({
      status: 200,
      body: {
        accepted: false,
        reason: "duplicate: seq 41 <= last_seq 42 for device DEVICE-A",
      },
    });
    expect(mockedPrisma.telemetryEvent.create).not.toHaveBeenCalled();
  });

  it("rejects telemetry for an unknown pole without writing an event", async () => {
    mockedPrisma.poleState.findUnique.mockResolvedValue(null);

    const result = await ingestTelemetry(payload({ pole_id: "P-UNKNOWN" }));

    expect(result).toEqual({
      status: 200,
      body: { accepted: false, reason: "unknown pole_id: P-UNKNOWN" },
    });
    expect(mockedPrisma.telemetryEvent.create).not.toHaveBeenCalled();
    expect(mockedPrisma.poleState.update).not.toHaveBeenCalled();
  });
});
