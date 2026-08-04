/**
 * Seed script for KSPDB fault localization system.
 *
 * Generates a synthetic radial LV power network matching the proportions
 * in docs/DATA_CONTRACTS.md section 5 ("Scale targets for synthetic seed data"):
 *
 *   - 2 substations (scaled from 4)
 *   - ~8 feeders (scaled from 31)
 *   - ~50 DTs (scaled from 412)
 *   - ~2,000 poles (scaled from 38,400)
 *   - ~9% of poles have no device
 *   - ~60% of DTs have no seq_on_line / parent_pole_id
 *   - ~3% of poles missing pincode
 *   - ~8% of devices on firmware 1.2.x
 *   - Poles per DT: varying sizes (5-30 range, scaled from 9-240)
 *
 * The network is geographically placed in Bengaluru (lat ~12.97, lon ~77.59)
 * to match the KSPDB (Karnataka State Power Distribution Board) setting.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ── Deterministic pseudo-random generator (seeded for reproducibility) ──

class SeededRandom {
  private state: number;
  constructor(seed: number) {
    this.state = seed;
  }
  /** Returns a float in [0, 1) */
  next(): number {
    // xorshift32
    this.state ^= this.state << 13;
    this.state ^= this.state >> 17;
    this.state ^= this.state << 5;
    return ((this.state >>> 0) / 0x100000000);
  }
  /** Returns int in [min, max] inclusive */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  /** Returns a float in [min, max) */
  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
  /** Returns true with given probability */
  chance(probability: number): boolean {
    return this.next() < probability;
  }
  /** Pick one item from an array */
  pick<T>(arr: T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }
  /** Shuffle array in place */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

const rng = new SeededRandom(42);

// ── Configuration ───────────────────────────────────────────────────

const NUM_SUBSTATIONS = 2;
const FEEDERS_PER_SUBSTATION = [4, 6]; // total ~10
const DTS_PER_FEEDER_RANGE = [5, 10]; // total ~75
const POLES_PER_DT_RANGE = [15, 55];  // scaled from 9-240, target ~2,500-3,000 total
const BRANCHES_PER_DT_RANGE = [1, 5]; // 1-5 branches per line

const FRACTION_NO_DEVICE = 0.09;    // ~9% of poles
const FRACTION_NO_TOPOLOGY = 0.63;  // target ~60% of DTs (tuned for RNG path)
const FRACTION_NO_PINCODE = 0.03;   // ~3% of poles
const FRACTION_FW_12X = 0.08;       // ~8% of devices on old firmware

// Bengaluru center coordinates
const BASE_LAT = 12.9716;
const BASE_LON = 77.5946;

// ── Pole types (cosmetic) ───────────────────────────────────────────

const POLE_TYPES = [
  "LT-9m-PCC",
  "LT-8m-Steel",
  "LT-9m-Steel",
  "LT-11m-PCC",
  "LT-8m-PCC",
  "LT-11m-Steel",
];

// ── Wards ───────────────────────────────────────────────────────────

const WARDS = [
  "W-071", "W-072", "W-073", "W-074", "W-075",
  "W-076", "W-077", "W-078", "W-079", "W-080",
  "W-081", "W-082", "W-083", "W-084", "W-085",
];

const PINCODES = [
  "560001", "560002", "560003", "560004", "560010",
  "560011", "560017", "560018", "560034", "560038",
  "560041", "560050", "560069", "560078", "560085",
];

const FW_VERSIONS_NEW = ["1.3.0", "1.3.1", "1.4.0", "1.4.1", "1.4.2"];
const FW_VERSIONS_OLD = ["1.2.0", "1.2.1", "1.2.3"];

const CAPACITY_KVA_OPTIONS = [63, 100, 160, 200, 250, 315, 500];

// ── Helpers ─────────────────────────────────────────────────────────

function padId(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** Offset lat/lon by meters (approximate) */
function offsetCoords(
  lat: number,
  lon: number,
  dLatM: number,
  dLonM: number
): [number, number] {
  // 1 degree lat ≈ 111,320 m, 1 degree lon ≈ 111,320 * cos(lat) m
  const dLat = dLatM / 111320;
  const dLon = dLonM / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lon + dLon];
}

// ── Main seed function ──────────────────────────────────────────────

