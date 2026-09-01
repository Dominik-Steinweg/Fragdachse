import type { SyncedCoopDefenseCarryItem } from '../../types';

export type CoopDefenseCarryPresentationSnapshot = readonly SyncedCoopDefenseCarryItem[];

export interface CoopDefenseCarryPresentationSource {
  getSnapshot(): CoopDefenseCarryPresentationSnapshot;
}

/** Role-aware read without adding a second mutable presentation state. */
export function resolveCoopDefenseCarryPresentationSnapshot(
  isHost: boolean,
  authoritative: CoopDefenseCarryPresentationSource | null,
  replicated: CoopDefenseCarryPresentationSnapshot,
): CoopDefenseCarryPresentationSnapshot {
  return isHost ? authoritative?.getSnapshot() ?? [] : replicated;
}
