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
}

export class WorldLifecycle {
  private currentPhase: WorldLifecyclePhase = 'none';
  private currentContext: WorldRuntimeContext | null = null;
  /** Identitaet einer host-seitig eroeffneten Instanz, solange keine Runtime daran haengt. */
  private pendingDescriptor: WorldDescriptor | null = null;

  constructor(private readonly sink: WorldLifecycleSink) {}

  get phase(): WorldLifecyclePhase {
    return this.currentPhase;
  }

  /** Lokale World-Runtime der laufenden Instanz; `null`, solange keine steht. */
  get context(): WorldRuntimeContext | null {
    return this.currentContext;
  }

  /** Identitaet der World, die gerade entsteht oder laeuft. */
  get descriptor(): WorldDescriptor | null {
    return this.currentContext?.descriptor ?? this.pendingDescriptor;
  }

  isActive(): boolean {
    return this.currentPhase === 'active';
  }

  /**
   * Host: eroeffnet eine neue World-Instanz und repliziert sie. Eine noch laufende Instanz wird
   * dabei zuerst beendet – zwei gleichzeitige Instanzen gibt es nicht.
   */
  beginCreate(world: WorldDescriptor, activity: ActivityDescriptor | null): void {
    if (this.currentContext) this.detachRuntime();
    this.pendingDescriptor = world;
    this.currentPhase = 'creating';
    this.sink.publish(world, activity);
  }

  /**
   * Bindet die lokale Runtime an die laufende Instanz.
   *
   * Der Host hat die Instanz zuvor eroeffnet; die Runtime muss dieselbe World meinen. Ein Client
   * beobachtet die Instanz nur und haengt sich ohne vorheriges {@link beginCreate} an.
   */
  attachRuntime(context: WorldRuntimeContext): void {
    if (this.pendingDescriptor && !isSameWorldInstance(this.pendingDescriptor, context.descriptor)) {
      throw new Error(
        `[WorldLifecycle] Runtime for world ${context.descriptor.definitionId}`
        + ` does not match the created instance ${this.pendingDescriptor.definitionId}`,
      );
    }
    if (this.currentContext) this.detachRuntime();
    this.pendingDescriptor = null;
    this.currentContext = context;
    this.currentPhase = 'active';
    this.sink.attach(context);
  }

  /**
   * Loest die lokale World-Runtime. Die replizierte Instanz bleibt bestehen – ein Teardown
   * mitten im Aufbau derselben Instanz darf sie nicht beenden.
   */
  detachRuntime(): void {
    const hadContext = this.currentContext !== null;
    this.currentContext = null;
    this.currentPhase = this.pendingDescriptor ? 'creating' : 'none';
    if (hadContext) this.sink.detach();
  }

  /**
   * Beendet die World-Instanz vollstaendig: lokale Runtime und replizierter Kanal. Idempotent,
   * damit Rundenabschluss, Diagnose-Abbruch und technischer Abbruch denselben Weg nehmen koennen.
   */
  endInstance(): void {
    this.currentPhase = 'destroying';
    const hadContext = this.currentContext !== null;
    this.currentContext = null;
    this.pendingDescriptor = null;
    if (hadContext) this.sink.detach();
    this.sink.clear();
    this.currentPhase = 'none';
  }
}