async function main() {
  console.log("[seed] Starting seed...");

  // Clean existing data (idempotent re-seed)
  console.log("[seed] Clearing existing data...");
  await prisma.incidentPole.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.telemetryEvent.deleteMany();
  await prisma.poleState.deleteMany();
  await prisma.topologyEdge.deleteMany();
  await prisma.pole.deleteMany();
  await prisma.transformer.deleteMany();
  await prisma.feeder.deleteMany();
  await prisma.substation.deleteMany();
  await prisma.scheduledOutage.deleteMany();

  // Track counts for final report
  let totalPoles = 0;
  let polesNoDevice = 0;
  let polesNoPincode = 0;
  let totalDTs = 0;
  let dtsNoTopology = 0;
  let devicesFw12x = 0;
  let totalDevices = 0;

  // ── Substations ─────────────────────────────────────────────────

  const substations: { substation_id: string; lat: number; lon: number }[] = [];

  for (let s = 1; s <= NUM_SUBSTATIONS; s++) {
    const [lat, lon] = offsetCoords(
      BASE_LAT,
      BASE_LON,
      rng.float(-2000, 2000),
      rng.float(-2000, 2000)
    );
    const sub = {
      substation_id: `SS-${padId(s, 2)}`,
      name: `Substation ${s}`,
      lat,
      lon,
    };
    substations.push(sub);
    await prisma.substation.create({ data: sub });
  }
  console.log(`[seed] Created ${substations.length} substations`);

  // ── Feeders ─────────────────────────────────────────────────────

  let feederCounter = 0;
  const feeders: {
    feeder_id: string;
    substation_id: string;
    substationIdx: number;
  }[] = [];

  for (let s = 0; s < NUM_SUBSTATIONS; s++) {
    const numFeeders = FEEDERS_PER_SUBSTATION[s];
    for (let f = 0; f < numFeeders; f++) {
      feederCounter++;
      const feeder = {
        feeder_id: `F-${padId(s + 1, 2)}-${padId(f + 1, 2)}`,
        substation_id: substations[s].substation_id,
        substationIdx: s,
      };
      feeders.push(feeder);
      await prisma.feeder.create({
        data: {
          feeder_id: feeder.feeder_id,
          substation_id: feeder.substation_id,
        },
      });
    }
  }
  console.log(`[seed] Created ${feeders.length} feeders`);

  // ── Decide which DTs will have topology ─────────────────────────
  // We decide per-DT, not per-pole: if a DT has topology, ALL its poles
  // get seq_on_line/parent_pole_id. If not, NONE do.

  // ── DTs + Poles ─────────────────────────────────────────────────

  let dtCounter = 0;
  let poleCounter = 0;

  // Collect all poles for batch PoleState insert at end
  const allPoleIds: string[] = [];

  for (const feeder of feeders) {
    const numDTs = rng.int(DTS_PER_FEEDER_RANGE[0], DTS_PER_FEEDER_RANGE[1]);
    const substation = substations[feeder.substationIdx];

    for (let d = 0; d < numDTs; d++) {
      dtCounter++;
      totalDTs++;
      const dtId = `D-${padId(dtCounter, 4)}`;

      // DT location: offset from substation
      const [dtLat, dtLon] = offsetCoords(
        substation.lat,
        substation.lon,
        rng.float(-3000, 3000),
        rng.float(-3000, 3000)
      );

      const hasTopology = !rng.chance(FRACTION_NO_TOPOLOGY);
      if (!hasTopology) dtsNoTopology++;

      const capacityKva = rng.pick(CAPACITY_KVA_OPTIONS);
      const householdsServed = rng.int(
        Math.floor(capacityKva * 0.8),
        Math.floor(capacityKva * 1.8)
      );

      await prisma.transformer.create({
        data: {
          dt_id: dtId,
          feeder_id: feeder.feeder_id,
          lat: dtLat,
          lon: dtLon,
          capacity_kva: capacityKva,
          households_served: householdsServed,
        },
      });

      // ── Generate poles for this DT ─────────────────────────────
      // Structure: main trunk from DT with 0-N spurs forking off
      // intermediate trunk/spur poles — a realistic radial tree, not
      // a star from the root.

      const numPoles = rng.int(POLES_PER_DT_RANGE[0], POLES_PER_DT_RANGE[1]);
      const numSpurs = Math.min(
        rng.int(BRANCHES_PER_DT_RANGE[0], BRANCHES_PER_DT_RANGE[1]) - 1,
        Math.floor(numPoles * 0.6) // can't have more spurs than trunk poles
      );

      // Trunk gets ~60-80% of poles, spurs share the rest
      const trunkSize = Math.max(3, Math.ceil(numPoles * rng.float(0.55, 0.75)));
      const spurBudget = numPoles - trunkSize;

      // Distribute spur budget across spurs
      const spurSizes: number[] = [];
      let spurRemaining = spurBudget;
      for (let sp = 0; sp < Math.max(0, numSpurs); sp++) {
        if (sp === numSpurs - 1) {
          spurSizes.push(Math.max(1, spurRemaining));
        } else {
          const sz = rng.int(1, Math.max(1, spurRemaining - (numSpurs - sp - 1)));
          spurSizes.push(sz);
          spurRemaining -= sz;
        }
      }

      // Data for all poles in this DT
      const dtPoles: {
        pole_id: string;
        lat: number;
        lon: number;
        seq_on_line: number | null;
        parent_pole_id: string | null;
        pole_type: string;
        ward: string;
        pincode: string | null;
        device_id: string | null;
      }[] = [];

      let seqCounter = 0;
      const ward = rng.pick(WARDS);

      // Helper: create a single pole record
      function makePole(
        parentId: string | null,
        baseLat: number,
        baseLon: number,
        angle: number,
        distFromBase: number,
      ) {
        poleCounter++;
        seqCounter++;
        totalPoles++;
        const poleId = `P-${padId(poleCounter, 6)}`;

        const jitterLat = rng.float(-5, 5);
        const jitterLon = rng.float(-5, 5);
        const [poleLat, poleLon] = offsetCoords(
          baseLat,
          baseLon,
          Math.cos(angle) * distFromBase + jitterLat,
          Math.sin(angle) * distFromBase + jitterLon,
        );

        // Device assignment: ~9% have no device
        const hasDevice = !rng.chance(FRACTION_NO_DEVICE);
        let deviceId: string | null = null;
        let fwVersion: string | null = null;

        if (hasDevice) {
          deviceId = `KSPDB-SD${padId(feeder.substationIdx + 1, 2)}-${dtId}-${padId(poleCounter, 4)}`;
          totalDevices++;
          if (rng.chance(FRACTION_FW_12X)) {
            fwVersion = rng.pick(FW_VERSIONS_OLD);
            devicesFw12x++;
          } else {
            fwVersion = rng.pick(FW_VERSIONS_NEW);
          }
        } else {
          polesNoDevice++;
        }

        // Pincode: ~3% missing
        const pincode = rng.chance(FRACTION_NO_PINCODE) ? null : rng.pick(PINCODES);
        if (pincode === null) polesNoPincode++;

        const pole = {
          pole_id: poleId,
          lat: poleLat,
          lon: poleLon,
          seq_on_line: hasTopology ? seqCounter : null,
          parent_pole_id: hasTopology ? parentId : null,
          pole_type: rng.pick(POLE_TYPES),
          ward,
          pincode,
          device_id: deviceId,
          fw: fwVersion,
        };
        dtPoles.push(pole);
        allPoleIds.push(poleId);
        return pole;
      }

      // ── Main trunk: wandering polyline from DT ──────────────────
      // Each step advances from the PREVIOUS pole (not the DT origin)
      // with a small random angle drift, so the line follows curves
      // like a real street-routed power line.
      let trunkAngle = rng.float(0, 2 * Math.PI);
      const trunkSpacing = rng.float(25, 60);
      const trunkPoles: typeof dtPoles = [];

      for (let t = 0; t < trunkSize; t++) {
        // Gentle bend: drift angle ±0.2 rad (~±11°) per step
        if (t > 0) trunkAngle += rng.float(-0.2, 0.2);

        const parentId = t === 0 ? null : trunkPoles[t - 1].pole_id;
        const baseLat = t === 0 ? dtLat : trunkPoles[t - 1].lat;
        const baseLon = t === 0 ? dtLon : trunkPoles[t - 1].lon;
        const pole = makePole(
          parentId,
          baseLat,
          baseLon,
          trunkAngle,
          trunkSpacing,
        );
        trunkPoles.push(pole);
      }

      // ── Spurs: fork off random trunk poles ──────────────────────
      // Choose distinct fork points along the trunk — not from the
      // last pole (a spur from the end is just extending the trunk)
      // and not from the first pole (too close to DT, unrealistic).
      const forkCandidates = trunkPoles.slice(
        1,
        Math.max(2, trunkPoles.length - 1),
      );
      rng.shuffle(forkCandidates);

      for (let sp = 0; sp < spurSizes.length; sp++) {
        const forkPole = forkCandidates[sp % forkCandidates.length];
        // Spur heads off at a roughly perpendicular angle (+/- noise)
        let spurAngle =
          trunkAngle + (rng.chance(0.5) ? 1 : -1) * rng.float(0.8, 1.6);
        const spurSpacing = rng.float(25, 55);

        let prevPole = forkPole;
        for (let p = 0; p < spurSizes[sp]; p++) {
          // Spurs also wander slightly
          if (p > 0) spurAngle += rng.float(-0.15, 0.15);
          const pole = makePole(
            prevPole.pole_id,
            prevPole.lat,
            prevPole.lon,
            spurAngle,
            spurSpacing,
          );
          prevPole = pole;
        }
      }

      // ── Insert poles into DB ────────────────────────────────────
      // First pass: insert all poles without parent_pole_id (FK needs parent to exist first)
      for (const pole of dtPoles) {
        await prisma.pole.create({
          data: {
            pole_id: pole.pole_id,
            lat: pole.lat,
            lon: pole.lon,
            feeder_id: feeder.feeder_id,
            dt_id: dtId,
            seq_on_line: pole.seq_on_line,
            parent_pole_id: null, // set in second pass
            pole_type: pole.pole_type,
            ward: pole.ward,
            pincode: pole.pincode,
            device_id: pole.device_id,
            fw: pole.fw,
          },
        });
      }

      // Second pass: set parent_pole_id where applicable
      if (hasTopology) {
        for (const pole of dtPoles) {
          if (pole.parent_pole_id) {
            await prisma.pole.update({
              where: { pole_id: pole.pole_id },
              data: { parent_pole_id: pole.parent_pole_id },
            });
          }
        }

        // Also create TopologyEdge records for recorded topology
        for (const pole of dtPoles) {
          const parentId = pole.parent_pole_id;
          // For the first pole of the trunk, parent is the DT itself.
          await prisma.topologyEdge.create({
            data: {
              dt_id: dtId,
              parent_pole_id: parentId ?? dtId, // DT is root
              child_pole_id: pole.pole_id,
              source: "recorded",
              confidence: 1.0,
            },
          });
        }
      }
    }
  }

  console.log(`[seed] Created ${totalDTs} DTs (${dtsNoTopology} without topology = ${((dtsNoTopology / totalDTs) * 100).toFixed(1)}%)`);
  console.log(`[seed] Created ${totalPoles} poles`);
  console.log(`[seed]   - No device: ${polesNoDevice} (${((polesNoDevice / totalPoles) * 100).toFixed(1)}%)`);
  console.log(`[seed]   - No pincode: ${polesNoPincode} (${((polesNoPincode / totalPoles) * 100).toFixed(1)}%)`);
  console.log(`[seed]   - Fw 1.2.x devices: ${devicesFw12x}/${totalDevices} (${((devicesFw12x / totalDevices) * 100).toFixed(1)}%)`);

  // ── Initialize PoleState for all poles ──────────────────────────

  console.log("[seed] Creating pole states...");
  await prisma.poleState.createMany({
    data: allPoleIds.map((pole_id) => ({
      pole_id,
      status: "live" as const,
      energized: true,
      last_seq: 0,
    })),
  });

  // ── Sample scheduled outages ────────────────────────────────────

  console.log("[seed] Creating sample scheduled outages...");
  const sampleFeeders = feeders.slice(0, 3);
  const now = new Date();

  for (let i = 0; i < sampleFeeders.length; i++) {
    const start = new Date(now.getTime() + (i + 1) * 24 * 3600 * 1000);
    const end = new Date(start.getTime() + 2.5 * 3600 * 1000);
    await prisma.scheduledOutage.create({
      data: {
        id: `SO-${now.toISOString().slice(0, 10)}-${padId(i + 1, 3)}`,
        scope: "feeder",
        target_id: sampleFeeders[i].feeder_id,
        start,
        end,
        reason: rng.pick([
          "Planned maintenance - jumper replacement",
          "Scheduled cable replacement",
          "Transformer maintenance",
          "Line upgrade work",
        ]),
      },
    });
  }

  console.log("[seed] Done!");
  console.log("[seed] Summary:");
  console.log(`  Substations:       ${substations.length}`);
  console.log(`  Feeders:           ${feeders.length}`);
  console.log(`  DTs:               ${totalDTs} (${dtsNoTopology} without topology)`);
  console.log(`  Poles:             ${totalPoles}`);
  console.log(`  Poles w/o device:  ${polesNoDevice} (${((polesNoDevice / totalPoles) * 100).toFixed(1)}%)`);
  console.log(`  Poles w/o pincode: ${polesNoPincode} (${((polesNoPincode / totalPoles) * 100).toFixed(1)}%)`);
  console.log(`  Fw 1.2.x devices: ${devicesFw12x}/${totalDevices} (${((devicesFw12x / totalDevices) * 100).toFixed(1)}%)`);
}

main()
  .catch((e) => {
    console.error("[seed] Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
