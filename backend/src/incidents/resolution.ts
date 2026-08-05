import type { PoleState } from "@prisma/client";
import { getEffectiveStatus } from "../localization/engine";

type IncidentPoleState = Pick<PoleState, "energized" | "last_event" | "last_seen_at"> | null;

/** A manual resolution can never override a currently dark telemetry state. */
export function findDeenergizedAffectedPoleIds(
  poles: Array<{ pole_id: string; pole: { pole_state: IncidentPoleState } }>,
  now = new Date()
): string[] {
  return poles
    .filter(({ pole }) =>
      pole.pole_state?.energized === false ||
      getEffectiveStatus(pole.pole_state, now) === "dark"
    )
    .map(({ pole_id }) => pole_id);
}
