import {
  ActivityLifecycle,
  type ActivityIdentityLifecycleSink,
  type ActivityLifecycleSink,
} from './ActivityLifecycle';
import type { ActivityDescriptor } from './ActivityDescriptor';
import { isSameWorldInstance, type WorldDescriptor } from './WorldDescriptor';
import type { WorldRuntimeContext } from './WorldRuntimeContext';

/**
 * Lebenszyklus genau einer World-Instanz.
 *
 * Bisher war "es gibt eine World" aus drei Quellen zu rekonstruieren: dem replizierten Kanal,
 * dem lokalen `ArenaContext.world` und dem Aufbaustand der Arena. Erzeugt und beendet wurde sie
 * an sechs verstreuten Stellen. Dieser Besitzer haelt den Zustand explizit und ist der einzige
 * Ort, der ihn wechselt.
 *
 * Die Instanz und ihre lokale Realisierung sind bewusst zwei Schritte: der Host eroeffnet die
 * Instanz beim Publizieren, jeder Peer haengt danach seine eigene Runtime daran. Ein Teardown
 * loest nur die lokale Runtime – die replizierte Instanz endet erst mit {@link endInstance}.
 */
export type WorldLifecyclePhase = 'none' | 'creating' | 'active' | 'destroying';

export interface WorldLifecycleSink {
  /** Host-only: repliziert die neue World-Instanz. */
  readonly publish: (world: WorldDescriptor, activity: ActivityDescriptor | null) => void;
  /** Host-only: ändert die Activity, ohne die laufende World neu zu erzeugen. */
  readonly publishActivity?: (activity: ActivityDescriptor | null) => void;
  /** Host-only: beendet die replizierte World-Instanz. */
  readonly clear: () => void;
  /** Bindet die lokale World-Runtime an die laufende Instanz. */
  readonly attach: (context: WorldRuntimeContext) => void;
  /** Loest die lokale World-Runtime. */
  readonly detach: () => void;
  /** Activity-Identity: getrennt von Attach/Detach der lokalen Activity-Runtime. */
  readonly activityIdentity?: ActivityIdentityLifecycleSink;
  /** Lokale Runtime der Activity dieser World; fehlt fuer eine World ohne Activity. */
  readonly activity?: ActivityLifecycleSink;
}

/** Fallback fuer Worlds, deren Activity noch keine eigene lokale Runtime besitzt. */
const INERT_ACTIVITY_SINK: ActivityLifecycleSink = {
  attach: () => { /* noop */ },
  detach: () => { /* noop */ },
};

export class WorldLifecycle {
  private currentPhase: WorldLifecyclePhase = 'none';
  private currentContext: WorldRuntimeContext | null = null;
  /**
   * Identitaet der laufenden Instanz. Sie ueberlebt einen lokalen Teardown: die replizierte
   * World endet erst mit {@link endInstance}, nicht mit dem Fall ihrer Runtime.
   */
  private instanceDescriptor: WorldDescriptor | null = null;
  /** Highest revision that was completely ended on this local lifecycle. */
  private lastEndedWorldRevision = 0;

  /**
   * Die Activity dieser World. Eigener Lebenszyklus, weil eine World ohne Activity bestehen
   * kann – aber niemals umgekehrt.
   */
  readonly activity: ActivityLifecycle;

  constructor(private readonly sink: WorldLifecycleSink) {
    this.activity = new ActivityLifecycle(
      sink.activity ?? INERT_ACTIVITY_SINK,
      () => this.descriptor !== null,
      sink.activityIdentity,
    );
  }

  get phase(): WorldLifecyclePhase {
    return this.currentPhase;
  }

  /** Lokale World-Runtime der laufenden Instanz; `null`, solange keine steht. */
  get context(): WorldRuntimeContext | null {
    return this.currentContext;
  }

  /** Identitaet der World, die gerade entsteht oder laeuft. */
  get descriptor(): WorldDescriptor | null {
    return this.instanceDescriptor;
  }

  isActive(): boolean {
    return this.currentPhase === 'active';
  }

  /**
   * Host: eroeffnet eine neue World-Instanz und repliziert sie. Eine noch laufende Instanz wird
   * dabei zuerst beendet – zwei gleichzeitige Instanzen gibt es nicht.
   */
  beginCreate(world: WorldDescriptor, activity: ActivityDescriptor | null): void {
    assertActivityBelongsToWorld(world, activity);
    if (world.worldRevision <= this.lastEndedWorldRevision) {
      throw new Error(
        `[WorldLifecycle] Cannot recreate ended world revision ${world.worldRevision}; `
        + `latest ended revision is ${this.lastEndedWorldRevision}`,
      );
    }

    // Two admission requests for the same first World are one transition, not two instances.
    // A changed Activity may still be attached to the already existing World below.
    if (this.instanceDescriptor && isSameWorldInstance(this.instanceDescriptor, world)) {
      const activityChanged = !sameActivityOrNull(this.activity.descriptor, activity);
      if (activityChanged) this.sink.publishActivity?.(activity);
      this.syncActivity(activity, this.currentContext !== null, true);
      return;
    }

    // Die Activity der alten Instanz endet vollstaendig – sonst erbte eine World ohne Activity
    // die Mission der Vorgaengerin.
    this.activity.end();
    if (this.currentContext) this.detachRuntime();
    this.instanceDescriptor = world;
    this.currentPhase = 'creating';
    // World und Activity gehen atomar auf den Draht, damit nie eine Activity ohne ihre World
    // sichtbar wird. Ihre Lebenszyklen bleiben trotzdem getrennt.
    this.sink.publish(world, activity);
    if (activity) this.activity.begin(activity);
  }

