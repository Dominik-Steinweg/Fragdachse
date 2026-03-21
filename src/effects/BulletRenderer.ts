import Phaser from 'phaser';
import { DEPTH } from '../config';

// ── Textur-Schlüssel (einmal erzeugt, global gecacht) ──────────────────────
const TEX_BULLET = '__bullet_shape';
const TEX_TRAIL  = '__bullet_trail';
const TEX_GLOW   = '__bullet_glow';
const TEX_SPARK  = '__bullet_spark';

// ── Textur-Dimensionen ─────────────────────────────────────────────────────
const TRAIL_TEX_W   = 48;
const TRAIL_TEX_H   = 8;
const GLOW_TEX_SIZE = 24;

// Impact-Funken Farbverlauf (Weiß → Gold → Dunkelorange)
const SPARK_COLORS = [0xffffff, 0xffee88, 0xffaa44, 0xff6622];

// Depth-Layer
const DEPTH_TRAIL  = DEPTH.PROJECTILES - 1;
const DEPTH_GLOW   = DEPTH.PROJECTILES - 1;
const DEPTH_BULLET = DEPTH.PROJECTILES;
const DEPTH_SPARK  = DEPTH.PROJECTILES + 1;

// ── Stil-Konfiguration ────────────────────────────────────────────────────
/** Konfigurierbare Werte für Bullet-artige Projektile (Standard-Bullet, AWP, etc.) */
export interface BulletStyleConfig {
  scaleBoost:      number;
  trailLengthMult: number;
  trailAlpha:      number;
  trailScaleYMult: number;
  glowScale:       number;
  glowAlpha:       number;
  sparkCount:      number;
  sparkLifespan:   number;
  sparkSpeedMin:   number;
  sparkSpeedMax:   number;
  sparkSpreadDeg:  number;
  sparkGravityY:   number;
  sparkScaleStart: number;
  sparkScaleEnd:   number;
}

/** Standard-Bullet-Stil */
export const BULLET_STYLE: BulletStyleConfig = {
  scaleBoost:      1.0,
  trailLengthMult: 6,
  trailAlpha:      0.75,
  trailScaleYMult: 1.2,
  glowScale:       2.0,
  glowAlpha:       0.45,
  sparkCount:      12,
  sparkLifespan:   250,
  sparkSpeedMin:   90,
  sparkSpeedMax:   300,
  sparkSpreadDeg:  50,
  sparkGravityY:   200,
  sparkScaleStart: 1.4,
  sparkScaleEnd:   0.2,
};

/** AWP-Stil (größer, auffälliger) */
export const AWP_STYLE: BulletStyleConfig = {
  scaleBoost:      1.4,
  trailLengthMult: 8,
  trailAlpha:      0.85,
  trailScaleYMult: 1.3,
  glowScale:       2.8,
  glowAlpha:       0.55,
  sparkCount:      16,
  sparkLifespan:   280,
  sparkSpeedMin:   110,
  sparkSpeedMax:   380,
  sparkSpreadDeg:  55,
  sparkGravityY:   220,
  sparkScaleStart: 1.6,
  sparkScaleEnd:   0.15,
};

// ── Interner State pro Bullet ──────────────────────────────────────────────
interface BulletVisual {
  bullet:  Phaser.GameObjects.Image;
  trail:   Phaser.GameObjects.Image;
  glow:    Phaser.GameObjects.Image;
  prevX:   number;
  prevY:   number;
  config:  BulletStyleConfig;
}

/**
 * Rendert Bullet-artige Projektile (Standard-Bullet + AWP) mit:
 * - Geformtem Projektil-Sprite (längliches Capsule mit hellem Kern)
 * - Glatter Leuchtspur (Image-basiert)
 * - Weichem Glow-Halo um das Projektil
 * - Funkensprühen bei Impact
 *
 * Stil-Unterschiede werden über BulletStyleConfig gesteuert (BULLET_STYLE, AWP_STYLE).
 */
export class BulletRenderer {
  private scene: Phaser.Scene;
  private bullets = new Map<number, BulletVisual>();

  // Pool für Impact-Emitter (auto-destroy nach Lifespan)
  private activeSparkEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // ── Texturen ──────────────────────────────────────────────────────────────

