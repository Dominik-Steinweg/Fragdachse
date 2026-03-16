import Phaser from 'phaser';
import { DEPTH, COLORS } from '../config';
import type { SyncedTrainState } from '../types';
import { TRAIN } from './TrainConfig';

/**
 * Client- und Host-seitiger Renderer für den fahrenden Zug RB 54.
 *
 * Arbeitet ausschließlich mit `SyncedTrainState` – keine direkte
 * Verbindung zum TrainManager. Zeichnet jeden Frame neu via `update()`.
 *
 * Visuals (Placeholder, austauschbar gegen Pixel-Art-Sprites):
 *  - Lokomotive: roter Kasten mit Kabinendetails
 *  - Waggons:    dunkelgraue Streifen (alle WAGON_STRIPE_H px) im Wechsel
 *                → vermittelt visuell die Geschwindigkeit
 */
export class TrainRenderer {
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.gfx = scene.add.graphics();
    this.gfx.setDepth(DEPTH.TRAIN);
  }

  /**
   * Jeden Frame aufrufen.
   * `state = null` → alles ausblenden.
   */
  update(state: SyncedTrainState | null): void {
    this.gfx.clear();
    if (!state || !state.alive) return;
    this.draw(state);
  }

  /** Phaser-Objekte freigeben. */
  destroy(): void {
    if (this.gfx.active) this.gfx.destroy();
  }

  // ── Private Zeichnungs-Methoden ──────────────────────────────────────────

  private draw(state: SyncedTrainState): void {
    const { x, y: locoY, dir } = state;
    const segYs = this.computeSegYs(locoY, dir);

    // Waggons zuerst → Lok danach (Tiefe durch draw-Reihenfolge)
    for (let i = 1; i <= TRAIN.WAGON_COUNT; i++) {
      this.drawWagon(x, segYs[i], TRAIN.VISUAL_WIDTH, TRAIN.WAGON_HEIGHT, i);
    }
    this.drawLoco(x, segYs[0], TRAIN.VISUAL_WIDTH, TRAIN.LOCO_HEIGHT);
  }

  /**
   * Lokomotive: roter Kasten mit Dachstreifen und Kabinendetail.
   */
  private drawLoco(cx: number, cy: number, w: number, h: number): void {
    // Hauptfläche – kräftiges Rot
    this.gfx.fillStyle(COLORS.RED_2);
    this.gfx.fillRect(cx - w / 2, cy - h / 2, w, h);

    // Dunkle Querstreifen oben/unten
    this.gfx.fillStyle(COLORS.RED_5);
    this.gfx.fillRect(cx - w / 2, cy - h / 2,      w, 5);
    this.gfx.fillRect(cx - w / 2, cy + h / 2 - 5,  w, 5);

    // Kabinen-Fenster (kleines blaues Rechteck in der oberen Hälfte)
    const winW = 16;
    const winH = 10;
    this.gfx.fillStyle(COLORS.BLUE_2, 0.75);
    this.gfx.fillRect(cx - winW / 2, cy - h / 4 - winH / 2, winW, winH);

    // Rahmen ums Fenster
    this.gfx.lineStyle(1, COLORS.GREY_9, 1);
    this.gfx.strokeRect(cx - winW / 2, cy - h / 4 - winH / 2, winW, winH);
  }

  /**
   * Waggon: abwechselnde Grau-Streifen erzeugen optischen Geschwindigkeitseffekt.
   * idx bestimmt den Offset, sodass benachbarte Waggons unterschiedlich aussehen.
   */
  private drawWagon(cx: number, cy: number, w: number, h: number, idx: number): void {
    const x0 = cx - w / 2;
    const y0 = cy - h / 2;

    // Streifen alternierend zeichnen
    const offset = (idx % 2) * TRAIN.WAGON_STRIPE_H; // Versatz pro Waggon-Index
    for (let sy = 0; sy < h; sy += TRAIN.WAGON_STRIPE_H) {
      const stripe = Math.floor((sy + offset) / TRAIN.WAGON_STRIPE_H) % 2 === 0
        ? COLORS.GREY_6
        : COLORS.GREY_7;
      this.gfx.fillStyle(stripe);
      const sh = Math.min(TRAIN.WAGON_STRIPE_H, h - sy);
      this.gfx.fillRect(x0, y0 + sy, w, sh);
    }

    // Dünner Rahmen
    this.gfx.fillStyle(COLORS.GREY_9);
    this.gfx.fillRect(x0, y0,         w, 2); // oben
    this.gfx.fillRect(x0, y0 + h - 2, w, 2); // unten
  }

  /**
   * Berechnet die Y-Mitten aller Segmente aus Lokomotive-Y und Fahrtrichtung.
   * Spiegelt die Logik von TrainManager.segCenterYs(), aber ohne Phaser-Abhängigkeit.
   */
  private computeSegYs(locoY: number, dir: 1 | -1): number[] {
    const ys: number[] = [locoY];
    let prev  = locoY;
    let prevH = TRAIN.LOCO_HEIGHT;

    for (let i = 0; i < TRAIN.WAGON_COUNT; i++) {
      const h   = TRAIN.WAGON_HEIGHT;
      const gap = prevH / 2 + TRAIN.SEGMENT_GAP + h / 2;
      prev = prev - dir * gap;
      ys.push(prev);
      prevH = h;
    }
    return ys;
  }
}
