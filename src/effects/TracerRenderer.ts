import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { TracerConfig } from '../types';

const DEPTH_TRACER = DEPTH.PROJECTILES - 2;

interface TracerVisual {
  graphics: Phaser.GameObjects.Graphics;
  spawnX:   number;
  spawnY:   number;
  prevX:    number;
  prevY:    number;
  config:   TracerConfig;
  color:    number;  // Projektil-/Spielerfarbe (Fallback wenn colorCore/colorGlow nicht gesetzt)
}

/**
 * Rendert data-driven Tracer-Leuchtlinien für beliebige Projektile.
 *
 * Jeder Tracer ist eine Graphics-Linie vom Spawn-Punkt bis zur aktuellen Bullet-Position,
 * mit quadratischem Alpha-Gradient (transparent am Ursprung → hell am Bullet-Kopf).
 * Nach Einschlag: Fadeout via Phaser-Tween.
 *
 * Farben: colorCore/colorGlow aus TracerConfig, Fallback auf die Projektilfarbe (Spielerfarbe).
 * Maximale Trail-Länge: maxLength begrenzt sichtbaren Pfad (sinnvoll für Schnellfeuerwaffen).
 */
export class TracerRenderer {
  private scene:   Phaser.Scene;
  private visuals = new Map<number, TracerVisual>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  createTracer(id: number, x: number, y: number, config: TracerConfig, color: number): void {
    if (this.visuals.has(id)) return;
    const graphics = this.scene.add.graphics();
    graphics.setDepth(DEPTH_TRACER);
    this.visuals.set(id, { graphics, spawnX: x, spawnY: y, prevX: x, prevY: y, config, color });
  }

  updateTracer(id: number, x: number, y: number, vx: number, vy: number): void {
    const v = this.visuals.get(id);
    if (!v) return;

    // Bounce-Erkennung: Bewegungsrichtung (prevX→x) widerspricht aktueller Velocity
    const dx = x - v.prevX;
    const dy = y - v.prevY;
    if ((dx !== 0 || dy !== 0) && (dx * vx < -0.5 || dy * vy < -0.5)) {
      // Abpraller: Trail ab Aufprallpunkt neu beginnen
      v.spawnX = x;
      v.spawnY = y;
    }
    v.prevX = x;
    v.prevY = y;

    this._draw(v.graphics, v.spawnX, v.spawnY, x, y, v.config, v.color);
  }

  /**
   * Tracer entfernen: Graphics-Objekt fadeout über config.fadeMs, dann auto-destroy.
   */
  /**
   * Setzt spawnX/spawnY + prevX/prevY auf die aktuelle Position zurück.
   * Muss nach einem erkannten Abpraller aufgerufen werden (z.B. via velocityFlipped im Client).
   */
  notifyBounce(id: number, x: number, y: number): void {
    const v = this.visuals.get(id);
    if (!v) return;
    v.spawnX = x;
    v.spawnY = y;
    v.prevX  = x;
    v.prevY  = y;
  }

  destroyTracer(id: number): void {
    const v = this.visuals.get(id);
    if (!v) return;
    this.visuals.delete(id);
    this.scene.tweens.add({
      targets:  v.graphics,
      alpha:    0,
      duration: v.config.fadeMs,
      ease:     'Power2',
      onComplete: () => { if (v.graphics.scene) v.graphics.destroy(); },
    });
  }

  destroyAll(): void {
    for (const [, v] of this.visuals) {
      if (v.graphics.scene) v.graphics.destroy();
    }
    this.visuals.clear();
  }

  has(id: number): boolean { return this.visuals.has(id); }

  getActiveIds(): Iterable<number> { return this.visuals.keys(); }

  // ── Zeichnen ───────────────────────────────────────────────────────────────

  /**
   * Zeichnet die Tracer-Linie als Gradient-Segmente.
   *
   * Falls maxLength gesetzt: nur die letzten maxLength Pixel werden gezeichnet.
   * Quadratischer Alpha-Gradient: 0 am Startpunkt → 1 am Bullet-Kopf.
   * Pro Segment: äußerer Glow (widthGlow, alphaGlow) + innerer Kern (widthCore, alphaCore).
   */
  private _draw(
    g:     Phaser.GameObjects.Graphics,
    sx:    number, sy: number,
    ex:    number, ey: number,
    cfg:   TracerConfig,
    color: number,
  ): void {
    g.clear();

    const fullLen = Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2);
    if (fullLen < 0.5) return;

    // maxLength: Trail auf die letzten N px beschränken
    let drawSx = sx, drawSy = sy;
    if (cfg.maxLength !== undefined && fullLen > cfg.maxLength) {
      const ratio = cfg.maxLength / fullLen;
      drawSx = ex + (sx - ex) * ratio;
      drawSy = ey + (sy - ey) * ratio;
    }

    const colorCore = cfg.colorCore ?? color;
    const colorGlow = cfg.colorGlow ?? color;
    const N = cfg.segments;

    for (let i = 0; i < N; i++) {
      const t0 = i / N;
      const t1 = (i + 1) / N;
      // Quadratischer Gradient: fast unsichtbar nahe Startpunkt, voll hell am Bullet
      const alpha = ((t0 + t1) / 2) ** 2;
      const x0 = drawSx + (ex - drawSx) * t0,  y0 = drawSy + (ey - drawSy) * t0;
      const x1 = drawSx + (ex - drawSx) * t1,  y1 = drawSy + (ey - drawSy) * t1;

      // Äußerer Glow
      g.lineStyle(cfg.widthGlow, colorGlow, alpha * cfg.alphaGlow);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokePath();

      // Innerer heller Kern
      g.lineStyle(cfg.widthCore, colorCore, alpha * cfg.alphaCore);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokePath();
    }
  }
}
