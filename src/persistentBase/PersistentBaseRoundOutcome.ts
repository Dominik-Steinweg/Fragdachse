import type { RoundConclusion } from '../network/NetworkBridge';
import type { PersistentBaseRoomSession } from './PersistentBaseRoomSession';
import type { PersistentBaseTransactionIdentity } from './PersistentBaseTransaction';
import type { PersistentPlayerBaseContribution } from './PersistentBaseTypes';

/**
 * Wie eine beendete Runde mit dem persistenten Arbeitsstand umgeht. Nur ein Sieg schreibt fort;
 * Niederlage, Host-Abbruch und der technische Abbruch (kein Abschluss, `null`) verwerfen ihn.
 */
export type PersistentBaseRoundOutcome = 'commit' | 'rollback';

/** Nur der Anteil des Raumzustands, den der Rundenabschluss braucht. */
type PersistentBaseRoomSessionLike =
  Pick<PersistentBaseRoomSession, 'hasOpenTransaction' | 'completeTransaction'>;

export interface PersistentBaseRoundTargets {
  /**
   * Der raumlanglebige Zustand der persistenten Basis. Er lebt laenger als eine Runde - ein Gast
   * bleibt ueber einen Kartenwechsel hinweg Besitzer seiner Konstruktionen - und wird deshalb
   * immer uebergeben, auch wenn gerade keine Mission laeuft.
   */
  readonly session: PersistentBaseRoomSessionLike;
  /** Nur noch lebende Runtime-Objekte werden fortgeschrieben. */
  readonly isRuntimeObjectAlive: (runtimeId: number) => boolean;
  /**
   * Die Instanz, deren Abschluss das hier ist.
   *
   * Ohne Angabe gilt der Abschluss fuer den gerade offenen Arbeitsstand; mit Angabe laeuft ein
   * verspaeteter Abschluss ins Leere, statt eine inzwischen neue Activity zu treffen.
   */
  readonly identity?: PersistentBaseTransactionIdentity;
}

export function resolvePersistentBaseRoundOutcome(
  roundConclusion: RoundConclusion | null,
): PersistentBaseRoundOutcome {
  return roundConclusion === 'victory' ? 'commit' : 'rollback';
}

/**
 * Wendet den Ausgang auf den offenen Arbeitsstand an.
 *
 * Ein Sieg liefert je Besitzer genau einen bestaetigten neuen Beitrag; der Aufrufer stellt ihn
 * dem jeweiligen Besitzer zu, der ihn dann - und nur dann - lokal speichern darf. Jeder andere
 * Ausgang liefert nichts: Der zuletzt bestaetigte Stand jedes Besitzers bleibt unveraendert.
 *
 * Beitraege und Belohnungen teilen sich denselben Arbeitsstand und damit denselben Abschluss.
 */
export function applyPersistentBaseRoundOutcome(
  outcome: PersistentBaseRoundOutcome,
  targets: PersistentBaseRoundTargets,
): readonly PersistentPlayerBaseContribution[] {
  if (!targets.session.hasOpenTransaction) return [];
  return targets.session.completeTransaction(
    outcome,
    targets.isRuntimeObjectAlive,
    targets.identity,
  );
}