  /**
   * Erzeugt alle benötigten Texturen prozedural (einmalig pro Scene).
   * Muss vor createVisual() aufgerufen werden.
   */
  generateTextures(): void {
    const texMgr = this.scene.textures;

    // ── Bullet-Shape: längliches Capsule (14×6 px) mit hellem Kern ────────
    if (!texMgr.exists(TEX_BULLET)) {
      const bw = 14, bh = 6;
      const canvas = texMgr.createCanvas(TEX_BULLET, bw, bh)!;
      const ctx = canvas.context;
      const r = bh / 2;

      // Capsule-Grundform
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(bw - r, 0);
      ctx.arc(bw - r, r, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(r, bh);
      ctx.arc(r, r, r, Math.PI / 2, -Math.PI / 2);
      ctx.closePath();
      ctx.fill();

      // Heller Kern-Gradient (Spitze = hell)
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

    // ── Trail-Textur: horizontaler Gradient mit vertikalem Taper ──────────
    // Links = transparent (Schweif-Ende), Rechts = weiß (Bullet-Anschluss)
    // Vertikal von Mitte nach Rand ausfadend → konisch zulaufender Schweif
    if (!texMgr.exists(TEX_TRAIL)) {
      const tw = TRAIL_TEX_W, th = TRAIL_TEX_H;
      const canvas = texMgr.createCanvas(TEX_TRAIL, tw, th)!;
      const ctx = canvas.context;
      const imgData = ctx.createImageData(tw, th);
      const d = imgData.data;
      const cy = th / 2;

      for (let y = 0; y < th; y++) {
        // Vertikaler Taper: 1.0 in der Mitte, 0.0 am Rand (quadratisch für weichen Abfall)
        const vDist = Math.abs(y - cy) / cy;
        const vAlpha = 1.0 - vDist * vDist;

        for (let x = 0; x < tw; x++) {
          // Horizontaler Gradient: 0.0 links → 1.0 rechts (kubisch für langen Ausklang)
          const t = x / (tw - 1);
          const hAlpha = t * t * t;

          const a = Math.round(vAlpha * hAlpha * 255);
          const idx = (y * tw + x) * 4;
          d[idx]     = 255; // R
          d[idx + 1] = 255; // G
          d[idx + 2] = 255; // B
          d[idx + 3] = a;   // A
        }
      }
      ctx.putImageData(imgData, 0, 0);
      canvas.refresh();
    }

    // ── Glow-Textur: weicher radialer Gradient ────────────────────────────
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

    // ── Spark-Textur: kleiner elongierter Funke (6×3 px) ─────────────────
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

  // ── Visual erstellen / aktualisieren / zerstören ─────────────────────────

  /**
   * Erstellt Bullet-Visual (Capsule + Trail-Image + Glow) für ein neues Projektil.
   * @param config  Stil-Konfiguration (BULLET_STYLE oder AWP_STYLE)
   */
  createVisual(id: number, x: number, y: number, size: number, color: number, config: BulletStyleConfig = BULLET_STYLE): void {
    if (this.bullets.has(id)) return;

    const scaleFactor = Math.max(size / 5, 0.6) * config.scaleBoost;

    const bullet = this.scene.add.image(x, y, TEX_BULLET);
    bullet.setScale(scaleFactor, scaleFactor);
    bullet.setTint(color);
    bullet.setDepth(DEPTH_BULLET);

    const trail = this.scene.add.image(x, y, TEX_TRAIL);
    trail.setOrigin(1.0, 0.5);
    trail.setScale((size * config.trailLengthMult) / TRAIL_TEX_W, scaleFactor * config.trailScaleYMult);
    trail.setTint(color);
    trail.setAlpha(config.trailAlpha);
    trail.setBlendMode(Phaser.BlendModes.ADD);
    trail.setDepth(DEPTH_TRAIL);

    const glow = this.scene.add.image(x, y, TEX_GLOW);
    glow.setScale(scaleFactor * config.glowScale);
    glow.setTint(color);
    glow.setAlpha(config.glowAlpha);
    glow.setBlendMode(Phaser.BlendModes.ADD);
    glow.setDepth(DEPTH_GLOW);

    this.bullets.set(id, { bullet, trail, glow, prevX: x, prevY: y, config });
  }

  /**
   * Host-seitig: Position und Rotation anhand der Physik-Velocity setzen.
   * Gibt true zurück wenn ein Bounce erkannt wurde.
   */
  syncToBody(id: number, x: number, y: number, vx: number, vy: number): boolean {
    const bv = this.bullets.get(id);
    if (!bv) return false;

    const rot = Math.atan2(vy, vx);
    bv.bullet.setPosition(x, y).setRotation(rot);
    bv.trail.setPosition(x, y).setRotation(rot);
    bv.glow.setPosition(x, y);

    // Bounce-Erkennung: Richtungswechsel in X oder Y
    const dx = x - bv.prevX;
    const dy = y - bv.prevY;
    const bounced = (dx !== 0 || dy !== 0) && (dx * vx < -0.5 || dy * vy < -0.5);

    bv.prevX = x;
    bv.prevY = y;
    return bounced;
  }

  /**
   * Client-seitig: Position setzen und Rotation aus Velocity berechnen.
   * Gibt true zurück wenn ein Bounce erkannt wurde.
   */
  updatePosition(id: number, x: number, y: number, vx: number, vy: number): boolean {
    const bv = this.bullets.get(id);
    if (!bv) return false;

    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > 1) {
      const rot = Math.atan2(vy, vx);
      bv.bullet.setRotation(rot);
      bv.trail.setRotation(rot);
    }

    bv.bullet.setPosition(x, y);
    bv.trail.setPosition(x, y);
    bv.glow.setPosition(x, y);

    // Bounce-Erkennung: Delta vs. Velocity
    const dx = x - bv.prevX;
    const dy = y - bv.prevY;
    const delta = Math.sqrt(dx * dx + dy * dy);
    const bounced = delta > 2 && speed > 1 && (dx * vx + dy * vy) < 0;

    bv.prevX = x;
    bv.prevY = y;
    return bounced;
  }

  /**
   * Visual entfernen. Sofortiger Cleanup.
   */
  destroyVisual(id: number): void {
    const bv = this.bullets.get(id);
    if (!bv) return;
    this.bullets.delete(id);
    bv.bullet.destroy();
    bv.trail.destroy();
    bv.glow.destroy();
  }

  /**
   * Funken-Effekt bei Aufprall (Wand, Felsen, Zug).
   * Nutzt die im Visual gespeicherte Stil-Konfiguration für Spark-Werte.
   */
  playImpactSparks(id: number, x: number, y: number, dirX: number, dirY: number, _color: number): void {
    const bv  = this.bullets.get(id);
    const cfg = bv?.config ?? BULLET_STYLE;

    const baseAngle = Math.atan2(dirY, dirX) * (180 / Math.PI);
    const emitter = this.scene.add.particles(x, y, TEX_SPARK, {
      speed:    { min: cfg.sparkSpeedMin, max: cfg.sparkSpeedMax },
      angle:    { min: baseAngle - cfg.sparkSpreadDeg, max: baseAngle + cfg.sparkSpreadDeg },
      lifespan: cfg.sparkLifespan,
      alpha:    { start: 1.0, end: 0.0 },
      scale:    { start: cfg.sparkScaleStart, end: cfg.sparkScaleEnd },
      rotate:   { min: 0, max: 360 },
      color:    SPARK_COLORS,
      blendMode: Phaser.BlendModes.ADD,
      gravityY:  cfg.sparkGravityY,
      emitting:  false,
    });
    emitter.setDepth(DEPTH_SPARK);
    emitter.explode(cfg.sparkCount);

    this.activeSparkEmitters.push(emitter);
    this.scene.time.delayedCall(cfg.sparkLifespan + 80, () => {
      const idx = this.activeSparkEmitters.indexOf(emitter);
      if (idx !== -1) this.activeSparkEmitters.splice(idx, 1);
      if (emitter.scene) emitter.destroy();
    });
  }

  /** Prüft ob ein Visual für diese ID existiert. */
  has(id: number): boolean {
    return this.bullets.has(id);
  }

  /** Gibt alle aktiven Bullet-IDs zurück (für Client-Cleanup). */
  getActiveIds(): Iterable<number> {
    return this.bullets.keys();
  }

  /**
   * Alle Visuals sofort zerstören (Arena-Teardown).
   */
  destroyAll(): void {
    for (const [, bv] of this.bullets) {
      bv.bullet.destroy();
      bv.trail.destroy();
      bv.glow.destroy();
    }
    this.bullets.clear();

    for (const e of this.activeSparkEmitters) {
      if (e.scene) e.destroy();
    }
    this.activeSparkEmitters.length = 0;
  }
}
