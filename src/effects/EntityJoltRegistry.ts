import type * as Phaser from 'phaser';
import { type JoltState, stepJolt, superposeJolt } from './entityJoltModel';

/**
 * Ein Ziel ist strukturell alles mit `x`/`y` – in der Praxis ein Entity-Sprite.
 * `active` erlaubt es, zerstörte Objekte fallen zu lassen.
 */
export interface JoltTarget {
  x: number;
  y: number;
  readonly active?: boolean;
}

interface JoltEntry {
  state: JoltState;
  /** Der zuletzt aufgetragene Versatz. Wird **nie** neu berechnet, sondern exakt so abgezogen. */
  offsetX: number;
  offsetY: number;
}

// Aus `Phaser.Core.Events`; als Literale gehalten, damit dieses Modul ohne Phaser-Wert-Import
// auskommt und mit einem leeren Phaser-Stub getestet werden kann.
const PRE_RENDER_EVENT = 'prerender';
const POST_RENDER_EVENT = 'postrender';

type RenderEventEmitter = {
  on: (event: string, listener: () => void, context?: unknown) => unknown;
  off: (event: string, listener: () => void, context?: unknown) => unknown;
};

/**
 * Rein visueller Trefferimpuls der getroffenen Figur.
 *
 * `sprite.x/y` ist beim Host die maßgebliche Position für Nahkampfkegel, Explosionsradien,
 * Projektil-Treffertests und Zielauswahl. Ein dauerhafter Versatz dort wäre eine
 * Gameplay-Änderung. Deshalb wird der Versatz ausschließlich im **Renderfenster** aufgetragen:
 * bei `prerender` addiert, bei `postrender` mit exakt denselben Zahlen wieder abgezogen.
 *
 * Phasers Schrittfolge ist `scene.update` → `prerender` → `scene.render` → `postrender`.
 * Gameplay, Netzwerk, Snapshot-Aufbau und das Nachführen der Geschwister (HP-Balken, Glow,
 * Schatten, Namensschilder) laufen vollständig in `scene.update` und sehen den Versatz nie.
 * Genau das ist erwünscht: nur der Körper zuckt, die Balken bleiben lesbar an ihrem Platz.
 */
export class EntityJoltRegistry {
  private readonly entries = new Map<JoltTarget, JoltEntry>();
  private readonly emitter: RenderEventEmitter;
  private applied = false;
  private enabled = true;

  private readonly onPreRender = (): void => this.applyOffsets();
  private readonly onPostRender = (): void => this.removeOffsets();

  constructor(game: Phaser.Game) {
    this.emitter = (game as unknown as { events: RenderEventEmitter }).events;
    this.emitter.on(PRE_RENDER_EVENT, this.onPreRender);
    this.emitter.on(POST_RENDER_EVENT, this.onPostRender);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  jolt(target: JoltTarget, dirX: number, dirY: number, px: number, durationMs: number): void {
    if (!this.enabled || px <= 0 || durationMs <= 0) return;
    const existing = this.entries.get(target);
    const state = superposeJolt(existing?.state ?? null, dirX, dirY, px, durationMs);
    if (!state) return;
    if (existing) existing.state = state;
    else this.entries.set(target, { state, offsetX: 0, offsetY: 0 });
  }

  /**
   * Schreibt das Abklingen fort. Läuft in `scene.update`, berührt dabei aber keine Position –
   * es wird nur der Versatz berechnet, den das Renderfenster später aufträgt.
   */
  step(deltaMs: number): void {
    for (const [target, entry] of this.entries) {
      if (target.active === false) {
        this.entries.delete(target);
        continue;
      }
      const offset = stepJolt(entry.state, deltaMs);
      if (offset.finished) {
        this.entries.delete(target);
        continue;
      }
      entry.offsetX = offset.x;
      entry.offsetY = offset.y;
    }
  }

  /** Aktueller Versatz als Datum – für Effekte, die dem gezuckten Körper folgen sollen. */
  getOffset(target: JoltTarget): { x: number; y: number } {
    const entry = this.entries.get(target);
    return entry ? { x: entry.offsetX, y: entry.offsetY } : { x: 0, y: 0 };
  }

  release(target: JoltTarget): void {
    const entry = this.entries.get(target);
    if (!entry) return;
    if (this.applied) {
      target.x -= entry.offsetX;
      target.y -= entry.offsetY;
    }
    this.entries.delete(target);
  }

  reset(): void {
    if (this.applied) this.removeOffsets();
    this.entries.clear();
  }

  destroy(): void {
    this.reset();
    this.emitter.off(PRE_RENDER_EVENT, this.onPreRender);
    this.emitter.off(POST_RENDER_EVENT, this.onPostRender);
  }

  private applyOffsets(): void {
    // Das Flag ist die Sicherung gegen einen ausgefallenen Renderdurchlauf: doppeltes Auftragen
    // oder doppeltes Abziehen würde den Versatz dauerhaft im Sprite hinterlassen.
    if (this.applied) return;
    this.applied = true;
    for (const [target, entry] of this.entries) {
      target.x += entry.offsetX;
      target.y += entry.offsetY;
    }
  }

  private removeOffsets(): void {
    if (!this.applied) return;
    this.applied = false;
    for (const [target, entry] of this.entries) {
      target.x -= entry.offsetX;
      target.y -= entry.offsetY;
    }
  }
}
