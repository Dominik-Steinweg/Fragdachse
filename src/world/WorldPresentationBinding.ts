import type { ArenaPresentationResult } from '../arena/ArenaBuilder';
import type { ArenaLayout } from '../types';

/**
 * Die lokale Darstellung genau einer World-Runtime.
 *
 * Sie traegt die gebaute Darstellung **und** den Geometriepuffer, den diese adressiert: Die
 * gebauten Objekte indexieren nach Fels-ID in das Layout, und ein Rebind setzt genau diesen
 * Puffer neu. Beides getrennt zu fuehren hiesse, zwei Haelften derselben Sache zu besitzen.
 *
 * Sie ist der einzige Teil der World, der seine Runtime ueberleben darf – und auch das nur ueber
 * den ausdruecklichen Handoff, nie dadurch, dass ein Feld beim Teardown stehenbleibt.
 * Gameplay-Authority hat sie keine: Kein Simulationsschritt setzt sie voraus.
 */

/** Infrastrukturgrenze der Darstellung: der gebaute Baum ist Phaser-gebunden. */
export interface WorldPresentationSink {
  readonly destroyPresentation: (arena: ArenaPresentationResult) => void;
}

export class WorldPresentationBinding {
  private destroyed = false;

  constructor(
    /** Geometriepuffer, den die gebaute Darstellung adressiert. */
    readonly layout: ArenaLayout,
    /** Gebaute Darstellung: Boden, Felsen, Staemme, Kronen, Overlays. */
    readonly arena: ArenaPresentationResult,
    private readonly sink: WorldPresentationSink,
  ) {}

  isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Raeumt die gebaute Darstellung ab. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sink.destroyPresentation(this.arena);
  }
}
