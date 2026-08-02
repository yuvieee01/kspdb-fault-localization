-- CreateEnum
CREATE TYPE "EdgeSource" AS ENUM ('recorded', 'inferred');

-- CreateEnum
CREATE TYPE "TelemetryEventType" AS ENUM ('heartbeat', 'power_lost', 'power_restored', 'boot');

-- CreateEnum
CREATE TYPE "PoleStatus" AS ENUM ('live', 'dark', 'offline_ambiguous', 'unknown');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('span', 'dt', 'feeder');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('active', 'verified', 'resolved', 'suppressed');

-- CreateEnum
CREATE TYPE "OutageScope" AS ENUM ('feeder', 'dt');

-- CreateTable
CREATE TABLE "substations" (
    "substation_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "substations_pkey" PRIMARY KEY ("substation_id")
);

-- CreateTable
CREATE TABLE "feeders" (
    "feeder_id" TEXT NOT NULL,
    "substation_id" TEXT NOT NULL,

    CONSTRAINT "feeders_pkey" PRIMARY KEY ("feeder_id")
);

-- CreateTable
CREATE TABLE "transformers" (
    "dt_id" TEXT NOT NULL,
    "feeder_id" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "capacity_kva" INTEGER NOT NULL,
    "households_served" INTEGER NOT NULL,

    CONSTRAINT "transformers_pkey" PRIMARY KEY ("dt_id")
);

-- CreateTable
CREATE TABLE "poles" (
    "pole_id" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "feeder_id" TEXT NOT NULL,
    "dt_id" TEXT NOT NULL,
    "seq_on_line" INTEGER,
    "parent_pole_id" TEXT,
    "pole_type" TEXT NOT NULL,
    "ward" TEXT NOT NULL,
    "pincode" TEXT,
    "device_id" TEXT,

    CONSTRAINT "poles_pkey" PRIMARY KEY ("pole_id")
);

-- CreateTable
CREATE TABLE "topology_edges" (
    "id" SERIAL NOT NULL,
    "dt_id" TEXT NOT NULL,
    "parent_pole_id" TEXT NOT NULL,
    "child_pole_id" TEXT NOT NULL,
    "source" "EdgeSource" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "distance_m" DOUBLE PRECISION,

    CONSTRAINT "topology_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_events" (
    "id" SERIAL NOT NULL,
    "device_id" TEXT NOT NULL,
    "pole_id" TEXT NOT NULL,
    "event" "TelemetryEventType" NOT NULL,
    "energized" BOOLEAN NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "seq" INTEGER NOT NULL,
    "battery_mv" INTEGER NOT NULL,
    "rssi" INTEGER NOT NULL,
    "fw" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetry_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pole_states" (
    "pole_id" TEXT NOT NULL,
    "status" "PoleStatus" NOT NULL DEFAULT 'unknown',
    "energized" BOOLEAN NOT NULL DEFAULT true,
    "last_event" "TelemetryEventType",
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pole_states_pkey" PRIMARY KEY ("pole_id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" SERIAL NOT NULL,
    "type" "IncidentType" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'active',
    "feeder_id" TEXT NOT NULL,
    "dt_id" TEXT,
    "boundary_pole_id" TEXT,
    "first_dark_pole_id" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "confidence_reason" TEXT NOT NULL,
    "pin_code" TEXT NOT NULL,
    "affected_pole_count" INTEGER NOT NULL DEFAULT 0,
    "ai_briefing" TEXT,
    "suppression_outage_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_poles" (
    "id" SERIAL NOT NULL,
    "incident_id" INTEGER NOT NULL,
    "pole_id" TEXT NOT NULL,

    CONSTRAINT "incident_poles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_outages" (
    "id" TEXT NOT NULL,
    "scope" "OutageScope" NOT NULL,
    "target_id" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "scheduled_outages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "poles_dt_id_idx" ON "poles"("dt_id");

-- CreateIndex
CREATE INDEX "poles_feeder_id_idx" ON "poles"("feeder_id");

-- CreateIndex
CREATE INDEX "poles_device_id_idx" ON "poles"("device_id");

-- CreateIndex
CREATE INDEX "topology_edges_dt_id_idx" ON "topology_edges"("dt_id");

-- CreateIndex
CREATE UNIQUE INDEX "topology_edges_dt_id_child_pole_id_key" ON "topology_edges"("dt_id", "child_pole_id");

-- CreateIndex
CREATE INDEX "telemetry_events_device_id_seq_idx" ON "telemetry_events"("device_id", "seq");

-- CreateIndex
CREATE INDEX "telemetry_events_pole_id_idx" ON "telemetry_events"("pole_id");

-- CreateIndex
CREATE INDEX "telemetry_events_received_at_idx" ON "telemetry_events"("received_at");

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "incidents"("status");

-- CreateIndex
CREATE INDEX "incidents_feeder_id_idx" ON "incidents"("feeder_id");

-- CreateIndex
CREATE INDEX "incidents_dt_id_idx" ON "incidents"("dt_id");

-- CreateIndex
CREATE INDEX "incidents_created_at_idx" ON "incidents"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "incident_poles_incident_id_pole_id_key" ON "incident_poles"("incident_id", "pole_id");

-- CreateIndex
CREATE INDEX "scheduled_outages_target_id_idx" ON "scheduled_outages"("target_id");

-- CreateIndex
CREATE INDEX "scheduled_outages_start_end_idx" ON "scheduled_outages"("start", "end");

-- AddForeignKey
ALTER TABLE "feeders" ADD CONSTRAINT "feeders_substation_id_fkey" FOREIGN KEY ("substation_id") REFERENCES "substations"("substation_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformers" ADD CONSTRAINT "transformers_feeder_id_fkey" FOREIGN KEY ("feeder_id") REFERENCES "feeders"("feeder_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poles" ADD CONSTRAINT "poles_feeder_id_fkey" FOREIGN KEY ("feeder_id") REFERENCES "feeders"("feeder_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poles" ADD CONSTRAINT "poles_dt_id_fkey" FOREIGN KEY ("dt_id") REFERENCES "transformers"("dt_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poles" ADD CONSTRAINT "poles_parent_pole_id_fkey" FOREIGN KEY ("parent_pole_id") REFERENCES "poles"("pole_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_events" ADD CONSTRAINT "telemetry_events_pole_id_fkey" FOREIGN KEY ("pole_id") REFERENCES "poles"("pole_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pole_states" ADD CONSTRAINT "pole_states_pole_id_fkey" FOREIGN KEY ("pole_id") REFERENCES "poles"("pole_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_poles" ADD CONSTRAINT "incident_poles_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_poles" ADD CONSTRAINT "incident_poles_pole_id_fkey" FOREIGN KEY ("pole_id") REFERENCES "poles"("pole_id") ON DELETE RESTRICT ON UPDATE CASCADE;
