import { IncidentStatus, IncidentType, OutageScope } from "@prisma/client";
import prisma from "../db";
import { computeInferredTopology } from "./topology";
import {
  BoundaryWalkResult,
  DetectedIncident,
  DeviceHealthFinding,
  EffectivePoleStatus,
  LocalTopologyEdge,
  PoleForLocalization,
  ScoredIncident,
} from "./types";

export const HEARTBEAT_STALE_AFTER_MS = 17 * 60 * 1000;

export function getEffectiveStatus(
  poleState: PoleForLocalization["pole_state"],
  now = new Date()
): EffectivePoleStatus {
  if (!poleState?.last_seen_at) return "unknown";
  if (poleState.energized && now.getTime() - poleState.last_seen_at.getTime() > HEARTBEAT_STALE_AFTER_MS) {
    return "stale";
  }
  if (!poleState.energized) return "dark";
  return "live";
}

function collectSubtree(
  startId: string,
  adjacency: Map<string, LocalTopologyEdge[]>,
  statuses: Map<string, EffectivePoleStatus>
): string[] {
  const subtree: string[] = [];
  const queue = [startId];
  const seen = new Set<string>();
  while (queue.length) {
    const poleId = queue.shift()!;
    if (seen.has(poleId)) continue;
    seen.add(poleId);
    const status = statuses.get(poleId);
    if (status !== "dark" && status !== "stale") continue;
    subtree.push(poleId);
    for (const edge of adjacency.get(poleId) ?? []) queue.push(edge.child_pole_id);
  }
  return subtree;
}

function topologyPath(
  boundary: LocalTopologyEdge,
  parentByChild: Map<string, LocalTopologyEdge>
): LocalTopologyEdge[] {
  const path: LocalTopologyEdge[] = [];
  let edge: LocalTopologyEdge | undefined = boundary;
  while (edge) {
    path.push(edge);
    edge = parentByChild.get(edge.parent_pole_id);
  }
  return path;
}

/** Pure BFS boundary walk used both by database orchestration and fixtures. */
export function findBoundaryIncidents(
  dtId: string,
  feederId: string,
  edges: LocalTopologyEdge[],
  statuses: Map<string, EffectivePoleStatus>
): BoundaryWalkResult {
  const adjacency = new Map<string, LocalTopologyEdge[]>();
  const parentByChild = new Map<string, LocalTopologyEdge>();
  for (const edge of edges) {
    const children = adjacency.get(edge.parent_pole_id) ?? [];
    children.push(edge);
    adjacency.set(edge.parent_pole_id, children);
    parentByChild.set(edge.child_pole_id, edge);
  }

  // A transformer has no PoleState of its own. Therefore a DT is treated as
  // root-dark when every directly supplied LT branch is dark/stale.
  const rootChildren = adjacency.get(dtId) ?? [];
  if (
    rootChildren.length > 0 &&
    rootChildren.every((edge) => {
      const status = statuses.get(edge.child_pole_id);
      return status === "dark" || status === "stale";
    }) &&
    ![...statuses.values()].some((status) => status === "live")
  ) {
    const affected = [...new Set(rootChildren.flatMap((edge) =>
      collectSubtree(edge.child_pole_id, adjacency, statuses)
    ))];
    return {
      incidents: [{
        type: "dt",
        dt_id: dtId,
        feeder_id: feederId,
        boundary_pole_id: null,
        first_dark_pole_id: null,
        affected_pole_ids: affected,
        boundary_edge: null,
        topology_path: [],
      }],
      deviceHealth: [],
    };
  }

  const incidents: DetectedIncident[] = [];
  const deviceHealth: DeviceHealthFinding[] = [];
  const visited = new Set<string>();
  const queue = [dtId];
  while (queue.length) {
    const parentId = queue.shift()!;
    const parentStatus: EffectivePoleStatus = parentId === dtId ? "live" : statuses.get(parentId) ?? "unknown";
    for (const edge of adjacency.get(parentId) ?? []) {
      const childId = edge.child_pole_id;
      const childStatus = statuses.get(childId) ?? "unknown";
      if (
        parentStatus === "live" &&
        (childStatus === "dark" || childStatus === "stale") &&
        !visited.has(childId)
      ) {
        const affected = collectSubtree(childId, adjacency, statuses);
        affected.forEach((poleId) => visited.add(poleId));
        const directChildren = adjacency.get(childId) ?? [];
        const isolatedWithLiveChildren =
          affected.length === 1 &&
          directChildren.every((child) => statuses.get(child.child_pole_id) === "live");
        if (isolatedWithLiveChildren) {
          deviceHealth.push({
            pole_id: childId,
            dt_id: dtId,
            feeder_id: feederId,
            status: childStatus,
            reason: "isolated dark/stale pole with live downstream children",
          });
        } else {
          incidents.push({
            type: "span",
            dt_id: dtId,
            feeder_id: feederId,
            boundary_pole_id: edge.parent_pole_id === dtId ? null : edge.parent_pole_id,
            first_dark_pole_id: childId,
            affected_pole_ids: affected,
            boundary_edge: edge,
            topology_path: topologyPath(edge, parentByChild),
          });
        }
      }
      queue.push(childId);
    }
  }

  return { incidents, deviceHealth };
}

