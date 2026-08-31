import type { ActivityKind } from '../config/authoring/ActivityDefinition';
import type { ActivityDescriptor } from './ActivityDescriptor';

/**
 * Lebenszyklus der Activity innerhalb einer World.
 *
 * Eine Activity setzt zwingend eine aktive World voraus – umgekehrt gilt das nicht. Deshalb ist
 * sie ein eigener Lebenszyklus neben dem der World und nicht ein weiteres Feld darin: eine
 * friedliche World laeuft mit `phase === 'none'` weiter, ohne dass irgendwo Missionssysteme
 * "auf null" gesetzt werden muessten.
 */
export type ActivityLifecyclePhase = 'none' | 'creating' | 'active' | 'ending';

export interface ActivityLifecycleSink {
  /** Die lokale Activity-Runtime dieser World laeuft ab jetzt. */
  readonly attach: (activity: ActivityDescriptor) => void;
  /** Die lokale Activity-Runtime endet. */
  readonly detach: () => void;
}

/**
 * Die fachliche Activity-Identity beginnt oder endet. Dieser Vertrag ist bewusst vom lokalen
 * Runtime-Sink getrennt: Ein Runtime-Detach darf die Identity und ihren langlebigen Working State
 * nicht beenden.
 */
export interface ActivityIdentityLifecycleSink {
  /** Resolves the stable round anchor when a new Activity identity begins. */
  readonly resolveStartAnchor?: (
    activity: ActivityDescriptor,
    previousActivity: ActivityDescriptor | null,
  ) => number | null;
  readonly begin: (activity: ActivityDescriptor) => void;
  readonly end: (activity: ActivityDescriptor) => void;
}

const INERT_ACTIVITY_IDENTITY_SINK: ActivityIdentityLifecycleSink = {
  begin: () => { /* noop */ },
  end: () => { /* noop */ },
};

export class ActivityLifecycle {
  private currentPhase: ActivityLifecyclePhase = 'none';
  private currentDescriptor: ActivityDescriptor | null = null;
  private currentStartAnchor: number | null = null;

  /**
   * @param hasWorld Meldet, ob eine World-Instanz existiert. Ohne sie gibt es keine Activity –
   *   die Regel steht hier und nicht bei den Aufrufern.
   */
  constructor(
    private readonly sink: ActivityLifecycleSink,
    private readonly hasWorld: () => boolean,
    private readonly identitySink: ActivityIdentityLifecycleSink = INERT_ACTIVITY_IDENTITY_SINK,
  ) {}

  get phase(): ActivityLifecyclePhase {
    return this.currentPhase;
  }

  /** Identitaet der Activity, die gerade entsteht oder laeuft; `null` fuer eine World ohne Activity. */
  get descriptor(): ActivityDescriptor | null {
    return this.currentDescriptor;
  }

  /** Art der laufenden oder entstehenden Activity; `null` fuer eine World ohne Activity. */
  get kind(): ActivityKind | null {
    return this.currentDescriptor?.kind ?? null;
  }

  /** Stable anchor of this Activity identity; it survives local runtime detach/reattach. */
  get startAnchor(): number | null {
    return this.currentStartAnchor;
  }

  /** True before the authoritative round start binds an initially pending Activity. */
  get isStartAnchorPending(): boolean {
    return this.currentDescriptor !== null && this.currentStartAnchor === null;
  }

  isActive(): boolean {
    return this.currentPhase === 'active';
  }

  /** True, solange diese World eine Activity der angegebenen Art fuehrt. */
  is(kind: ActivityKind): boolean {
    return this.kind === kind;
  }

  /** Eroeffnet die Activity dieser World-Instanz. */
  begin(activity: ActivityDescriptor): void {
    if (!this.hasWorld()) {
      throw new Error(
        `[ActivityLifecycle] Activity ${activity.definitionId} needs an active world instance`,
      );
    }
    if (this.currentDescriptor && isSameActivity(this.currentDescriptor, activity)) return;
    const previousActivity = this.currentDescriptor;
    if (previousActivity) this.end();
    this.currentStartAnchor = normalizeStartAnchor(
      this.identitySink.resolveStartAnchor?.(activity, previousActivity) ?? null,
    );
    this.identitySink.begin(activity);
    this.currentDescriptor = activity;
    this.currentPhase = 'creating';
  }

  /** Die lokale Runtime der Activity steht. Ohne eroeffnete Activity bleibt der Aufruf wirkungslos. */
  activate(): void {
    if (!this.currentDescriptor) return;
    if (!this.hasWorld()) {
      throw new Error(
        `[ActivityLifecycle] Activity ${this.currentDescriptor.definitionId} lost its world instance`,
      );
    }
    if (this.currentPhase === 'active') return;
    this.currentPhase = 'active';
    this.sink.attach(this.currentDescriptor);
  }

  /** Binds the authoritative round start without recreating the Activity runtime. */
  bindStartAnchor(startAnchor: number): void {
    if (!this.currentDescriptor || this.currentStartAnchor !== null || !Number.isFinite(startAnchor)) return;
    const normalized = normalizeStartAnchor(startAnchor);
    if (normalized !== null) this.currentStartAnchor = normalized;
  }

  /** Loest nur die lokale Runtime; die Activity-Instanz bleibt bestehen. */
  detachRuntime(): void {
    if (this.currentPhase !== 'active') return;
    this.currentPhase = 'creating';
    this.sink.detach();
  }

  /** Beendet die Activity vollstaendig. Idempotent; wird auch vom Ende der World ausgeloest. */
  end(): void {
    if (!this.currentDescriptor && this.currentPhase === 'none') return;
    const endingDescriptor = this.currentDescriptor;
    const wasActive = this.currentPhase === 'active';
    this.currentPhase = 'ending';
    this.currentDescriptor = null;
    if (wasActive) this.sink.detach();
    if (endingDescriptor) this.identitySink.end(endingDescriptor);
    this.currentStartAnchor = null;
    this.currentPhase = 'none';
  }
}

function normalizeStartAnchor(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

function isSameActivity(left: ActivityDescriptor, right: ActivityDescriptor): boolean {
  return left.activityRevision === right.activityRevision
    && left.worldRevision === right.worldRevision
    && left.kind === right.kind
    && left.definitionId === right.definitionId;
}
