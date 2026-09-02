/**
 * Der world-scoped Owner der aktiven World-Presentation-Verdrahtung.
 *
 * `WorldPresentationBinding` ist die handoffbare Darstellung selbst – Layout und gebauter Baum,
 * die einen World-Wechsel ueberleben koennen. Dieser Owner ist etwas anderes: die laufende
 * Verdrahtung, die diese Darstellung mit den scene-langlebigen Renderern und Consumern der
 * *aktuellen* World verbindet. Er gehoert genau einer `WorldRuntime` und faellt vor deren
 * handoffbarer Darstellung – sonst saehe ein bereits uebergebener oder gerade uebergehender
 * Handoff noch aktive world-scoped Verdrahtung.
 *
 * Deshalb landet er **nie** im `WorldPresentationHandoff`: Was dort liegt, steht nur noch da und
 * wird von niemandem mehr getaktet oder verdrahtet.
 *
 * Phase 5 baut ausschliesslich dieses Lifetime-Geruest. Die eigentlichen Presentation-Bloecke
 * (Kamera-, Schatten-, Licht- und Snapshot-Sync, Surface-/Canopy-Residency, Persistent-Base-
 * Visuals) ziehen erst in Phase 6 hier ein, zusammen mit dem dann noetigen Frame-Step. Ohne einen
 * heutigen Aufrufer bekommt dieser Owner deshalb bewusst keine `update()`-Methode (KISS,
 * `docs/ai/architecture-principles.md` §6): eine Schnittstelle ohne Druck ist nur Flaeche.
 */

/**
 * Die aktiven Presentation-Consumer, die dieser Binding beim Detach loest.
 *
 * Ein benannter Port statt eines generischen Callback-Registers: Die Composition uebergibt beim
 * Bind genau eine `release()`-Senke fuer das, was sie in dieser World tatsaechlich verdrahtet hat.
 * Phase 5 hat noch keinen solchen Consumer zu benennen – der Slot bleibt deshalb `null`, bis
 * Phase 6 den ersten verschobenen Presentation-Block mitbringt.
 */
export interface WorldPresentationFrameConsumers {
  /** Loest alle aktiven Presentation-Consumer dieser World. */
  readonly release: () => void;
}

export class WorldPresentationFrameBinding {
  private destroyed = false;

  constructor(
    private readonly consumers: WorldPresentationFrameConsumers | null = null,
  ) {}

  isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Loest die aktiven Presentation-Consumer dieser World. Idempotent; danach vollstaendig inert. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.consumers?.release();
  }
}
