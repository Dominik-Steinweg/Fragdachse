import Phaser from 'phaser';
import { DEPTH } from '../config';

// ── Textur-Schlüssel (einmal erzeugt, global gecacht) ──────────────────────
const TEX_BULLET  = '__bullet_shape';
const TEX_TRAIL   = '__bullet_trail';
const TEX_SPARK   = '__bullet_spark';

// ── Konfiguration ──────────────────────────────────────────────────────────
const TRAIL_LIFESPAN   = 140;   // ms – wie lange ein Trail-Partikel lebt
const TRAIL_FREQUENCY  = 8;     // ms – Partikel-Spawn-Intervall
const TRAIL_ALPHA_START = 0.7;
const TRAIL_ALPHA_END   = 0;
const TRAIL_SCALE_START = 1.0;
const TRAIL_SCALE_END   = 0.15;
const TRAIL_MAX_PARTICLES = 24; // pro Emitter

const SPARK_COUNT       = 10;   // Funken pro Impact
const SPARK_LIFESPAN    = 220;  // ms
const SPARK_SPEED_MIN   = 80;
const SPARK_SPEED_MAX   = 260;
const SPARK_SPREAD_DEG  = 50;   // ±Grad um Reflexionsrichtung
const SPARK_GRAVITY_Y   = 180;  // leichte Schwerkraft für Funken
const SPARK_COLORS      = [0xffee88, 0xffffff, 0xffaa44, 0xffdd66]; // metallisches Gelb/Weiß/Orange

const DEPTH_TRAIL  = DEPTH.PROJECTILES - 1;
const DEPTH_BULLET = DEPTH.PROJECTILES;
const DEPTH_SPARK  = DEPTH.PROJECTILES + 10; // über Projektilen, unter OVERLAY

// ── Interner State pro Bullet ──────────────────────────────────────────────
interface BulletVisual {
  image:   Phaser.GameObjects.Image;
  trail:   Phaser.GameObjects.Particles.ParticleEmitter;
  prevX:   number;
  prevY:   number;
}

/**
 * Rendert Bullet-Stil-Projektile mit:
 * - Geformtem Projektil-Sprite (längliches Capsule)
 * - Leuchtender Nachzieher-Spur (Partikel-Emitter pro Bullet)
 * - Funkensprühen bei Impact (Wände, Felsen)
 *
 * Standalone-Modul – wird vom ProjectileManager für style='bullet' genutzt.
 * Kann für zukünftige Stile (plasma, laser) als Vorlage dienen.
 */
export class BulletRenderer {
  private scene: Phaser.Scene;
  private bullets = new Map<number, BulletVisual>();

  // Einmal-Emitter für Impact-Funken (wiederverwendbar, performance-schonend)
  private sparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

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

    // Bullet-Shape: längliches Capsule (12×5 px, 3:1)
    if (!texMgr.exists(TEX_BULLET)) {
      const bw = 12, bh = 5;
      const canvas = texMgr.createCanvas(TEX_BULLET, bw, bh)!;
      const ctx = canvas.context;
      const r = bh / 2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(bw - r, 0);
      ctx.arcTo(bw, 0, bw, r, r);
      ctx.arcTo(bw, bh, bw - r, bh, r);
      ctx.lineTo(r, bh);
      ctx.arcTo(0, bh, 0, r, r);
      ctx.arcTo(0, 0, r, 0, r);
      ctx.closePath();
      ctx.fill();
      // Hellerer Kern (vordere Hälfte)
      const grad = ctx.createLinearGradient(0, 0, bw, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0.0)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
      grad.addColorStop(1, 'rgba(255,255,255,0.8)');
      ctx.fillStyle = grad;
      ctx.fill();
      canvas.refresh();
    }

    // Trail-Partikel: weicher Kreis (8×8 px)
    if (!texMgr.exists(TEX_TRAIL)) {
      const ts = 8;
      const canvas = texMgr.createCanvas(TEX_TRAIL, ts, ts)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(ts / 2, ts / 2, 0, ts / 2, ts / 2, ts / 2);
      grad.addColorStop(0,   'rgba(255,255,255,1.0)');
      grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
      grad.addColorStop(1,   'rgba(255,255,255,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, ts, ts);
      canvas.refresh();
    }

    // Spark-Partikel: harter Punkt (4×4 px)
    if (!texMgr.exists(TEX_SPARK)) {
      const ss = 4;
      const canvas = texMgr.createCanvas(TEX_SPARK, ss, ss)!;
      const ctx = canvas.context;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ss / 2, ss / 2, ss / 2, 0, Math.PI * 2);
      ctx.fill();
      canvas.refresh();
    }

