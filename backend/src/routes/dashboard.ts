import { IncidentStatus } from "@prisma/client";
import { Request, Response, Router } from "express";
import prisma from "../db";
import { getEffectiveStatus } from "../localization/engine";

const router = Router();

function toIncidentSummary(incident: {
  id: number;
  type: string;
  status: string;
  feeder_id: string;
  dt_id: string | null;
  boundary_pole_id: string | null;
  first_dark_pole_id: string | null;
  confidence: number;
  confidence_reason: string;
  pin_code: string;
  affected_pole_count: number;
  suppression_outage_id: string | null;
  created_at: Date;
  updated_at: Date;
  verified_at: Date | null;
  incident_poles?: Array<{ pole_id: string }>;
}) {
  return {
    ...incident,
    incident_poles: incident.incident_poles?.map((entry) => entry.pole_id) ?? [],
  };
}

async function topologyConfidence(incident: {
  dt_id: string | null;
  first_dark_pole_id: string | null;
}): Promise<number> {
  if (!incident.dt_id || !incident.first_dark_pole_id) return 1;
  const edges = await prisma.topologyEdge.findMany({ where: { dt_id: incident.dt_id } });
  const parentByChild = new Map(edges.map((edge) => [edge.child_pole_id, edge]));
  const confidences: number[] = [];
  let current = incident.first_dark_pole_id;
  while (parentByChild.has(current)) {
    const edge = parentByChild.get(current)!;
    confidences.push(edge.confidence);
    current = edge.parent_pole_id;
  }
  return confidences.length ? Math.min(...confidences) : 1;
}

/** Map payload, kept deliberately read-only for five-second client polling. */
router.get("/network", async (_req: Request, res: Response): Promise<void> => {
  try {
    const [poles, transformers, topologyEdges, incidents] = await Promise.all([
      prisma.pole.findMany({
        select: {
          pole_id: true,
          lat: true,
          lon: true,
          feeder_id: true,
          dt_id: true,
          device_id: true,
          pole_state: { select: { energized: true, last_seen_at: true, last_event: true } },
        },
      }),
      prisma.transformer.findMany({ select: { dt_id: true, feeder_id: true, lat: true, lon: true } }),
      prisma.topologyEdge.findMany({
        select: { dt_id: true, parent_pole_id: true, child_pole_id: true, source: true, confidence: true },
      }),
      prisma.incident.findMany({
        where: { status: { in: [IncidentStatus.active, IncidentStatus.suppressed] } },
        include: { incident_poles: { select: { pole_id: true } } },
      }),
    ]);
    const now = new Date();
    res.json({
      poles: poles.map((pole) => ({
        ...pole,
        effective_status: getEffectiveStatus(pole.pole_state, now),
      })),
      transformers,
      topology_edges: topologyEdges,
      active_incidents: incidents.map(toIncidentSummary),
    });
  } catch (error) {
    console.error("[dashboard] Unable to load network:", error);
    res.status(500).json({ error: "unable to load network" });
  }
});

router.get("/incidents", async (_req: Request, res: Response): Promise<void> => {
  try {
    const incidents = await prisma.incident.findMany({
      orderBy: { created_at: "desc" },
      include: { incident_poles: { select: { pole_id: true } } },
    });
    res.json({ incidents: incidents.map(toIncidentSummary) });
  } catch (error) {
    console.error("[dashboard] Unable to load incidents:", error);
    res.status(500).json({ error: "unable to load incidents" });
  }
});

router.get("/incidents/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "incident id must be an integer" });
    return;
  }
  try {
    const incident = await prisma.incident.findUnique({
      where: { id },
      include: {
        incident_poles: {
          include: { pole: { select: { pole_id: true, lat: true, lon: true, device_id: true, pole_state: true } } },
        },
      },
    });
    if (!incident) {
      res.status(404).json({ error: "incident not found" });
      return;
    }
    res.json({
      incident: {
        ...toIncidentSummary(incident),
        topology_confidence: await topologyConfidence(incident),
        affected_assets: incident.incident_poles.map((entry) => ({
          pole_id: entry.pole.pole_id,
          device_id: entry.pole.device_id,
          energized: entry.pole.pole_state?.energized ?? null,
          effective_status: getEffectiveStatus(entry.pole.pole_state),
        })),
      },
    });
  } catch (error) {
    console.error("[dashboard] Unable to load incident:", error);
    res.status(500).json({ error: "unable to load incident" });
  }
});

router.post("/incidents/:id/resolve", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "incident id must be an integer" });
    return;
  }
  try {
    const incident = await prisma.incident.findUnique({
      where: { id },
      include: { incident_poles: { include: { pole: { include: { pole_state: true } } } } },
    });
    if (!incident) {
      res.status(404).json({ error: "incident not found" });
      return;
    }
    const darkPoles = incident.incident_poles.filter(
      (entry) => entry.pole.pole_state?.energized !== true
    );
    if (darkPoles.length) {
      res.status(409).json({
        error: `Cannot resolve: ${darkPoles.length} affected pole${darkPoles.length === 1 ? "" : "s"} remain de-energized.`,
        dark_pole_ids: darkPoles.map((entry) => entry.pole_id),
      });
      return;
    }
    const resolved = await prisma.incident.update({
      where: { id },
      data: { status: IncidentStatus.resolved },
    });
    res.json({ incident: toIncidentSummary(resolved) });
  } catch (error) {
    console.error("[dashboard] Unable to resolve incident:", error);
    res.status(500).json({ error: "unable to resolve incident" });
  }
});

export default router;
