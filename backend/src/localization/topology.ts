import { EdgeSource } from "@prisma/client";
import prisma from "../db";
import { LocalTopologyEdge, TopologyNode } from "./types";

const EARTH_RADIUS_METERS = 6_371_000;

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

export function haversineMeters(a: TopologyNode, b: TopologyNode): number {
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Prim's MST rooted at the transformer. The root's identifier is the DT id,
 * which lets topology_edges represent transformer-to-first-pole edges without
 * inventing a pole record for the transformer.
 */
export function buildInferredTopology(
  dtId: string,
  root: TopologyNode,
  poles: TopologyNode[]
): LocalTopologyEdge[] {
  const tree = new Map<string, TopologyNode>([[root.id, root]]);
  const unvisited = new Map(poles.map((pole) => [pole.id, pole]));
  const edges: LocalTopologyEdge[] = [];

  while (unvisited.size > 0) {
    let selectedParent: TopologyNode | undefined;
    let selectedChild: TopologyNode | undefined;
    let selectedDistance = Number.POSITIVE_INFINITY;

    for (const parent of tree.values()) {
      for (const child of unvisited.values()) {
        const distance = haversineMeters(parent, child);
        if (distance < selectedDistance) {
          selectedDistance = distance;
          selectedParent = parent;
          selectedChild = child;
        }
      }
    }

    if (!selectedParent || !selectedChild) {
      throw new Error(`Unable to infer topology for DT ${dtId}`);
    }

    const alternatives = [...tree.values()]
      .filter((node) => node.id !== selectedParent!.id)
      .map((node) => haversineMeters(node, selectedChild!));
    const secondNearest = alternatives.length
      ? Math.min(...alternatives)
      : Number.POSITIVE_INFINITY;
    const confidence = Math.max(
      0.3,
      Math.min(0.95, 1 - selectedDistance / secondNearest)
    );

    edges.push({
      dt_id: dtId,
      parent_pole_id: selectedParent.id,
      child_pole_id: selectedChild.id,
      source: "inferred",
      confidence,
      distance_m: selectedDistance,
    });
    tree.set(selectedChild.id, selectedChild);
    unvisited.delete(selectedChild.id);
  }

  return edges;
}

/**
 * Lazily infer and persist a DT's topology. Existing topology_edges are the
 * cache: recorded topology is seeded, inferred topology is written once.
 */
export async function computeInferredTopology(
  dtId: string
): Promise<LocalTopologyEdge[]> {
  const existing = await prisma.topologyEdge.findMany({ where: { dt_id: dtId } });
  if (existing.length > 0) {
    return existing.map((edge) => ({
      ...edge,
      source: edge.source,
    }));
  }

  const [transformer, poles] = await Promise.all([
    prisma.transformer.findUnique({
      where: { dt_id: dtId },
      select: { dt_id: true, lat: true, lon: true },
    }),
    prisma.pole.findMany({
      where: { dt_id: dtId, seq_on_line: null },
      select: { pole_id: true, lat: true, lon: true },
    }),
  ]);

  if (!transformer) throw new Error(`Unknown DT ${dtId}`);
  if (poles.length === 0) return [];

  const inferred = buildInferredTopology(
    dtId,
    { id: transformer.dt_id, lat: transformer.lat, lon: transformer.lon },
    poles.map((pole) => ({ id: pole.pole_id, lat: pole.lat, lon: pole.lon }))
  );

  await prisma.topologyEdge.createMany({
    data: inferred.map((edge) => ({
      ...edge,
      source: EdgeSource.inferred,
    })),
    skipDuplicates: true,
  });

  return inferred;
}