export function scoreConfidence(
  incident: DetectedIncident,
  poles: Map<string, PoleForLocalization>
): ScoredIncident {
  const topologyConfidence = incident.topology_path.length
    ? Math.min(...incident.topology_path.map((edge) => edge.confidence))
    : 1;
  const affectedPoles = incident.affected_pole_ids
    .map((poleId) => poles.get(poleId))
    .filter((pole): pole is PoleForLocalization => Boolean(pole));
  const sensorCoverage = affectedPoles.length
    ? affectedPoles.filter((pole) => pole.device_id).length / affectedPoles.length
    : 0;
  const corroboration = affectedPoles.some(
    (pole) => pole.pole_state?.last_event === "power_lost"
  )
    ? 1
    : 0.6;
  const hasInferredEdge = incident.topology_path.some((edge) => edge.source === "inferred");
  const reasons = [
    hasInferredEdge ? "boundary uses inferred topology" : "recorded topology boundary",
    sensorCoverage < 1 ? `sensor coverage ${(sensorCoverage * 100).toFixed(0)}%` : "full sensor coverage",
    corroboration === 1 ? "explicit power_lost corroboration" : "inferred from heartbeat silence",
  ];
  return {
    ...incident,
    confidence: topologyConfidence * sensorCoverage * corroboration,
    confidence_reason: reasons.join("; "),
  };
}

async function matchingOutage(dtId: string | null, feederId: string, now: Date) {
  const outages = await prisma.scheduledOutage.findMany({
    where: {
      OR: [
        ...(dtId ? [{ scope: OutageScope.dt, target_id: dtId }] : []),
        { scope: OutageScope.feeder, target_id: feederId },
      ],
    },
  });
  return outages.find((outage) => {
    const toleranceStart = new Date(outage.start.getTime() - 10 * 60 * 1000);
    const toleranceEnd = new Date(outage.end.getTime() + 40 * 60 * 1000);
    return now >= toleranceStart && now <= toleranceEnd;
  });
}

async function persistIncident(incident: ScoredIncident, now: Date) {
  const existing = await prisma.incident.findFirst({
    where: {
      feeder_id: incident.feeder_id,
      dt_id: incident.dt_id,
      boundary_pole_id: incident.boundary_pole_id,
      first_dark_pole_id: incident.first_dark_pole_id,
      status: { in: [IncidentStatus.active, IncidentStatus.suppressed] },
    },
  });
  if (existing) return existing;

  const outage = await matchingOutage(incident.dt_id, incident.feeder_id, now);
  return prisma.incident.create({
    data: {
      type: incident.type === "span" ? IncidentType.span : incident.type === "dt" ? IncidentType.dt : IncidentType.feeder,
      status: outage ? IncidentStatus.suppressed : IncidentStatus.active,
      feeder_id: incident.feeder_id,
      dt_id: incident.dt_id,
      boundary_pole_id: incident.boundary_pole_id,
      first_dark_pole_id: incident.first_dark_pole_id,
      confidence: incident.confidence,
      confidence_reason: outage
        ? `${incident.confidence_reason}; expected (scheduled outage ${outage.id})`
        : incident.confidence_reason,
      pin_code: String(Math.floor(100000 + Math.random() * 900000)),
      affected_pole_count: incident.affected_pole_ids.length,
      suppression_outage_id: outage?.id,
      incident_poles: {
        createMany: { data: incident.affected_pole_ids.map((pole_id) => ({ pole_id })) },
      },
    },
  });
}

