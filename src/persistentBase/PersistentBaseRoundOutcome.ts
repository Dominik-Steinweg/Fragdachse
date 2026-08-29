import type { RoundConclusion } from '../network/NetworkBridge';
import type { PersistentBaseContributionStore } from './PersistentBaseContributionStore';
import type { PersistentPlayerBaseContribution } from './PersistentBaseTypes';
import type { PersistentBaseRewardStore } from './PersistentBaseRewardStore';

/**
 * Wie eine beendete Runde mit dem persistenten Arbeitsstand umgeht. Nur ein Sieg schreibt fort;
 * Niederlage, Host-Abbruch und der technische Abbruch (kein Abschluss, `null`) verwerfen ihn.
 */
export type PersistentBaseRoundOutcome = 'commit' | 'rollback';

/** Nur der Anteil des Beitragsspeichers, den der Rundenabschluss braucht. */
type PersistentBaseContributionStoreLike =
  Pick<PersistentBaseContributionStore, 'hasActiveMission' | 'commit' | 'rollback'>;

export interface PersistentBaseRoundTargets {
  /**
   * Host-seitiger Arbeitsstand aller Beitraege. Er lebt laenger als eine Runde - ein Gast bleibt
   * ueber einen Kartenwechsel hinweg Besitzer seiner Konstruktionen - und wird deshalb immer
   * uebergeben, auch wenn gerade keine Mission laeuft.
   */
  readonly contributions: PersistentBaseContributionStoreLike;
  /** Nur noch lebende Runtime-Objekte werden fortgeschrieben. */
  readonly isRuntimeObjectAlive: (runtimeId: number) => boolean;
  /** Persistent reward store follows the same victory/rollback boundary as contributions. */
  readonly rewards?: Pick<PersistentBaseRewardStore, 'hasActiveMission' | 'commit' | 'rollback'>;
}

export function resolvePersistentBaseRoundOutcome(
  roundConclusion: RoundConclusion | null,
): PersistentBaseRoundOutcome {
  return roundConclusion === 'victory' ? 'commit' : 'rollback';
}

/**
 * Wendet den Ausgang auf alle persoenlichen Beitraege gemeinsam an.
 *
 * Ein Sieg liefert je Besitzer genau einen bestaetigten neuen Beitrag; der Aufrufer stellt ihn
 * dem jeweiligen Besitzer zu, der ihn dann - und nur dann - lokal speichern darf. Jeder andere
 * Ausgang liefert nichts: Der zuletzt bestaetigte Stand jedes Besitzers bleibt unveraendert.
 */
export function applyPersistentBaseRoundOutcome(
  outcome: PersistentBaseRoundOutcome,
  targets: PersistentBaseRoundTargets,
): readonly PersistentPlayerBaseContribution[] {
  const { contributions, isRuntimeObjectAlive } = targets;
  const contributionActive = contributions.hasActiveMission;
  const rewardsActive = targets.rewards?.hasActiveMission === true;
  if (!contributionActive && !rewardsActive) return [];
  if (outcome === 'commit') {
    const confirmed = contributionActive ? contributions.commit(isRuntimeObjectAlive) : [];
    if (rewardsActive) targets.rewards?.commit();
    return confirmed;
  }
  if (contributionActive) contributions.rollback();
  if (rewardsActive) targets.rewards?.rollback();
  return [];
}
