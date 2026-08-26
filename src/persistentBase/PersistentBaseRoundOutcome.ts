import type { RoundConclusion } from '../network/NetworkBridge';
import type { PersistentBaseRoomState } from './PersistentBaseRoomState';
import type { PersistentBaseSession } from './PersistentBaseSession';

/**
 * Wie eine beendete Runde mit dem persistenten Arbeitsstand umgeht. Nur ein Sieg schreibt fort;
 * Niederlage, Host-Abbruch und der technische Abbruch (kein Abschluss, `null`) verwerfen ihn.
 */
export type PersistentBaseRoundOutcome = 'commit' | 'rollback';

/** Nur der Anteil der Mission-Session, den der Rundenabschluss braucht. */
type PersistentBaseSessionLike = Pick<PersistentBaseSession, 'commit' | 'discard'>;

/** Nur der Anteil des raumweiten Gastzustands, den der Rundenabschluss braucht. */
type PersistentBaseRoomStateLike = Pick<PersistentBaseRoomState, 'hasActiveMission' | 'commit' | 'rollback'>;

export interface PersistentBaseRoundTargets {
  /** Host-eigene Mission-Session; `null`, wenn die Map keine persistente Basis besitzt. */
  readonly session: PersistentBaseSessionLike | null;
  /** Raumweiter Gastzustand; lebt laenger als eine Runde und wird deshalb immer uebergeben. */
  readonly roomState: PersistentBaseRoomStateLike;
  /** Nur noch lebende Runtime-Objekte werden fortgeschrieben. */
  readonly isRuntimeObjectAlive: (runtimeId: number) => boolean;
}

export function resolvePersistentBaseRoundOutcome(
  roundConclusion: RoundConclusion | null,
): PersistentBaseRoundOutcome {
  return roundConclusion === 'victory' ? 'commit' : 'rollback';
}

/**
 * Wendet den Ausgang auf beide persistenten Zustaende an. Host-eigene Session und Gastzustand
 * folgen bewusst demselben Ausgang, damit eine Runde nie halb fortgeschrieben werden kann.
 */
export function applyPersistentBaseRoundOutcome(
  outcome: PersistentBaseRoundOutcome,
  targets: PersistentBaseRoundTargets,
): void {
  const { session, roomState, isRuntimeObjectAlive } = targets;
  if (outcome === 'commit') {
    session?.commit(isRuntimeObjectAlive);
    if (roomState.hasActiveMission) roomState.commit(isRuntimeObjectAlive);
    return;
  }
  session?.discard();
  if (roomState.hasActiveMission) roomState.rollback();
}
