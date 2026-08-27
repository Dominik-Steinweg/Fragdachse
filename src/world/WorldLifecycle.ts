import { ActivityLifecycle, type ActivityLifecycleSink } from './ActivityLifecycle';
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
  /** Host-only: beendet die replizierte World-Instanz. */
  readonly clear: () => void;
  /** Bindet die lokale World-Runtime an die laufende Instanz. */
  readonly attach: (context: WorldRuntimeContext) => void;
  /** Loest die lokale World-Runtime. */
  readonly detach: () => void;
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

  /**
   * Die Activity dieser World. Eigener Lebenszyklus, weil eine World ohne Activity bestehen
   * kann – aber niemals umgekehrt.
   */
  readonly activity: ActivityLifecycle;

  constructor(private readonly sink: WorldLifecycleSink) {
    this.activity = new ActivityLifecycle(
      sink.activity ?? INERT_ACTIVITY_SINK,
      () => this.descriptor !== null,
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
    if (this.instanceDescriptor && !isSameWorldInstance(this.instanceDescriptor, context.descriptor)) {
      throw new Error(
        `[WorldLifecycle] Runtime for world ${context.descriptor.definitionId}`
        + ` does not match the created instance ${this.instanceDescriptor.definitionId}`,
      );
    }
    if (this.currentContext) this.detachRuntime();
    // Ein Client beobachtet die Instanz nur; fuer ihn beginnt sie mit seiner Runtime.
    this.instanceDescriptor = context.descriptor;
    this.currentContext = context;
    this.currentPhase = 'active';
    this.sink.attach(context);
    // Erst steht die World, dann ihre Activity – nie umgekehrt. Ein Client eroeffnet die
    // beobachtete Activity hier, weil er sie nicht selbst erzeugt hat.
    if (observedActivity && !this.activity.descriptor) this.activity.begin(observedActivity);
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

  /**
   * Beendet die World-Instanz vollstaendig: lokale Runtime und replizierter Kanal. Idempotent,
   * damit Rundenabschluss, Diagnose-Abbruch und technischer Abbruch denselben Weg nehmen koennen.
   */
  endInstance(): void {
    this.currentPhase = 'destroying';
    // Mit der World endet zwingend auch ihre Activity.
    this.activity.end();
    const hadContext = this.currentContext !== null;
    this.currentContext = null;
    this.instanceDescriptor = null;
    if (hadContext) this.sink.detach();
    this.sink.clear();
    this.currentPhase = 'none';
  }
}
