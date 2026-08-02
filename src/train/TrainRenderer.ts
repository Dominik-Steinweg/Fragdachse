import * as Phaser from 'phaser';
import { DEPTH, COLORS } from '../config';
import type { SyncedTrainState } from '../types';
import { TRAIN } from './TrainConfig';
import type { GameAudioSystem } from '../audio/GameAudioSystem';

const TEX_TRAIN_RB54 = '__train_rb54_baked';

/**
 * Client- und Host-seitiger Renderer für den fahrenden Zug RB 54.
 *
 * Arbeitet ausschließlich mit `SyncedTrainState` – keine direkte
 * Verbindung zum TrainManager. Die komplette Geometrie wird einmal in eine Textur gebacken;
 * `update()` synchronisiert danach nur Position und Fahrtrichtung.
 *
 * Visuals in Top-Down-Anmutung, angelehnt an den realen DB-Regio-RB 54:
 *  - rote Seitenbänder / Wagenkasten
 *  - helles Dachfeld mit dunklen Dachaufbauten
 *  - dunkle Frontverglasung an der Lok
 */
export class TrainRenderer {
  private readonly image: Phaser.GameObjects.Image;
  private readonly textureCenterOffsetY: number;

  // Interpolation: Zielposition und aktuelle Display-Position
  private targetY  = 0;
  private displayY = 0;
  private lastDir: 1 | -1 = 1;
  private lastX    = 0;
  private lastAlive = false;
  private lastHp    = 0;
  private lastMaxHp = 0;

  private audioSystem: GameAudioSystem | null = null;
  private moveLoopHandle: string | null = null;

  constructor(scene: Phaser.Scene) {
    this.textureCenterOffsetY = this.ensureTrainTexture(scene);
    this.image = scene.add.image(0, 0, TEX_TRAIN_RB54)
      .setDepth(DEPTH.TRAIN)
      .setVisible(false);
  }

  setAudioSystem(system: GameAudioSystem): void {
    this.audioSystem = system;
  }

  /**
   * Neuen Server-State setzen (nur bei neuem Netzwerk-Snapshot aufrufen).
   */
  setTarget(state: SyncedTrainState | null): void {
    if (!state || !state.alive) {
      this.lastAlive = false;
      if (this.moveLoopHandle) {
        this.audioSystem?.stopLoop(this.moveLoopHandle);
        this.moveLoopHandle = null;
      }
      return;
    }
    if (!this.lastAlive) {
      // Erster Frame oder Respawn → Snap statt Lerp
      this.displayY = state.y;
      this.moveLoopHandle = this.audioSystem?.startLoop('sfx_train_move', state.x, state.y) ?? null;
    }
    this.targetY  = state.y;
    this.lastDir  = state.dir;
    this.lastX    = state.x;
    this.lastHp   = state.hp;
    this.lastMaxHp = state.maxHp;
    this.lastAlive = true;
    if (this.moveLoopHandle) {
      this.audioSystem?.updateLoopPosition(this.moveLoopHandle, state.x, state.y);
    }
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
    if (!this.lastAlive) {
      this.image.setVisible(false);
      return;
    }

    this.displayY = Phaser.Math.Linear(this.displayY, this.targetY, lerpFactor);
    this.syncImage();
  }

  /**
   * Legacy: Direktes Update ohne Interpolation (Host-Pfad).
   */
  update(state: SyncedTrainState | null): void {
    if (!state || !state.alive) {
      this.lastAlive = false;
      this.image.setVisible(false);
      if (this.moveLoopHandle) {
        this.audioSystem?.stopLoop(this.moveLoopHandle);
        this.moveLoopHandle = null;
      }
      return;
    }
    if (!this.lastAlive) {
      this.moveLoopHandle = this.audioSystem?.startLoop('sfx_train_move', state.x, state.y) ?? null;
    } else if (this.moveLoopHandle) {
      this.audioSystem?.updateLoopPosition(this.moveLoopHandle, state.x, state.y);
    }
    this.targetY = state.y;
    this.displayY = state.y;
    this.lastDir = state.dir;
    this.lastX = state.x;
    this.lastHp = state.hp;
    this.lastMaxHp = state.maxHp;
    this.lastAlive = true;
    this.syncImage();
  }

