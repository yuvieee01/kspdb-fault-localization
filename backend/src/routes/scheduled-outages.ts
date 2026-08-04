import { Request, Response, Router } from "express";
import { listScheduledOutages } from "../scheduled-outages/service";

const router = Router();

function parseDate(value: unknown, fallback: Date): Date | null {
  if (typeof value !== "string") return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Mock integration matching DATA_CONTRACTS.md: GET /scheduled-outages?from=&to=.
 * The database is intentionally the mocked feed's backing store, rather than a
 * second source of truth beside the suppression algorithm.
 */
router.get("/scheduled-outages", async (req: Request, res: Response): Promise<void> => {
  const now = new Date();
  const from = parseDate(req.query.from, new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const to = parseDate(req.query.to, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
  if (!from || !to || from > to) {
    res.status(400).json({ error: "from and to must be valid ISO timestamps with from <= to" });
    return;
  }
  try {
    const outages = await listScheduledOutages(from, to);
    res.json(outages.map((outage) => ({
      id: outage.id,
      scope: outage.scope,
      target_id: outage.target_id,
      start: outage.start.toISOString(),
      end: outage.end.toISOString(),
      reason: outage.reason,
    })));
  } catch (error) {
    console.error("[scheduled-outages] Unable to load mock feed:", error);
    res.status(500).json({ error: "unable to load scheduled outages" });
  }
});

export default router;