    // Einmal-Spark-Emitter vorbereiten (wird bei Impacts via explode() getriggert)
    this.ensureSparkEmitter();
  }

  // ── Bullet erstellen / aktualisieren / zerstören ─────────────────────────

  /**
   * Erstellt Bullet-Visual + Trail-Emitter für ein neues Projektil.
   */
  createBullet(id: number, x: number, y: number, size: number, color: number): void {
    if (this.bullets.has(id)) return;

    // Bullet-Image (Capsule-Form)
    const image = this.scene.add.image(x, y, TEX_BULLET);
    const scaleFactor = Math.max(size / 5, 0.6); // relativ zu Basis-Größe 5px
    image.setScale(scaleFactor, scaleFactor);
    image.setTint(color);
    image.setDepth(DEPTH_BULLET);
    image.setOrigin(0.5, 0.5);

    // Trail-Partikel-Emitter (folgt dem Bullet)
    const trail = this.scene.add.particles(0, 0, TEX_TRAIL, {
      follow: image,
      frequency: TRAIL_FREQUENCY,
      lifespan: TRAIL_LIFESPAN,
      alpha: { start: TRAIL_ALPHA_START, end: TRAIL_ALPHA_END },
      scale: { start: TRAIL_SCALE_START * scaleFactor, end: TRAIL_SCALE_END * scaleFactor },
      tint: color,
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: TRAIL_MAX_PARTICLES,
      emitting: true,
    });
    trail.setDepth(DEPTH_TRAIL);

    this.bullets.set(id, { image, trail, prevX: x, prevY: y });
  }

  /**
   * Host-seitig: Bullet-Position und -Rotation anhand der Physik-Velocity setzen.
   * Gibt true zurück wenn ein Bounce erkannt wurde (vx/vy-Richtungswechsel).
   */
  syncBulletToBody(id: number, x: number, y: number, vx: number, vy: number): boolean {
    const bv = this.bullets.get(id);
    if (!bv) return false;

    bv.image.setPosition(x, y);
    bv.image.setRotation(Math.atan2(vy, vx));

    // Bounce-Erkennung: Richtungswechsel in X oder Y
    const dx = x - bv.prevX;
    const dy = y - bv.prevY;
    const dotX = dx * vx;
    const dotY = dy * vy;
    const bounced = (bv.prevX !== x || bv.prevY !== y) && (dotX < -0.5 || dotY < -0.5);

    bv.prevX = x;
    bv.prevY = y;

    return bounced;
  }

  /**
   * Client-seitig: Bullet-Position setzen und Rotation aus Delta berechnen.
   * Gibt true zurück wenn ein Bounce erkannt wurde (Richtungswechsel im Delta).
   */
  updateBulletPosition(id: number, x: number, y: number, vx: number, vy: number): boolean {
    const bv = this.bullets.get(id);
    if (!bv) return false;

    // Rotation aus Velocity
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > 1) {
      bv.image.setRotation(Math.atan2(vy, vx));
    }

    // Bounce-Erkennung: Richtungswechsel zwischen altem Delta und neuer Velocity
    const dx = x - bv.prevX;
    const dy = y - bv.prevY;
    const delta = Math.sqrt(dx * dx + dy * dy);
    let bounced = false;
    if (delta > 2 && speed > 1) {
      const dot = dx * vx + dy * vy;
      bounced = dot < 0; // Velocity zeigt entgegen der Bewegungsrichtung → Bounce
    }

    bv.image.setPosition(x, y);
    bv.prevX = x;
    bv.prevY = y;

    return bounced;
  }

  /**
   * Bullet-Visual entfernen. Trail-Partikel dürfen noch ausfaden.
   */
  destroyBullet(id: number): void {
    const bv = this.bullets.get(id);
    if (!bv) return;
    this.bullets.delete(id);

    bv.image.destroy();
    // Trail stoppen, aber ausfaden lassen
    bv.trail.stop();
    this.scene.time.delayedCall(TRAIL_LIFESPAN + 50, () => {
      if (!bv.trail.scene) return; // Scene bereits zerstört
      bv.trail.destroy();
    });
  }

  /**
   * Funken-Effekt bei Aufprall (Wand, Felsen, Zug).
   * @param x      Aufprall-Position
   * @param y      Aufprall-Position
   * @param dirX   Reflexions-Richtung X (weg von der Wand)
   * @param dirY   Reflexions-Richtung Y
   * @param color  Projektilfarbe (für leichtes Tinting)
   */
  playImpactSparks(x: number, y: number, dirX: number, dirY: number, _color: number): void {
    const emitter = this.sparkEmitter;
    if (!emitter) return;

    // Reflexionswinkel berechnen
    const baseAngle = Math.atan2(dirY, dirX) * (180 / Math.PI);

    // Emitter konfigurieren und Burst feuern
    emitter.setPosition(x, y);
    emitter.particleAngle = {
      min: baseAngle - SPARK_SPREAD_DEG,
      max: baseAngle + SPARK_SPREAD_DEG,
    };
    emitter.explode(SPARK_COUNT);
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
      bv.image.destroy();
      bv.trail.destroy();
    }
    this.bullets.clear();

    if (this.sparkEmitter) {
      this.sparkEmitter.destroy();
      this.sparkEmitter = null;
    }
  }

  // ── Intern ───────────────────────────────────────────────────────────────

  private ensureSparkEmitter(): void {
    if (this.sparkEmitter) return;

    this.sparkEmitter = this.scene.add.particles(0, 0, TEX_SPARK, {
      speed: { min: SPARK_SPEED_MIN, max: SPARK_SPEED_MAX },
      angle: { min: 0, max: 360 },
      lifespan: SPARK_LIFESPAN,
      alpha: { start: 1.0, end: 0 },
      scale: { start: 1.2, end: 0.3 },
      tint: SPARK_COLORS,
      blendMode: Phaser.BlendModes.ADD,
      gravityY: SPARK_GRAVITY_Y,
      emitting: false,
    });
    this.sparkEmitter.setDepth(DEPTH_SPARK);
  }
}