  /** Phaser-Objekte freigeben. */
  destroy(): void {
    if (this.moveLoopHandle) {
      this.audioSystem?.stopLoop(this.moveLoopHandle);
      this.moveLoopHandle = null;
    }
    if (this.image.active) this.image.destroy();
  }

  // ── Private Zeichnungs-Methoden ──────────────────────────────────────────

  private draw(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    locoY: number,
    dir: 1 | -1,
  ): void {
    const segYs = this.computeSegYs(locoY, dir);

    // Waggons zuerst → Lok danach (Tiefe durch draw-Reihenfolge)
    for (let i = 1; i <= TRAIN.WAGON_COUNT; i++) {
      this.drawWagon(graphics, x, segYs[i], TRAIN.VISUAL_WIDTH, TRAIN.WAGON_HEIGHT, i);
    }
    this.drawLoco(graphics, x, segYs[0], TRAIN.VISUAL_WIDTH, TRAIN.LOCO_HEIGHT, dir);
  }

  /**
   * Lokomotive in Draufsicht: roter Wagenkasten, helles Dach und dunkle Front.
   */
  private drawLoco(
    graphics: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    w: number,
    h: number,
    dir: 1 | -1,
  ): void {
    const x0 = cx - w / 2;
    const y0 = cy - h / 2;
    const sideBandW = 8;
    const roofW = w - sideBandW * 2;
    const roofH = h - 12;
    const roofX = cx - roofW / 2;
    const roofY = cy - roofH / 2;
    const noseDir = dir;
    const noseH = 18;
    const noseY = noseDir > 0 ? y0 + h - noseH : y0;
    const cabGlassH = 12;
    const cabGlassY = noseDir > 0 ? noseY + 2 : noseY + noseH - cabGlassH - 2;

    this.drawCapsule(graphics, cx, cy, w, h, COLORS.RED_2);

    graphics.fillStyle(COLORS.RED_3);
    graphics.fillRect(x0 + 2, y0 + 10, sideBandW, h - 20);
    graphics.fillRect(x0 + w - sideBandW - 2, y0 + 10, sideBandW, h - 20);

    this.drawCapsule(graphics, cx, cy, roofW, roofH, COLORS.GREY_2);

    graphics.fillStyle(COLORS.GREY_3);
    graphics.fillRect(roofX, noseY, roofW, noseH);

    graphics.fillStyle(COLORS.GREY_6, 0.95);
    graphics.fillRect(cx - 6, roofY + 10, 12, roofH - noseH - 20);
    graphics.fillRect(cx - 14, cy - 6, 28, 6);

    graphics.fillStyle(COLORS.BLUE_5, 0.9);
    graphics.fillRect(roofX + 8, cabGlassY, roofW - 16, cabGlassH);

    graphics.fillStyle(COLORS.GREY_1, 0.9);
    graphics.fillRect(roofX + 3, roofY + 3, roofW - 6, 3);

    graphics.lineStyle(1, COLORS.GREY_9, 1);
    this.drawCapsuleOutline(graphics, cx, cy, w, h);
    graphics.strokeRect(roofX + 8, cabGlassY, roofW - 16, cabGlassH);
  }

