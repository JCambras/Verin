/**
 * Decision Spine view-model generation (design §4). The spine is generated from the
 * typed decision view model ONLY: stations before the journey's position are done, the
 * position is active, everything beyond stays pending. It never renders a station the
 * record has not reached, and it shows position, never disposition (the one optional
 * StatusBadge slot at the right end is the only state it may carry).
 */
import { SPINE_STATIONS, type DecisionSpineVM, type SpineStationId } from "./model";

export function buildSpine(active: SpineStationId, stateSlot?: { status: string; label: string }): DecisionSpineVM {
  const activeIdx = SPINE_STATIONS.indexOf(active);
  return {
    stations: SPINE_STATIONS.map((id, i) => ({
      id,
      state: i < activeIdx ? "done" : i === activeIdx ? "active" : "pending",
    })),
    stateSlot: stateSlot ?? null,
  };
}
