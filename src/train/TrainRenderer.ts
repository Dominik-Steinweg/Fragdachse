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
 * Visuals in Top-Down-Anmutung, angelehnt an den realen DB-Regio-RB 54:
 *  - rote Seitenbänder / Wagenkasten
 *  - helles Dachfeld mit dunklen Dachaufbauten
 *  - dunkle Frontverglasung an der Lok
 */
export class TrainRenderer {
  private readonly gfx: Phaser.GameObjects.Graphics;

  // Interpolation: Zielposition und aktuelle Display-Position
  private targetY  = 0;
  private displayY = 0;
  private lastDir: 1 | -1 = 1;
  private lastX    = 0;
  private lastAlive = false;
  private lastHp    = 0;
  private lastMaxHp = 0;

  constructor(scene: Phaser.Scene) {
    this.gfx = scene.add.graphics();
    this.gfx.setDepth(DEPTH.TRAIN);
  }

  /**
   * Neuen Server-State setzen (nur bei neuem Netzwerk-Snapshot aufrufen).
   */
  setTarget(state: SyncedTrainState | null): void {
    if (!state || !state.alive) {
      this.lastAlive = false;
      return;
    }
    if (!this.lastAlive) {
      // Erster Frame oder Respawn → Snap statt Lerp
      this.displayY = state.y;
    }
    this.targetY  = state.y;
    this.lastDir  = state.dir;
    this.lastX    = state.x;
    this.lastHp   = state.hp;
    this.lastMaxHp = state.maxHp;
    this.lastAlive = true;
  }

  getShadowState(): SyncedTrainState | null {
    if (!this.lastAlive) return null;
    return {
      alive: true,
      x: this.lastX,
      y: this.displayY,
      dir: this.lastDir,
      hp: this.lastHp,
      maxHp: this.lastMaxHp,
    };
  }

  /**
   * Jeden Render-Frame aufrufen. Interpoliert displayY → targetY.
   * @param lerpFactor Zeitbasierter Interpolationsfaktor (0–1)
   */
  render(lerpFactor: number): void {
    this.gfx.clear();
    if (!this.lastAlive) return;

    this.displayY = Phaser.Math.Linear(this.displayY, this.targetY, lerpFactor);

    const fakeState: SyncedTrainState = {
      alive: true,
      x:     this.lastX,
      y:     this.displayY,
      dir:   this.lastDir,
      hp:    this.lastHp,
      maxHp: this.lastMaxHp,
    };
    this.draw(fakeState);
  }

