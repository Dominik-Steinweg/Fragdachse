import type { ActivityDescriptor } from './ActivityDescriptor';

/**
 * Lokale Runtime genau einer Activity.
 *
 * Der Vertrag ist absichtlich winzig: Wer eine Activity materialisiert, besitzt sie vollstaendig
 * selbst. Der Host darunter kennt nur ihren Lebenszyklus – niemals ihre inneren Systeme.
 */
export interface ActivityRuntime {
  /** Taktet die Activity-internen Child-Owner. */
  readonly update?: (deltaMs: number) => void;
  /** Raeumt den vollstaendigen Activity-State ab. Wird genau einmal gerufen. */
  readonly destroy: () => void;
}

/**
 * Der Activity-Slot einer laufenden {@link import('./WorldRuntime').WorldRuntime}.
 *
 * Eine World kann ohne Activity bestehen – deshalb ist der Slot leer und nicht "eine Activity im
 * Zustand none". Der Host kennt nur `attach`, `update` und `detach`; welche Systeme eine
 * konkrete Activity fuehrt, bleibt vollstaendig in ihrer eigenen Runtime.
 *
 * Er ersetzt nicht den {@link import('./ActivityLifecycle').ActivityLifecycle}: dort lebt die
 * Identitaet der replizierten Activity, hier ausschliesslich ihre lokale Materialisierung.
 */
export class ActivityRuntimeHost {
  private currentDescriptor: ActivityDescriptor | null = null;
  private currentRuntime: ActivityRuntime | null = null;
  private closed = false;

  /**
   * @param worldRevision Revision der World, die diesen Slot besitzt. Eine Activity einer anderen
   *   World-Instanz darf hier nie materialisiert werden – ein verspaeteter Aufbau wuerde sonst
   *   still die Mission der Vorgaengerin in die neue World tragen.
   */
  constructor(private readonly worldRevision: number) {}

  /** Identitaet der lokal materialisierten Activity; `null`, solange der Slot leer ist. */
  get descriptor(): ActivityDescriptor | null {
    return this.currentDescriptor;
  }

  /** Die kanonische lokal materialisierte Runtime; `null`, solange der Slot leer ist. */
  get runtime(): ActivityRuntime | null {
    return this.currentRuntime;
  }

  isAttached(): boolean {
    return this.currentRuntime !== null;
  }

  /**
   * Belegt den Slot. Eine bereits materialisierte Activity wird zuvor vollstaendig geloest –
   * zwei gleichzeitige Activity-Runtimes gibt es in einer World nicht.
   */
  attach(descriptor: ActivityDescriptor, runtime: ActivityRuntime): void {
    if (this.closed) {
      throw new Error(
        `[ActivityRuntimeHost] Activity ${descriptor.definitionId} cannot attach to the closed slot `
        + `of world revision ${this.worldRevision}`,
      );
    }
    if (descriptor.worldRevision !== this.worldRevision) {
      throw new Error(
        `[ActivityRuntimeHost] Activity ${descriptor.definitionId} belongs to world revision `
        + `${descriptor.worldRevision}, not ${this.worldRevision}`,
      );
    }
    this.detach();
    this.currentDescriptor = descriptor;
    this.currentRuntime = runtime;
  }

  /** Taktet die materialisierte Activity. Ein leerer Slot taktet nichts. */
  update(deltaMs: number): void {
    this.currentRuntime?.update?.(deltaMs);
  }

  /** Loest die lokale Activity-Runtime. Idempotent. */
  detach(): void {
    const runtime = this.currentRuntime;
    this.currentRuntime = null;
    this.currentDescriptor = null;
    runtime?.destroy();
  }

  /**
   * Schliesst den Slot mit der World, die ihn besitzt. Eine spaeter eintreffende
   * Activity-Materialisierung liefe ins Leere und wird deshalb abgelehnt, statt still an einer
   * abgeraeumten World zu haengen.
   */
  close(): void {
    this.detach();
    this.closed = true;
  }
}