  /**
   * Waggon in Draufsicht: roter Wagenkasten mit hellem Dachfeld.
   * idx variiert Dachaufbauten leicht, damit der Zug nicht zu flach wirkt.
   */
  private drawWagon(
    graphics: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    w: number,
    h: number,
    idx: number,
  ): void {
    const x0 = cx - w / 2;
    const y0 = cy - h / 2;
    const sideBandW = 7;
    const roofInset = 10;
    const roofW = w - sideBandW * 2;
    const roofH = h - roofInset;
    const roofX = cx - roofW / 2;
    const roofY = cy - roofH / 2;
    const equipmentOffset = idx % 3;

    this.drawCapsule(graphics, cx, cy, w, h, COLORS.RED_2);

    graphics.fillStyle(COLORS.RED_3);
    graphics.fillRect(x0 + 2, y0 + 8, sideBandW, h - 16);
    graphics.fillRect(x0 + w - sideBandW - 2, y0 + 8, sideBandW, h - 16);

    this.drawCapsule(graphics, cx, cy, roofW, roofH, COLORS.GREY_2);

    graphics.fillStyle(COLORS.GREY_3, 0.95);
    graphics.fillRect(roofX + 4, roofY + 4, roofW - 8, 5);

    graphics.fillStyle(COLORS.GREY_6, 0.92);
    graphics.fillRect(cx - 4, roofY + 12 + equipmentOffset * 4, 8, 12);
    graphics.fillRect(cx - 10, cy - 3, 20, 5);

    graphics.fillStyle(COLORS.GREY_5, 0.85);
    graphics.fillRect(roofX + 6, y0 + h - 14, roofW - 12, 4);

    graphics.lineStyle(1, COLORS.GREY_9, 1);
    this.drawCapsuleOutline(graphics, cx, cy, w, h);
  }

  private drawCapsule(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, w: number, h: number, color: number): void {
    const radius = Math.min(w * 0.5, 12);
    graphics.fillStyle(color);
    graphics.fillRect(cx - w / 2, cy - h / 2 + radius, w, h - radius * 2);
    graphics.fillEllipse(cx, cy - h / 2 + radius, w, radius * 2);
    graphics.fillEllipse(cx, cy + h / 2 - radius, w, radius * 2);
  }

  private drawCapsuleOutline(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, w: number, h: number): void {
    const radius = Math.min(w * 0.5, 12);
    graphics.strokeRect(cx - w / 2, cy - h / 2 + radius, w, h - radius * 2);
    graphics.strokeEllipse(cx, cy - h / 2 + radius, w, radius * 2);
    graphics.strokeEllipse(cx, cy + h / 2 - radius, w, radius * 2);
  }

  private syncImage(): void {
    this.image
      .setVisible(true)
      .setPosition(
        this.lastX,
        this.displayY + this.lastDir * this.textureCenterOffsetY,
      )
      .setFlipY(this.lastDir < 0);
  }

  /** Erzeugt den kompletten Zug einmal im lokalen Texturraum; Rueckgabe relativ zur Lokmitte. */
  private ensureTrainTexture(scene: Phaser.Scene): number {
    const segmentYs = this.computeSegYs(0, 1);
    let minY = -TRAIN.LOCO_HEIGHT / 2;
    let maxY = TRAIN.LOCO_HEIGHT / 2;
    for (let index = 1; index < segmentYs.length; index += 1) {
      minY = Math.min(minY, segmentYs[index] - TRAIN.WAGON_HEIGHT / 2);
      maxY = Math.max(maxY, segmentYs[index] + TRAIN.WAGON_HEIGHT / 2);
    }
    const centerOffsetY = (minY + maxY) * 0.5;
    if (scene.textures.exists(TEX_TRAIN_RB54)) return centerOffsetY;

    const padding = 2;
    const width = Math.ceil(TRAIN.VISUAL_WIDTH + padding * 2);
    const height = Math.ceil(maxY - minY + padding * 2);
    const graphics = scene.add.graphics().setVisible(false);
    this.draw(graphics, width * 0.5, padding - minY, 1);
    graphics.generateTexture(TEX_TRAIN_RB54, width, height);
    graphics.destroy();
    return centerOffsetY;
  }

  /**
   * Berechnet die Y-Mitten aller Segmente aus Lokomotive-Y und Fahrtrichtung.
   * Spiegelt die Logik von TrainManager.segCenterYs(), aber ohne Phaser-Abhängigkeit.
   *
   * Index 0 ist die Lok, danach folgen die Waggons entgegen der Fahrtrichtung.
   * Öffentlich, damit die Zugbeleuchtung dieselben Positionen nutzt wie die Grafik.
   */
  computeSegYs(locoY: number, dir: 1 | -1): number[] {
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
