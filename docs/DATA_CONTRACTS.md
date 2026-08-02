# Data contracts

Source of truth: `02-data-and-systems.md` from the assignment brief. Match
these shapes exactly — do not rename fields or invent alternatives.

## 1. Telemetry payload (device -> ingest endpoint, HTTPS POST)

```json
{
  "device_id": "KSPDB-SD07-D0112-4431",
  "pole_id": "P-024431",
  "event": "power_lost",
  "energized": false,
  "ts": "2026-07-29T02:14:07.412Z",
  "seq": 88213,
  "battery_mv": 3480,
  "rssi": -91,
  "fw": "1.4.2"
}
```

| Field | Type | Notes |
|---|---|---|
| device_id | string | Stable per physical device. Devices get swapped; same pole can change device_id over time. Do NOT use as location key. |
| pole_id | string | Foreign key into pole registry. Trust this over device_id for location. |
| event | enum | One of: heartbeat, power_lost, power_restored, boot. |
| energized | bool | Device's current view of its own state. |
| ts | ISO8601 | Device clock. Skew up to +/-90s. Not monotonic across devices. |
| seq | int | Monotonic per device, resets to 0 on boot. The only reliable ordering/dedup key within a device. |
| battery_mv | int | Reserve capacitor voltage. Below ~3200 the device may fail to send its dying message. |
| rssi | int | Radio signal strength. Distinguishes bad coverage from dead device. |
| fw | string | Firmware version. ~8% of fleet on 1.2.x, which does NOT send power_lost at all — it just stops heartbeating. |

### Behavioral rules (implement these, don't assume defaults)
- Heartbeat every 15 min +/- 45s jitter while energized.
- On power loss: firmware >= 1.3 attempts one power_lost message from
  capacitor reserve, succeeds ~70% of the time. Firmware 1.2.x sends
  nothing — goes silent.
- On power return: device sends boot, then power_restored, typically within
  20s.
- At-least-once delivery. Duplicates happen. Retries for up to 6 hours from
  an offline device — a stale power_lost can arrive hours late.
- ~4% of the fleet is offline at any given moment for unrelated reasons
  (dead modem, vandalism, water ingress, expired SIM) — not a power event.
- Dedup key: (device_id, seq). Discard if seq <= last seen seq for that
  device_id (unless seq reset to 0, which means a reboot happened).

## 2. Pole registry (CSV, one-time static export)

```csv
pole_id,lat,lon,feeder_id,dt_id,seq_on_line,parent_pole_id,pole_type,ward,pincode,device_id
P-024431,12.968214,77.594612,F-07-03,D-0112,14,P-024430,LT-9m-PCC,W-084,560078,KSPDB-SD07-D0112-4431
P-024432,12.968901,77.594330,F-07-03,D-0112,15,P-024431,LT-9m-PCC,W-084,560078,KSPDB-SD07-D0112-4432
P-024433,12.969455,77.593980,F-07-03,D-0112,,,LT-8m-Steel,W-084,560078,
```

| Column | Notes |
|---|---|
| pole_id | Primary key |
| lat, lon | Surveyed GPS, +/-4m accurate. ALWAYS present, always trustworthy. |
| feeder_id | Always present |
| dt_id | Always present |
| seq_on_line | Position along LT line from transformer, 1 = closest. MISSING for ~60% of DTs |
| parent_pole_id | Immediately upstream pole. Missing wherever seq_on_line is missing |
| pole_type | Cosmetic for this exercise |
| ward, pincode | Administrative. pincode missing for ~3% of rows |
| device_id | Empty where no device fitted (~9% of poles) |

## 3. Transformer registry

```csv
dt_id,feeder_id,lat,lon,capacity_kva,households_served
D-0112,F-07-03,12.967801,77.595120,250,318
```

## 4. Scheduled outage feed (mock this as an API)

```
GET /scheduled-outages?from=2026-07-29T00:00:00Z&to=2026-07-30T00:00:00Z

[
  {
    "id": "SO-2026-07-29-014",
    "scope": "feeder",
    "target_id": "F-07-03",
    "start": "2026-07-29T10:00:00Z",
    "end":   "2026-07-29T12:30:00Z",
    "reason": "Planned maintenance - jumper replacement"
  },
  {
    "id": "SO-2026-07-29-021",
    "scope": "dt",
    "target_id": "D-0112",
    "start": "2026-07-29T14:00:00Z",
    "end":   "2026-07-29T15:00:00Z",
    "reason": "Load shedding"
  }
]
```

Caveats to implement around: shutdowns start late and overrun by 20-40 min
routinely. ~1 in 10 is cancelled without the feed being updated. Do not
treat this feed as gospel — apply a tolerance window and re-escalate if
poles are still dark well past it.

## 5. Scale targets for the synthetic seed data

| Thing | Real count | Synthetic target |
|---|---|---|
| Substations | 4 | scale down proportionally, few thousand poles total is enough |
| Feeders | 31 | proportional |
| DTs | 412 | proportional |
| LT poles | 38,400 | a few thousand, NOT all 38,400 |
| Poles with telemetry device | ~91% | keep ~91% (i.e. ~9% no device) |
| DTs missing seq_on_line/parent_pole_id | ~60% | keep ~60% — this is the core test condition, do not accidentally generate 100% complete topology |
| Poles per DT | 9-240, median ~70 | scale down but keep shape (varying sizes, 1-5 branches per line) |
| pincode missing | ~3% of poles | keep ~3% |
| Heartbeat interval | 15 min +/- 45s jitter | same |
| Steady-state ingest | ~39 msg/s at full fleet | scale proportionally to synthetic fleet size, but test burst handling (5,000 msgs/10s) at full target rate regardless of fleet size, by replaying/compressing time in the simulator |

## 6. Performance targets to measure and report (not guess)

| Metric | Target |
|---|---|
| Fault occurrence -> localized ticket visible in UI | < 120s (p95) |
| Ingest throughput sustained | >= 500 msg/s |
| Ingest burst tolerated without data loss | 5,000 messages in 10s |
| Operator console incident list load | < 2s |
| Restoration -> ticket auto-verified | < 120s |