import { OutageScope } from "@prisma/client";
import prisma from "../db";

export const OUTAGE_EARLY_TOLERANCE_MS = 10 * 60 * 1000;
export const OUTAGE_LATE_TOLERANCE_MS = 40 * 60 * 1000;

export interface ScheduledOutageRecord {
  id: string;
  scope: OutageScope;
  target_id: string;
  start: Date;
  end: Date;
  reason: string;
}

export interface OutageTarget {
  dtId: string | null;
  feederId: string;
}

export function isWithinOutageTolerance(outage: Pick<ScheduledOutageRecord, "start" | "end">, now: Date): boolean {
  const toleranceStart = outage.start.getTime() - OUTAGE_EARLY_TOLERANCE_MS;
  const toleranceEnd = outage.end.getTime() + OUTAGE_LATE_TOLERANCE_MS;
  return now.getTime() >= toleranceStart && now.getTime() <= toleranceEnd;
}

/**
 * Uses the schedule only as a bounded false-positive signal. Once the late
 * tolerance ends, this returns null so persistent darkness is ticketed again.
 */
export function findMatchingOutage(
  outages: ScheduledOutageRecord[],
  target: OutageTarget,
  now: Date
): ScheduledOutageRecord | null {
  return outages.find((outage) => {
    const scopeMatches =
      (outage.scope === OutageScope.dt && outage.target_id === target.dtId) ||
      (outage.scope === OutageScope.feeder && outage.target_id === target.feederId);
    return scopeMatches && isWithinOutageTolerance(outage, now);
  }) ?? null;
}

/** Mock scheduled-outage feed used by GET /scheduled-outages and localization. */
export async function listScheduledOutages(from: Date, to: Date): Promise<ScheduledOutageRecord[]> {
  return prisma.scheduledOutage.findMany({
    where: {
      start: { lte: to },
      end: { gte: from },
    },
    orderBy: { start: "asc" },
  });
}

export async function findMatchingScheduledOutage(target: OutageTarget, now: Date): Promise<ScheduledOutageRecord | null> {
  const queryFrom = new Date(now.getTime() - OUTAGE_LATE_TOLERANCE_MS);
  const queryTo = new Date(now.getTime() + OUTAGE_EARLY_TOLERANCE_MS);
  const outages = await listScheduledOutages(queryFrom, queryTo);
  return findMatchingOutage(outages, target, now);
}
