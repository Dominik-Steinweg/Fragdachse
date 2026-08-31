import type { CoopMissionOutcome } from './CoopMissionRuntime';
import type { ActivityDescriptor } from '../world/ActivityDescriptor';

/** Das activity-spezifische Ergebnis einer regulaer beendeten Coop-Mission. */
export interface CoopMissionResult {
  readonly outcome: CoopMissionOutcome;
}

/**
 * Revisionsgebundener Abschluss genau einer lokal laufenden Activity.
 *
 * Ein regulaeres Ergebnis und ein Abbruch sind absichtlich getrennte Varianten: Ein Abbruch
 * beendet denselben Lifecycle, ist aber weder Sieg noch Niederlage und darf keine Victory-Folgen
 * ausloesen.
 */
export type ActivityCompletion = CoopMissionActivityCompletion;

export interface CoopMissionActivityCompletion {
  readonly worldRevision: number;
  readonly activityRevision: number;
  readonly definitionId: string;
  readonly kind: 'coop-mission';
  readonly conclusion:
    | { readonly type: 'result'; readonly result: CoopMissionResult }
    | { readonly type: 'abort' };
}

export function createCoopMissionCompletion(
  activity: ActivityDescriptor,
  conclusion: CoopMissionOutcome | 'aborted',
): CoopMissionActivityCompletion {
  if (activity.kind !== 'coop-mission') {
    throw new Error(
      `[ActivityCompletion] Activity ${activity.definitionId} is ${activity.kind}, not coop-mission`,
    );
  }
  return {
    worldRevision: activity.worldRevision,
    activityRevision: activity.activityRevision,
    definitionId: activity.definitionId,
    kind: 'coop-mission',
    conclusion: conclusion === 'aborted'
      ? { type: 'abort' }
      : { type: 'result', result: { outcome: conclusion } },
  };
}

/** Stale, fremde oder bereits abgeloeste Activity-Abschluesse passen nicht. */
export function isCompletionForActivity(
  completion: ActivityCompletion,
  activity: ActivityDescriptor | null,
): boolean {
  return activity !== null
    && completion.worldRevision === activity.worldRevision
    && completion.activityRevision === activity.activityRevision
    && completion.definitionId === activity.definitionId
    && completion.kind === activity.kind;
}

export function getCoopMissionConclusion(
  completion: CoopMissionActivityCompletion,
): CoopMissionOutcome | 'aborted' {
  return completion.conclusion.type === 'abort'
    ? 'aborted'
    : completion.conclusion.result.outcome;
}
