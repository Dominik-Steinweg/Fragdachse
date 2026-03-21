import Phaser from 'phaser';
import { DEPTH } from '../config';

// ── Textur-Schlüssel ────────────────────────────────────────────────────────
// Bullet/Trail/Glow/Spark: gleiche Keys wie BulletRenderer → exists()-Guards
const TEX_BULLET = '__bullet_shape';
const TEX_TRAIL  = '__bullet_trail';
const TEX_GLOW   = '__bullet_glow';
const TEX_SPARK  = '__bullet_spark';

// ── Bullet-Visual-Konfiguration ────────────────────────────────────────────
const AWP_SCALE_BOOST   = 1.4;
const TRAIL_TEX_W       = 48;
const TRAIL_TEX_H       = 8;
const TRAIL_LENGTH_MULT = 8;
const GLOW_TEX_SIZE     = 24;
const GLOW_SCALE        = 2.8;
const GLOW_ALPHA        = 0.55;

// ── Tracer-Linie ───────────────────────────────────────────────────────────
const TRACER_COLOR_CORE  = 0xffffff;   // innere Linie: helles Weiß
const TRACER_COLOR_GLOW  = 0xffdd66;   // äußere Linie: gelb-gold (Leuchteffekt)
const TRACER_WIDTH_CORE  = 2;          // px
const TRACER_WIDTH_GLOW  = 6;          // px
const TRACER_SEGMENTS    = 6;          // Gradient-Segmente (mehr = weicherer Fade)
const TRACER_FADE_MS     = 350;        // Ausklang nach Einschlag (ms)

// ── Impact-Funken ──────────────────────────────────────────────────────────
const SPARK_COUNT      = 16;
const SPARK_LIFESPAN   = 280;
const SPARK_SPEED_MIN  = 110;
const SPARK_SPEED_MAX  = 380;
const SPARK_SPREAD_DEG = 55;
const SPARK_GRAVITY_Y  = 220;
const SPARK_COLORS     = [0xffffff, 0xffee88, 0xffaa44, 0xff6622];

// ── Depth-Layer ────────────────────────────────────────────────────────────
const DEPTH_TRACER = DEPTH.PROJECTILES - 2;
const DEPTH_TRAIL  = DEPTH.PROJECTILES - 1;
const DEPTH_GLOW   = DEPTH.PROJECTILES - 1;
const DEPTH_BULLET = DEPTH.PROJECTILES;
const DEPTH_SPARK  = DEPTH.PROJECTILES + 1;

// ── Interner State pro AWP-Projektil ──────────────────────────────────────
interface AwpVisual {
  bullet: Phaser.GameObjects.Image;
  trail:  Phaser.GameObjects.Image;
  glow:   Phaser.GameObjects.Image;
  tracer: Phaser.GameObjects.Graphics;  // Leuchtlinie von Spawn bis aktuelle Position
  spawnX: number;
  spawnY: number;
  prevX:  number;
  prevY:  number;
}

/**
 * Rendert AWP-Projektile mit:
 * - Bullet-Capsule + Trail-Image + Glow (wie BulletRenderer, größer skaliert)
 * - Tracer-Linie (Graphics): wird jeden Frame von Spawn bis aktuelle Position gezeichnet,
 *   mit Gradient (transparent am Ursprung → hell am Bullet). Nach Einschlag 350ms Fadeout.
 * - Impact-Sparks beim Aufprall
 */
export class AwpRenderer {
  private scene:   Phaser.Scene;
  private visuals = new Map<number, AwpVisual>();
  private activeSparkEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // ── Textur-Erzeugung ──────────────────────────────────────────────────────