  /**
   * Bindet die lokale Runtime an die laufende Instanz.
   *
   * Der Host hat die Instanz zuvor eroeffnet; die Runtime muss dieselbe World meinen. Ein Client
   * beobachtet die Instanz nur und haengt sich ohne vorheriges {@link beginCreate} an – er
   * uebergibt die beobachtete Activity deshalb hier.
   */
  attachRuntime(context: WorldRuntimeContext, observedActivity: ActivityDescriptor | null = null): void {
    assertActivityBelongsToWorld(context.descriptor, observedActivity);
    if (this.instanceDescriptor && !isSameWorldInstance(this.instanceDescriptor, context.descriptor)) {
      throw new Error(
        `[WorldLifecycle] Runtime for world ${context.descriptor.definitionId}`
        + ` does not match the created instance ${this.instanceDescriptor.definitionId}`,
      );
    }
    if (!this.instanceDescriptor && context.descriptor.worldRevision <= this.lastEndedWorldRevision) {
      throw new Error(
        `[WorldLifecycle] Ignoring stale runtime for ended world revision ${context.descriptor.worldRevision}`,
      );
    }
    if (this.currentContext && isSameWorldInstance(this.currentContext.descriptor, context.descriptor)) {
      this.syncActivity(observedActivity, true, false);
      return;
    }
    if (this.currentContext) this.detachRuntime();
    // Ein Client beobachtet die Instanz nur; fuer ihn beginnt sie mit seiner Runtime.
    this.instanceDescriptor = context.descriptor;
    this.currentContext = context;
    this.currentPhase = 'active';
    this.sink.attach(context);
    // Erst steht die World, dann ihre Activity – nie umgekehrt. Ein Client eroeffnet die
    // beobachtete Activity hier, weil er sie nicht selbst erzeugt hat.
    this.syncActivity(observedActivity, false, false);
    this.activity.activate();
  }

  /**
   * Loest die lokale World-Runtime. Die replizierte Instanz bleibt bestehen – ein Teardown
   * mitten im Aufbau derselben Instanz darf sie nicht beenden.
   *
   * Die Phase faellt deshalb auf `creating` zurueck, solange die Instanz existiert: es gibt eine
   * World, nur noch keine lokale Runtime dafuer. Erst {@link endInstance} macht daraus `none`.
   */
  detachRuntime(): void {
    const hadContext = this.currentContext !== null;
    // Die Activity faellt vor ihrer World.
    this.activity.detachRuntime();
    this.currentContext = null;
    this.currentPhase = this.instanceDescriptor ? 'creating' : 'none';
    if (hadContext) this.sink.detach();
  }

  /** Synchronisiert einen beobachteten Activity-Wechsel, ohne die bestehende World neu zu bauen. */
  syncObservedActivity(activity: ActivityDescriptor | null): void {
    if (!this.instanceDescriptor || !this.currentContext) return;
    assertActivityBelongsToWorld(this.instanceDescriptor, activity);
    this.syncActivity(activity, true, true);
  }

  /**
   * Beendet die World-Instanz vollstaendig: lokale Runtime und replizierter Kanal. Idempotent,
   * damit Rundenabschluss, Diagnose-Abbruch und technischer Abbruch denselben Weg nehmen koennen.
   */
  endInstance(): void {
    if (!this.instanceDescriptor && !this.currentContext && this.currentPhase === 'none') return;
    const endedRevision = this.instanceDescriptor?.worldRevision ?? 0;
    this.currentPhase = 'destroying';
    // Mit der World endet zwingend auch ihre Activity.
    this.activity.end();
    const hadContext = this.currentContext !== null;
    this.currentContext = null;
    this.instanceDescriptor = null;
    this.lastEndedWorldRevision = Math.max(this.lastEndedWorldRevision, endedRevision);
    if (hadContext) this.sink.detach();
    this.sink.clear();
    this.currentPhase = 'none';
  }

  private syncActivity(
    observedActivity: ActivityDescriptor | null,
    runtimeAttached: boolean,
    nullMeansNoActivity: boolean,
  ): void {
    if (observedActivity) {
      if (!this.activity.descriptor || !isSameActivity(this.activity.descriptor, observedActivity)) {
        this.activity.end();
        this.activity.begin(observedActivity);
      }
      if (runtimeAttached) this.activity.activate();
      return;
    }
    // `null` means a World without Activity. A local host-created Activity is not removed by a
    // runtime attach without an observation; only an explicit null on the same World ends it.
    if (nullMeansNoActivity && this.activity.descriptor) {
      this.activity.end();
    }
  }
}

function sameActivityOrNull(
  left: ActivityDescriptor | null,
  right: ActivityDescriptor | null,
): boolean {
  if (!left || !right) return left === right;
  return isSameActivity(left, right);
}

function assertActivityBelongsToWorld(
  world: WorldDescriptor,
  activity: ActivityDescriptor | null,
): void {
  if (activity && activity.worldRevision !== world.worldRevision) {
    throw new Error(
      `[WorldLifecycle] Activity ${activity.definitionId} belongs to world revision `
      + `${activity.worldRevision}, not ${world.worldRevision}`,
    );
  }
}

function isSameActivity(left: ActivityDescriptor, right: ActivityDescriptor): boolean {
  return left.activityRevision === right.activityRevision
    && left.worldRevision === right.worldRevision
    && left.kind === right.kind
    && left.definitionId === right.definitionId;
}
