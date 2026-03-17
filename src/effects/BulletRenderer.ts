import Phaser from 'phaser';
import { DEPTH } from '../config';

// ── Textur-Schlüssel (einmal erzeugt, global gecacht) ──────────────────────
const TEX_BULLET = '__bullet_shape';
const TEX_TRAIL  = '__bullet_trail';
const TEX_GLOW   = '__bullet_glow';
const TEX_SPARK  = '__bullet_spark';

// ── Konfiguration ──────────────────────────────────────────────────────────

// Trail-Image (gestreckte Gradient-Textur hinter dem Bullet)
const TRAIL_TEX_W       = 48;   // Textur-Breite (px)
const TRAIL_TEX_H       = 8;    // Textur-Höhe (px)
const TRAIL_LENGTH_MULT = 6;    // Trail-Länge = bulletSize * Mult

// Glow-Halo um das Projektil
const GLOW_TEX_SIZE  = 24;
const GLOW_SCALE     = 2.0;   // relativer Multiplikator zur Bullet-Größe
const GLOW_ALPHA     = 0.45;

// Impact-Funken (One-Shot-Emitter pro Impact)
const SPARK_COUNT      = 12;
const SPARK_LIFESPAN   = 250;
const SPARK_SPEED_MIN  = 90;
const SPARK_SPEED_MAX  = 300;
const SPARK_SPREAD_DEG = 50;    // ±Grad um Reflexionsrichtung
const SPARK_GRAVITY_Y  = 200;
// Phaser 3.90 color-Interpolation: Weiß → Gold → Dunkelorange über Partikel-Lebensdauer
const SPARK_COLORS     = [0xffffff, 0xffee88, 0xffaa44, 0xff6622];

// Depth-Layer
const DEPTH_TRAIL  = DEPTH.PROJECTILES - 1;
const DEPTH_GLOW   = DEPTH.PROJECTILES - 1;
const DEPTH_BULLET = DEPTH.PROJECTILES;
const DEPTH_SPARK  = DEPTH.PROJECTILES + 1;

// ── Interner State pro Bullet ──────────────────────────────────────────────
interface BulletVisual {
  bullet:  Phaser.GameObjects.Image;
  trail:   Phaser.GameObjects.Image;
  glow:    Phaser.GameObjects.Image;
  prevX:   number;
  prevY:   number;
}

/**
 * Rendert Bullet-Stil-Projektile mit:
 * - Geformtem Projektil-Sprite (längliches Capsule mit hellem Kern)
 * - Glatter Leuchtspur (Image-basiert, keine Partikel-Lücken)
 * - Weichem Glow-Halo um das Projektil
 * - Funkensprühen bei Impact (One-Shot-Emitter pro Aufprall)
 *
 * Standalone-Modul – wird vom ProjectileManager für style='bullet' genutzt.
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
   * Muss vor createBullet() aufgerufen werden.
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

  // ── Bullet erstellen / aktualisieren / zerstören ─────────────────────────

  /**
   * Erstellt Bullet-Visual (Capsule + Trail-Image + Glow) für ein neues Projektil.
   */
  createBullet(id: number, x: number, y: number, size: number, color: number): void {
    if (this.bullets.has(id)) return;

    const scaleFactor = Math.max(size / 5, 0.6);

    // Bullet-Image (Capsule-Form)
    const bullet = this.scene.add.image(x, y, TEX_BULLET);
    bullet.setScale(scaleFactor, scaleFactor);
    bullet.setTint(color);
    bullet.setDepth(DEPTH_BULLET);

    // Trail-Image (langgezogener Gradient hinter dem Bullet)
    // Origin rechts-mitte: der helle Kopf liegt am Bullet, der Schweif erstreckt sich nach hinten
    const trail = this.scene.add.image(x, y, TEX_TRAIL);
    trail.setOrigin(1.0, 0.5);
    const trailScaleX = (size * TRAIL_LENGTH_MULT) / TRAIL_TEX_W;
    const trailScaleY = scaleFactor * 1.2;
    trail.setScale(trailScaleX, trailScaleY);
    trail.setTint(color);
    trail.setAlpha(0.75);
    trail.setBlendMode(Phaser.BlendModes.ADD);
    trail.setDepth(DEPTH_TRAIL);

    // Glow-Halo (weicher Schein um das Bullet)
    const glow = this.scene.add.image(x, y, TEX_GLOW);
    glow.setScale(scaleFactor * GLOW_SCALE);
    glow.setTint(color);
    glow.setAlpha(GLOW_ALPHA);
    glow.setBlendMode(Phaser.BlendModes.ADD);
    glow.setDepth(DEPTH_GLOW);

    this.bullets.set(id, { bullet, trail, glow, prevX: x, prevY: y });
  }

  /**
   * Host-seitig: Bullet-Position und -Rotation anhand der Physik-Velocity setzen.
   * Gibt true zurück wenn ein Bounce erkannt wurde.
   */
  syncBulletToBody(id: number, x: number, y: number, vx: number, vy: number): boolean {
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
   * Client-seitig: Bullet-Position setzen und Rotation aus Velocity berechnen.
   * Gibt true zurück wenn ein Bounce erkannt wurde.
   */
  updateBulletPosition(id: number, x: number, y: number, vx: number, vy: number): boolean {
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
   * Bullet-Visual entfernen. Sofortiger Cleanup (Trail braucht kein Fading da Image-basiert).
   */
  destroyBullet(id: number): void {
    const bv = this.bullets.get(id);
    if (!bv) return;
    this.bullets.delete(id);
    bv.bullet.destroy();
    bv.trail.destroy();
    bv.glow.destroy();
  }

  /**
   * Funken-Effekt bei Aufprall (Wand, Felsen, Zug).
   * Erzeugt einen frischen One-Shot-Emitter mit korrekter Winkel-Konfiguration.
   * Nutzt Phaser 3.90 color-Interpolation für Weiß→Gold→Orange Farbverlauf.
   *
   * @param x      Aufprall-Position
   * @param y      Aufprall-Position
   * @param dirX   Reflexions-Richtung X (weg von der Wand, = post-bounce velocity)
   * @param dirY   Reflexions-Richtung Y
   * @param _color Projektilfarbe (reserviert für zukünftige Erweiterung)
   */
  playImpactSparks(x: number, y: number, dirX: number, dirY: number, _color: number): void {
    const baseAngle = Math.atan2(dirY, dirX) * (180 / Math.PI);

    // One-Shot-Emitter: Winkel wird bei Erstellung korrekt gesetzt (kein dynamisches Override nötig)
    const emitter = this.scene.add.particles(x, y, TEX_SPARK, {
      speed:    { min: SPARK_SPEED_MIN, max: SPARK_SPEED_MAX },
      angle:    { min: baseAngle - SPARK_SPREAD_DEG, max: baseAngle + SPARK_SPREAD_DEG },
      lifespan: SPARK_LIFESPAN,
      alpha:    { start: 1.0, end: 0.0 },
      scale:    { start: 1.4, end: 0.2 },
      rotate:   { min: 0, max: 360 },
      color:    SPARK_COLORS,               // Phaser 3.90: Farbinterpolation über Lebensdauer
      blendMode: Phaser.BlendModes.ADD,
      gravityY:  SPARK_GRAVITY_Y,
      emitting:  false,
    });
    emitter.setDepth(DEPTH_SPARK);
    emitter.explode(SPARK_COUNT);

    // Auto-Cleanup nach Ablauf aller Partikel
    this.activeSparkEmitters.push(emitter);
    this.scene.time.delayedCall(SPARK_LIFESPAN + 80, () => {
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