  generateTextures(): void {
    const texMgr = this.scene.textures;

    // Bullet-Shape (identisch zu BulletRenderer)
    if (!texMgr.exists(TEX_BULLET)) {
      const bw = 14, bh = 6;
      const canvas = texMgr.createCanvas(TEX_BULLET, bw, bh)!;
      const ctx = canvas.context;
      const r = bh / 2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(bw - r, 0);
      ctx.arc(bw - r, r, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(r, bh);
      ctx.arc(r, r, r, Math.PI / 2, -Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      const grad = ctx.createLinearGradient(0, 0, bw, 0);
      grad.addColorStop(0.0, 'rgba(255,255,255,0.0)');
      grad.addColorStop(0.4, 'rgba(255,255,255,0.3)');
      grad.addColorStop(1.0, 'rgba(255,255,255,0.9)');
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, bw, bh);
      ctx.globalCompositeOperation = 'source-over';
      canvas.refresh();
    }

    // Trail-Textur (identisch zu BulletRenderer)
    if (!texMgr.exists(TEX_TRAIL)) {
      const tw = TRAIL_TEX_W, th = TRAIL_TEX_H;
      const canvas = texMgr.createCanvas(TEX_TRAIL, tw, th)!;
      const ctx = canvas.context;
      const imgData = ctx.createImageData(tw, th);
      const d = imgData.data;
      const cy = th / 2;
      for (let y = 0; y < th; y++) {
        const vDist  = Math.abs(y - cy) / cy;
        const vAlpha = 1.0 - vDist * vDist;
        for (let x = 0; x < tw; x++) {
          const t      = x / (tw - 1);
          const hAlpha = t * t * t;
          const a      = Math.round(vAlpha * hAlpha * 255);
          const idx    = (y * tw + x) * 4;
          d[idx] = 255; d[idx + 1] = 255; d[idx + 2] = 255; d[idx + 3] = a;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      canvas.refresh();
    }

    // Glow-Textur (identisch zu BulletRenderer)
    if (!texMgr.exists(TEX_GLOW)) {
      const gs = GLOW_TEX_SIZE;
      const canvas = texMgr.createCanvas(TEX_GLOW, gs, gs)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(gs / 2, gs / 2, 0, gs / 2, gs / 2, gs / 2);
      grad.addColorStop(0.0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(0.2, 'rgba(255,255,255,0.5)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.15)');
      grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, gs, gs);
      canvas.refresh();
    }

    // Spark-Textur (identisch zu BulletRenderer)
    if (!texMgr.exists(TEX_SPARK)) {
      const sw = 6, sh = 3;
      const canvas = texMgr.createCanvas(TEX_SPARK, sw, sh)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(sw / 2, sh / 2, 0, sw / 2, sh / 2, sw / 2);
      grad.addColorStop(0.0, 'rgba(255,255,255,1.0)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.7)');
      grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, sw, sh);
      canvas.refresh();
    }
  }

  // ── Visual erstellen / aktualisieren / zerstören ──────────────────────────

  createVisual(id: number, x: number, y: number, size: number, color: number): void {
    if (this.visuals.has(id)) return;

    const scaleFactor = Math.max(size / 5, 0.6) * AWP_SCALE_BOOST;

    // Bullet-Capsule
    const bullet = this.scene.add.image(x, y, TEX_BULLET);
    bullet.setScale(scaleFactor, scaleFactor);
    bullet.setTint(color);
    bullet.setDepth(DEPTH_BULLET);

    // Trail-Image
    const trail = this.scene.add.image(x, y, TEX_TRAIL);
    trail.setOrigin(1.0, 0.5);
    trail.setScale((size * TRAIL_LENGTH_MULT) / TRAIL_TEX_W, scaleFactor * 1.3);
    trail.setTint(color);
    trail.setAlpha(0.85);
    trail.setBlendMode(Phaser.BlendModes.ADD);
    trail.setDepth(DEPTH_TRAIL);

    // Glow-Halo
    const glow = this.scene.add.image(x, y, TEX_GLOW);
    glow.setScale(scaleFactor * GLOW_SCALE);
    glow.setTint(color);
    glow.setAlpha(GLOW_ALPHA);
    glow.setBlendMode(Phaser.BlendModes.ADD);
    glow.setDepth(DEPTH_GLOW);

    // Tracer-Linie: Graphics-Objekt in Weltkoordinaten, jeden Frame neu gezeichnet
    const tracer = this.scene.add.graphics();
    tracer.setDepth(DEPTH_TRACER);

    this.visuals.set(id, { bullet, trail, glow, tracer, spawnX: x, spawnY: y, prevX: x, prevY: y });
  }

  updateVisual(id: number, x: number, y: number, vx: number, vy: number): boolean {
    const bv = this.visuals.get(id);
    if (!bv) return false;

    const rot = Math.atan2(vy, vx);
    bv.bullet.setPosition(x, y).setRotation(rot);
    bv.trail.setPosition(x, y).setRotation(rot);
    bv.glow.setPosition(x, y);

    // Tracer: jeden Frame von Spawn bis aktuelle Position neu zeichnen
    this._drawTracer(bv.tracer, bv.spawnX, bv.spawnY, x, y);

    const dx      = x - bv.prevX;
    const dy      = y - bv.prevY;
    const bounced = (dx !== 0 || dy !== 0) && (dx * vx < -0.5 || dy * vy < -0.5);
    bv.prevX = x;
    bv.prevY = y;
    return bounced;
  }

  /**
   * Zeichnet die Tracer-Linie als Gradient:
   * TRACER_SEGMENTS Abschnitte von Spawn bis Bullet, Opazität steigt von 0 → 1.
   * Jeder Abschnitt: dicker gelber Außen-Glow + dünner weißer Kern.
   */
  private _drawTracer(
    g: Phaser.GameObjects.Graphics,
    sx: number, sy: number,
    ex: number, ey: number,
  ): void {
    g.clear();
    const N = TRACER_SEGMENTS;
    for (let i = 0; i < N; i++) {
      const t0 = i / N;
      const t1 = (i + 1) / N;
      // Sanfter Gradient: quadratisch von fast-null bis eins
      const alpha = ((t0 + t1) / 2) * ((t0 + t1) / 2);
      const x0 = sx + (ex - sx) * t0,  y0 = sy + (ey - sy) * t0;
      const x1 = sx + (ex - sx) * t1,  y1 = sy + (ey - sy) * t1;

      // Äußerer Glow
      g.lineStyle(TRACER_WIDTH_GLOW, TRACER_COLOR_GLOW, alpha * 0.45);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokePath();

      // Innerer heller Kern
      g.lineStyle(TRACER_WIDTH_CORE, TRACER_COLOR_CORE, alpha * 0.95);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokePath();
    }
  }

  /**
   * Visual für dieses Projektil entfernen.
   * Bullet/Trail/Glow sofort zerstören; Tracer-Linie bleibt kurz sichtbar und klingt aus.
   */
  destroyVisual(id: number): void {
    const bv = this.visuals.get(id);
    if (!bv) return;
    this.visuals.delete(id);

    bv.bullet.destroy();
    bv.trail.destroy();
    bv.glow.destroy();

    // Tracer: Fadeout, dann Objekt aufräumen
    this.scene.tweens.add({
      targets:  bv.tracer,
      alpha:    0,
      duration: TRACER_FADE_MS,
      ease:     'Power2',
      onComplete: () => { if (bv.tracer.scene) bv.tracer.destroy(); },
    });
  }

  /**
   * Impact-Funken bei Aufprall (Wand, Felsen, Zug).
   */
  playImpactSparks(x: number, y: number, dirX: number, dirY: number, _color: number): void {
    const baseAngle = Math.atan2(dirY, dirX) * (180 / Math.PI);
    const emitter = this.scene.add.particles(x, y, TEX_SPARK, {
      speed:     { min: SPARK_SPEED_MIN, max: SPARK_SPEED_MAX },
      angle:     { min: baseAngle - SPARK_SPREAD_DEG, max: baseAngle + SPARK_SPREAD_DEG },
      lifespan:  SPARK_LIFESPAN,
      alpha:     { start: 1.0, end: 0.0 },
      scale:     { start: 1.6, end: 0.15 },
      rotate:    { min: 0, max: 360 },
      color:     SPARK_COLORS,
      blendMode: Phaser.BlendModes.ADD,
      gravityY:  SPARK_GRAVITY_Y,
      emitting:  false,
    });
    emitter.setDepth(DEPTH_SPARK);
    emitter.explode(SPARK_COUNT);

    this.activeSparkEmitters.push(emitter);
    this.scene.time.delayedCall(SPARK_LIFESPAN + 80, () => {
      const idx = this.activeSparkEmitters.indexOf(emitter);
      if (idx !== -1) this.activeSparkEmitters.splice(idx, 1);
      if (emitter.scene) emitter.destroy();
    });
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  has(id: number): boolean { return this.visuals.has(id); }

  getActiveIds(): Iterable<number> { return this.visuals.keys(); }

  destroyAll(): void {
    for (const [, bv] of this.visuals) {
      bv.bullet.destroy();
      bv.trail.destroy();
      bv.glow.destroy();
      if (bv.tracer.scene) bv.tracer.destroy();
    }
    this.visuals.clear();
    for (const e of this.activeSparkEmitters) {
      if (e.scene) e.destroy();
    }
    this.activeSparkEmitters.length = 0;
  }
}
