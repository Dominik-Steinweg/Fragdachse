import type { PersistentBaseRewardId } from '../persistentBase/PersistentBaseRewardTypes';
import type { PersistentBaseRoundOutcome } from '../persistentBase/PersistentBaseRoundOutcome';
import type { PersistentBaseTransactionIdentity } from '../persistentBase/PersistentBaseTransaction';
import type { ActivityDescriptor } from '../world/ActivityDescriptor';
import {
  getCoopMissionConclusion,
  isCompletionForActivity,
  type CoopMissionActivityCompletion,
} from './ActivityCompletion';

/**
 * Konkrete Infrastrukturfolgen eines Missionsabschlusses.
 *
 * Der Owner entscheidet ueber die Reihenfolge und stale Semantik; der Adapter am Arena-Layer
 * kennt Netzwerk, lokale Host-Persistenz und die raumlanglebige Persistent-Base-Session.
 */
export interface ResultApplicationPort {
  readonly getCurrentActivity: () => ActivityDescriptor | null;
  /** Belohnungen der abgeschlossenen, noch aktuellen Activity-Instanz. */
  readonly resolveVictoryRewardIds: (activity: ActivityDescriptor) => readonly PersistentBaseRewardId[];
  readonly grantPersistentBaseRewards: (rewardIds: readonly PersistentBaseRewardId[]) => void;
  readonly completeVictoryHolds?: () => void;
  readonly applyPersistentBaseOutcome: (
    outcome: PersistentBaseRoundOutcome,
    identity: PersistentBaseTransactionIdentity,
  ) => void;
  readonly publishCompletion: (
    completion: CoopMissionActivityCompletion,
    endedAt: number,
  ) => void;
}

/** Wendet genau einen aktuellen Coop-Missionsabschluss auf seine realen Consumer an. */
export class ResultApplication {
  private appliedCompletionKey: string | null = null;

  constructor(private readonly port: ResultApplicationPort) {}

  /**
   * Stale und doppelte Abschluesse bleiben vollstaendig wirkungslos.
   *
   * Der Schluessel wird vor den Folgen gesetzt: Ein Effect darf den Lifecycle synchron beenden,
   * ohne denselben Abschluss dadurch erneut anwendbar zu machen.
   */
  apply(completion: CoopMissionActivityCompletion, endedAt: number): boolean {
    const activity = this.port.getCurrentActivity();
    if (!activity || !isCompletionForActivity(completion, activity)) return false;
    const key = completionKey(completion);
    if (this.appliedCompletionKey === key) return false;
    this.appliedCompletionKey = key;

    const conclusion = getCoopMissionConclusion(completion);
    if (conclusion === 'victory') {
      this.port.completeVictoryHolds?.();
      this.port.grantPersistentBaseRewards(
        this.port.resolveVictoryRewardIds(activity),
      );
    }
    this.port.applyPersistentBaseOutcome(
      conclusion === 'victory' ? 'commit' : 'rollback',
      {
        worldRevision: completion.worldRevision,
        activityRevision: completion.activityRevision,
      },
    );
    this.port.publishCompletion(completion, endedAt);
    return true;
  }
}

function completionKey(completion: CoopMissionActivityCompletion): string {
  return `${completion.worldRevision}:${completion.activityRevision}:${completion.definitionId}`;
}