  /**
   * Legacy: Direktes Update ohne Interpolation (Host-Pfad).
   */
  update(state: SyncedTrainState | null): void {
    this.gfx.clear();
    if (!state || !state.alive) {
      this.lastAlive = false;
      return;
    }
    this.targetY = state.y;
    this.displayY = state.y;
    this.lastDir = state.dir;
    this.lastX = state.x;
    this.lastHp = state.hp;
    this.lastMaxHp = state.maxHp;
    this.lastAlive = true;
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
   * Lokomotive in Draufsicht: roter Wagenkasten, helles Dach und dunkle Front.
   */
  private drawLoco(cx: number, cy: number, w: number, h: number): void {
    const x0 = cx - w / 2;
    const y0 = cy - h / 2;
    const sideBandW = 8;
    const roofW = w - sideBandW * 2;
    const roofH = h - 12;
    const roofX = cx - roofW / 2;
    const roofY = cy - roofH / 2;
    const noseDir = this.lastDir;
    const noseH = 18;
    const noseY = noseDir > 0 ? y0 + h - noseH : y0;
    const cabGlassH = 12;
    const cabGlassY = noseDir > 0 ? noseY + 2 : noseY + noseH - cabGlassH - 2;

    this.drawCapsule(cx, cy, w, h, COLORS.RED_2);

    this.gfx.fillStyle(COLORS.RED_3);
    this.gfx.fillRect(x0 + 2, y0 + 10, sideBandW, h - 20);
    this.gfx.fillRect(x0 + w - sideBandW - 2, y0 + 10, sideBandW, h - 20);

    this.drawCapsule(cx, cy, roofW, roofH, COLORS.GREY_2);

    this.gfx.fillStyle(COLORS.GREY_3);
    this.gfx.fillRect(roofX, noseY, roofW, noseH);

    this.gfx.fillStyle(COLORS.GREY_6, 0.95);
    this.gfx.fillRect(cx - 6, roofY + 10, 12, roofH - noseH - 20);
    this.gfx.fillRect(cx - 14, cy - 6, 28, 6);

    this.gfx.fillStyle(COLORS.BLUE_5, 0.9);
    this.gfx.fillRect(roofX + 8, cabGlassY, roofW - 16, cabGlassH);

    this.gfx.fillStyle(COLORS.GREY_1, 0.9);
    this.gfx.fillRect(roofX + 3, roofY + 3, roofW - 6, 3);

    this.gfx.lineStyle(1, COLORS.GREY_9, 1);
    this.drawCapsuleOutline(cx, cy, w, h);
    this.gfx.strokeRect(roofX + 8, cabGlassY, roofW - 16, cabGlassH);
  }

  /**
   * Waggon in Draufsicht: roter Wagenkasten mit hellem Dachfeld.
   * idx variiert Dachaufbauten leicht, damit der Zug nicht zu flach wirkt.
   */
  private drawWagon(cx: number, cy: number, w: number, h: number, idx: number): void {
    const x0 = cx - w / 2;
    const y0 = cy - h / 2;
    const sideBandW = 7;
    const roofInset = 10;
    const roofW = w - sideBandW * 2;
    const roofH = h - roofInset;
    const roofX = cx - roofW / 2;
    const roofY = cy - roofH / 2;
    const equipmentOffset = idx % 3;

    this.drawCapsule(cx, cy, w, h, COLORS.RED_2);

    this.gfx.fillStyle(COLORS.RED_3);
    this.gfx.fillRect(x0 + 2, y0 + 8, sideBandW, h - 16);
    this.gfx.fillRect(x0 + w - sideBandW - 2, y0 + 8, sideBandW, h - 16);

    this.drawCapsule(cx, cy, roofW, roofH, COLORS.GREY_2);

    this.gfx.fillStyle(COLORS.GREY_3, 0.95);
    this.gfx.fillRect(roofX + 4, roofY + 4, roofW - 8, 5);

    this.gfx.fillStyle(COLORS.GREY_6, 0.92);
    this.gfx.fillRect(cx - 4, roofY + 12 + equipmentOffset * 4, 8, 12);
    this.gfx.fillRect(cx - 10, cy - 3, 20, 5);

    this.gfx.fillStyle(COLORS.GREY_5, 0.85);
    this.gfx.fillRect(roofX + 6, y0 + h - 14, roofW - 12, 4);

    this.gfx.lineStyle(1, COLORS.GREY_9, 1);
    this.drawCapsuleOutline(cx, cy, w, h);
  }

  private drawCapsule(cx: number, cy: number, w: number, h: number, color: number): void {
    const radius = Math.min(w * 0.5, 12);
    this.gfx.fillStyle(color);
    this.gfx.fillRect(cx - w / 2, cy - h / 2 + radius, w, h - radius * 2);
    this.gfx.fillEllipse(cx, cy - h / 2 + radius, w, radius * 2);
    this.gfx.fillEllipse(cx, cy + h / 2 - radius, w, radius * 2);
  }

  private drawCapsuleOutline(cx: number, cy: number, w: number, h: number): void {
    const radius = Math.min(w * 0.5, 12);
    this.gfx.strokeRect(cx - w / 2, cy - h / 2 + radius, w, h - radius * 2);
    this.gfx.strokeEllipse(cx, cy - h / 2 + radius, w, radius * 2);
    this.gfx.strokeEllipse(cx, cy + h / 2 - radius, w, radius * 2);
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