export async function findIncidents(dtId: string, now = new Date()) {
  await computeInferredTopology(dtId);
  const transformer = await prisma.transformer.findUnique({
    where: { dt_id: dtId },
    select: { feeder_id: true },
  });
  if (!transformer) throw new Error(`Unknown DT ${dtId}`);
  const [edges, poles] = await Promise.all([
    prisma.topologyEdge.findMany({ where: { dt_id: dtId } }),
    prisma.pole.findMany({
      where: { dt_id: dtId },
      include: { pole_state: true },
    }),
  ]);
  const localizedPoles: PoleForLocalization[] = poles.map((pole) => ({
    pole_id: pole.pole_id,
    device_id: pole.device_id,
    feeder_id: pole.feeder_id,
    pole_state: pole.pole_state,
  }));
  const poleById = new Map(localizedPoles.map((pole) => [pole.pole_id, pole]));
  const statuses = new Map(
    localizedPoles.map((pole) => [pole.pole_id, getEffectiveStatus(pole.pole_state, now)])
  );
  const walked = findBoundaryIncidents(
    dtId,
    transformer.feeder_id,
    edges.map((edge) => ({ ...edge, source: edge.source })),
    statuses
  );
  const scored = walked.incidents.map((incident) => scoreConfidence(incident, poleById));
  const persisted = await Promise.all(scored.map((incident) => persistIncident(incident, now)));
  return {
    dt_id: dtId,
    feeder_id: transformer.feeder_id,
    root_dark: walked.incidents.some((incident) => incident.type === "dt"),
    root_dark_affected_pole_ids: walked.incidents
      .filter((incident) => incident.type === "dt")
      .flatMap((incident) => incident.affected_pole_ids),
    incidents: persisted,
    device_health: walked.deviceHealth,
  };
}

let isRunning = false;

export async function runLocalization(now = new Date()) {
  if (isRunning) return { skipped: true, dt_runs: [], incident_count: 0, device_health: [] as DeviceHealthFinding[] };
  isRunning = true;
  try {
    const transformers = await prisma.transformer.findMany({
      select: { dt_id: true, feeder_id: true },
    });
    const dtRuns = [];
    for (const transformer of transformers) dtRuns.push(await findIncidents(transformer.dt_id, now));
    const feederGroups = new Map<string, typeof dtRuns>();
    for (const run of dtRuns) {
      const group = feederGroups.get(run.feeder_id) ?? [];
      group.push(run);
      feederGroups.set(run.feeder_id, group);
    }
    const feederIncidents = [];
    for (const [feederId, runs] of feederGroups) {
      if (!runs.every((run) => run.root_dark)) continue;
      const affectedPoleIds = [...new Set(runs.flatMap((run) => run.root_dark_affected_pole_ids))];
      const feederPoles = await prisma.pole.findMany({
        where: { pole_id: { in: affectedPoleIds } },
        include: { pole_state: true },
      });
      const scored = scoreConfidence(
        {
          type: "feeder",
          dt_id: null,
          feeder_id: feederId,
          boundary_pole_id: null,
          first_dark_pole_id: null,
          affected_pole_ids: affectedPoleIds,
          boundary_edge: null,
          topology_path: [],
        },
        new Map(
          feederPoles.map((pole) => [
            pole.pole_id,
            {
              pole_id: pole.pole_id,
              device_id: pole.device_id,
              feeder_id: pole.feeder_id,
              pole_state: pole.pole_state,
            },
          ])
        )
      );
      feederIncidents.push(await persistIncident(scored, now));
    }
    return {
      skipped: false,
      dt_runs: dtRuns,
      incident_count: dtRuns.reduce((sum, result) => sum + result.incidents.length, 0),
      feeder_incidents: feederIncidents,
      device_health: dtRuns.flatMap((result) => result.device_health),
    };
  } finally {
    isRunning = false;
  }
}

/** Called after a power_restored event is accepted by telemetry ingest. */
export async function verifyRestoredIncidentsForPole(poleId: string): Promise<number> {
  const candidates = await prisma.incident.findMany({
    where: { status: IncidentStatus.active, incident_poles: { some: { pole_id: poleId } } },
    include: { incident_poles: { include: { pole: { include: { pole_state: true } } } } },
  });
  const verified = candidates.filter((incident) =>
    incident.incident_poles.length > 0 &&
    incident.incident_poles.every((entry) => entry.pole.pole_state?.energized === true)
  );
  await Promise.all(
    verified.map((incident) =>
      prisma.incident.update({
        where: { id: incident.id },
        data: { status: IncidentStatus.verified, verified_at: new Date() },
      })
    )
  );
  return verified.length;
}
