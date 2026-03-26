import Phaser from 'phaser';
import { DEPTH, isPointInsideArena } from '../config';
import type { BulletVisualPreset } from '../types';
import { configureAdditiveImage, ensureCanvasTexture } from './EffectUtils';

// ── Textur-Schlüssel (einmal erzeugt, global gecacht) ──────────────────────
const TEX_TRAIL = '__bullet_trail';
const TEX_GLOW  = '__bullet_glow';
const TEX_SPARK = '__bullet_spark';

// ── Textur-Dimensionen ─────────────────────────────────────────────────────
const TRAIL_TEX_W   = 48;
const TRAIL_TEX_H   = 8;
const GLOW_TEX_SIZE = 24;

// Depth-Layer
const DEPTH_TRAIL  = DEPTH.PROJECTILES - 1;
const DEPTH_GLOW   = DEPTH.PROJECTILES - 1;
const DEPTH_BULLET = DEPTH.PROJECTILES;
const DEPTH_ACCENT = DEPTH.PROJECTILES + 1;
const DEPTH_SPARK  = DEPTH.PROJECTILES + 1;

// ── Stil-Konfiguration ────────────────────────────────────────────────────
export interface BulletStyleConfig {
  bodyTextureKey:  string;
  accentTextureKey?: string;
  scaleBoost:      number;
  trailLengthMult: number;
  trailAlpha:      number;
  trailScaleYMult: number;
  glowScale:       number;
  glowAlpha:       number;
  accentAlpha:     number;
  accentScaleX:    number;
  accentScaleY:    number;
  sparkCount:      number;
  sparkLifespan:   number;
  sparkSpeedMin:   number;
  sparkSpeedMax:   number;
  sparkSpreadDeg:  number;
  sparkGravityY:   number;
  sparkScaleStart: number;
  sparkScaleEnd:   number;
  sparkColors:     readonly number[];
  impactFlashScale: number;
  impactFlashAlpha: number;
  impactFlashDuration: number;
}

const DEFAULT_BULLET_VISUAL_PRESET: BulletVisualPreset = 'default';

const BODY_TEXTURE_KEYS: Record<BulletVisualPreset, string> = {
  default: '__bullet_body_default',
  glock: '__bullet_body_glock',
  xbow: '__bullet_body_xbow',
  p90: '__bullet_body_p90',
  ak47: '__bullet_body_ak47',
  shotgun: '__bullet_body_shotgun',
  awp: '__bullet_body_awp',
  gauss: '__bullet_body_gauss',
  negev: '__bullet_body_negev',
};

const ACCENT_TEXTURE_KEYS: Record<BulletVisualPreset, string | undefined> = {
  default: '__bullet_accent_default',
  glock: '__bullet_accent_glock',
  xbow: '__bullet_accent_xbow',
  p90: '__bullet_accent_p90',
  ak47: '__bullet_accent_ak47',
  shotgun: '__bullet_accent_shotgun',
  awp: '__bullet_accent_awp',
  gauss: '__bullet_accent_gauss',
  negev: '__bullet_accent_negev',
};

const BULLET_STYLE_PRESETS: Record<BulletVisualPreset, BulletStyleConfig> = {
  default: {
    bodyTextureKey: BODY_TEXTURE_KEYS.default,
    accentTextureKey: ACCENT_TEXTURE_KEYS.default,
    scaleBoost:      1.0,
    trailLengthMult: 6,
    trailAlpha:      0.72,
    trailScaleYMult: 1.15,
    glowScale:       1.9,
    glowAlpha:       0.32,
    accentAlpha:     0.42,
    accentScaleX:    1.05,
    accentScaleY:    0.95,
    sparkCount:      12,
    sparkLifespan:   250,
    sparkSpeedMin:   90,
    sparkSpeedMax:   300,
    sparkSpreadDeg:  50,
    sparkGravityY:   200,
    sparkScaleStart: 1.4,
    sparkScaleEnd:   0.2,
    sparkColors:     [0xffffff, 0xffee88, 0xffaa44, 0xff6622],
    impactFlashScale: 2.1,
    impactFlashAlpha: 0.4,
    impactFlashDuration: 90,
  },
  glock: {
    bodyTextureKey: BODY_TEXTURE_KEYS.glock,
    accentTextureKey: ACCENT_TEXTURE_KEYS.glock,
    scaleBoost:      0.95,
    trailLengthMult: 4.8,
    trailAlpha:      0.62,
    trailScaleYMult: 0.95,
    glowScale:       1.45,
    glowAlpha:       0.22,
    accentAlpha:     0.48,
    accentScaleX:    0.95,
    accentScaleY:    0.8,
    sparkCount:      8,
    sparkLifespan:   200,
    sparkSpeedMin:   70,
    sparkSpeedMax:   220,
    sparkSpreadDeg:  40,
    sparkGravityY:   180,
    sparkScaleStart: 1.1,
    sparkScaleEnd:   0.16,
    sparkColors:     [0xffffff, 0xffd98f, 0xffb561, 0xff7d2e],
    impactFlashScale: 1.6,
    impactFlashAlpha: 0.28,
    impactFlashDuration: 70,
  },
  xbow: {
    bodyTextureKey: BODY_TEXTURE_KEYS.xbow,
    accentTextureKey: ACCENT_TEXTURE_KEYS.xbow,
    scaleBoost:      1.25,
    trailLengthMult: 4.2,
    trailAlpha:      0.2,
    trailScaleYMult: 0.7,
    glowScale:       1.15,
    glowAlpha:       0.14,
    accentAlpha:     0.62,
    accentScaleX:    1.08,
    accentScaleY:    1.08,
    sparkCount:      5,
    sparkLifespan:   180,
    sparkSpeedMin:   50,
    sparkSpeedMax:   170,
    sparkSpreadDeg:  22,
    sparkGravityY:   140,
    sparkScaleStart: 0.95,
    sparkScaleEnd:   0.1,
    sparkColors:     [0xf4f2ee, 0xd8c49c, 0x8f7650],
    impactFlashScale: 1.2,
    impactFlashAlpha: 0.14,
    impactFlashDuration: 55,
  },
  p90: {
    bodyTextureKey: BODY_TEXTURE_KEYS.p90,
    accentTextureKey: ACCENT_TEXTURE_KEYS.p90,
    scaleBoost:      0.88,
    trailLengthMult: 7.6,
    trailAlpha:      0.78,
    trailScaleYMult: 0.82,
    glowScale:       1.55,
    glowAlpha:       0.27,
    accentAlpha:     0.72,
    accentScaleX:    1.2,
    accentScaleY:    0.72,
    sparkCount:      10,
    sparkLifespan:   170,
    sparkSpeedMin:   100,
    sparkSpeedMax:   260,
    sparkSpreadDeg:  34,
    sparkGravityY:   160,
    sparkScaleStart: 1.0,
    sparkScaleEnd:   0.08,
    sparkColors:     [0xffffff, 0xffeea8, 0xffd269, 0xff8b2a],
    impactFlashScale: 1.5,
    impactFlashAlpha: 0.22,
    impactFlashDuration: 65,
  },
  ak47: {
    bodyTextureKey: BODY_TEXTURE_KEYS.ak47,
    accentTextureKey: ACCENT_TEXTURE_KEYS.ak47,
    scaleBoost:      1.15,
    trailLengthMult: 6.9,
    trailAlpha:      0.74,
    trailScaleYMult: 1.1,
    glowScale:       2.1,
    glowAlpha:       0.34,
    accentAlpha:     0.54,
    accentScaleX:    1.12,
    accentScaleY:    0.9,
    sparkCount:      14,
    sparkLifespan:   250,
    sparkSpeedMin:   110,
    sparkSpeedMax:   340,
    sparkSpreadDeg:  46,
    sparkGravityY:   210,
    sparkScaleStart: 1.45,
    sparkScaleEnd:   0.12,
    sparkColors:     [0xffffff, 0xffdf9d, 0xffa24f, 0xff5d1f],
    impactFlashScale: 2.0,
    impactFlashAlpha: 0.36,
    impactFlashDuration: 85,
  },
  shotgun: {
    bodyTextureKey: BODY_TEXTURE_KEYS.shotgun,
    accentTextureKey: ACCENT_TEXTURE_KEYS.shotgun,
    scaleBoost:      1.18,
    trailLengthMult: 3.0,
    trailAlpha:      0.34,
    trailScaleYMult: 1.45,
    glowScale:       1.7,
    glowAlpha:       0.2,
    accentAlpha:     0.36,
    accentScaleX:    0.8,
    accentScaleY:    0.8,
    sparkCount:      7,
    sparkLifespan:   120,
    sparkSpeedMin:   45,
    sparkSpeedMax:   170,
    sparkSpreadDeg:  60,
    sparkGravityY:   240,
    sparkScaleStart: 1.15,
    sparkScaleEnd:   0.06,
    sparkColors:     [0xffffff, 0xffd2a1, 0xff9b57],
    impactFlashScale: 1.35,
    impactFlashAlpha: 0.18,
    impactFlashDuration: 50,
  },
  awp: {
    bodyTextureKey: BODY_TEXTURE_KEYS.awp,
    accentTextureKey: ACCENT_TEXTURE_KEYS.awp,
    scaleBoost:      1.4,
    trailLengthMult: 8.0,
    trailAlpha:      0.88,
    trailScaleYMult: 1.34,
    glowScale:       2.8,
    glowAlpha:       0.4,
    accentAlpha:     0.68,
    accentScaleX:    1.24,
    accentScaleY:    0.92,
    sparkCount:      16,
    sparkLifespan:   280,
    sparkSpeedMin:   110,
    sparkSpeedMax:   380,
    sparkSpreadDeg:  55,
    sparkGravityY:   220,
    sparkScaleStart: 1.6,
    sparkScaleEnd:   0.15,
    sparkColors:     [0xffffff, 0xfff1b8, 0xffc768, 0xff7a1f],
    impactFlashScale: 2.5,
    impactFlashAlpha: 0.48,
    impactFlashDuration: 110,
  },
  gauss: {
    bodyTextureKey: BODY_TEXTURE_KEYS.gauss,
    accentTextureKey: ACCENT_TEXTURE_KEYS.gauss,
    scaleBoost:      1.75,
    trailLengthMult: 9.8,
    trailAlpha:      0.95,
    trailScaleYMult: 2.4,
    glowScale:       3.4,
    glowAlpha:       0.62,
    accentAlpha:     0.88,
    accentScaleX:    1.42,
    accentScaleY:    1.1,
    sparkCount:      22,
    sparkLifespan:   320,
    sparkSpeedMin:   120,
    sparkSpeedMax:   420,
    sparkSpreadDeg:  65,
    sparkGravityY:   80,
    sparkScaleStart: 1.8,
    sparkScaleEnd:   0.18,
    sparkColors:     [0xffffff, 0xd9fbff, 0x8ae0ff, 0x3ab4ff],
    impactFlashScale: 3.1,
    impactFlashAlpha: 0.72,
    impactFlashDuration: 140,
  },
  negev: {
    bodyTextureKey: BODY_TEXTURE_KEYS.negev,
    accentTextureKey: ACCENT_TEXTURE_KEYS.negev,
    scaleBoost:      0.9,
    trailLengthMult: 8.2,
    trailAlpha:      0.82,
    trailScaleYMult: 0.86,
    glowScale:       1.65,
    glowAlpha:       0.26,
    accentAlpha:     0.58,
    accentScaleX:    1.2,
    accentScaleY:    0.74,
    sparkCount:      9,
    sparkLifespan:   160,
    sparkSpeedMin:   105,
    sparkSpeedMax:   280,
    sparkSpreadDeg:  28,
    sparkGravityY:   140,
    sparkScaleStart: 0.92,
    sparkScaleEnd:   0.06,
    sparkColors:     [0xffffff, 0xffecaa, 0xffc45e, 0xff7b26],
    impactFlashScale: 1.45,
    impactFlashAlpha: 0.18,
    impactFlashDuration: 48,
  },
};

// ── Interner State pro Bullet ──────────────────────────────────────────────
interface BulletVisual {
  bullet:  Phaser.GameObjects.Image;
  accent:  Phaser.GameObjects.Image | null;
  trail:   Phaser.GameObjects.Image;
  glow:    Phaser.GameObjects.Image;
  prevX:   number;
  prevY:   number;
  config:  BulletStyleConfig;
  accentColor: number;
}

/**
 * Rendert Bullet-artige Projektile (Standard-Bullet + AWP) mit:
 * - Geformtem Projektil-Sprite (längliches Capsule mit hellem Kern)
 * - Glatter Leuchtspur (Image-basiert)
 * - Weichem Glow-Halo um das Projektil
 * - Funkensprühen bei Impact
 *
 * Stil-Unterschiede werden über data-driven BulletVisualPreset-Presets gesteuert.
 */
export class BulletRenderer {
  private scene: Phaser.Scene;
  private bullets = new Map<number, BulletVisual>();

  // Pool für Impact-Emitter (auto-destroy nach Lifespan)
  private activeSparkEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  private resolveConfig(preset?: BulletVisualPreset): BulletStyleConfig {
    return BULLET_STYLE_PRESETS[preset ?? DEFAULT_BULLET_VISUAL_PRESET] ?? BULLET_STYLE_PRESETS.default;
  }

  private createBodyTexture(texMgr: Phaser.Textures.TextureManager, preset: BulletVisualPreset): void {
    const key = BODY_TEXTURE_KEYS[preset];
    switch (preset) {
      case 'glock':
        ensureCanvasTexture(texMgr, key, 12, 5, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.roundRect(0.5, 0.5, 10.5, 4, 1.8);
          ctx.fill();
          ctx.fillRect(8, 1.4, 3, 2.2);
        });
        break;
      case 'xbow':
        ensureCanvasTexture(texMgr, key, 18, 6, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(0.5, 2.8);
          ctx.lineTo(9, 2.8);
          ctx.lineTo(13.2, 0.6);
          ctx.lineTo(17.2, 2.8);
          ctx.lineTo(13.2, 5.4);
          ctx.lineTo(9, 3.3);
          ctx.lineTo(0.5, 3.3);
          ctx.closePath();
          ctx.fill();
          ctx.fillRect(0, 1.5, 9.2, 3);
        });
        break;
      case 'p90':
        ensureCanvasTexture(texMgr, key, 16, 4, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(0.5, 2);
          ctx.lineTo(11.5, 0.5);
          ctx.lineTo(15.5, 2);
          ctx.lineTo(11.5, 3.5);
          ctx.closePath();
          ctx.fill();
        });
        break;
      case 'ak47':
        ensureCanvasTexture(texMgr, key, 18, 6, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(0.5, 1.4);
          ctx.lineTo(9.5, 1.4);
          ctx.lineTo(15.5, 0.6);
          ctx.lineTo(17.5, 3);
          ctx.lineTo(15.5, 5.4);
          ctx.lineTo(9.5, 4.6);
          ctx.lineTo(0.5, 4.6);
          ctx.closePath();
          ctx.fill();
        });
        break;
      case 'shotgun':
        ensureCanvasTexture(texMgr, key, 8, 8, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(4, 4, 2.7, 0, Math.PI * 2);
          ctx.fill();
        });
        break;
      case 'awp':
        ensureCanvasTexture(texMgr, key, 20, 6, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(0.5, 1.4);
          ctx.lineTo(12, 1.1);
          ctx.lineTo(18.8, 3);
          ctx.lineTo(12, 4.9);
          ctx.lineTo(0.5, 4.6);
          ctx.closePath();
          ctx.fill();
        });
        break;
      case 'gauss':
        ensureCanvasTexture(texMgr, key, 24, 10, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(0.5, 5);
          ctx.lineTo(12, 1.1);
          ctx.lineTo(22.8, 5);
          ctx.lineTo(12, 8.9);
          ctx.closePath();
          ctx.fill();
        });
        break;
      case 'negev':
        ensureCanvasTexture(texMgr, key, 15, 4, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(0.5, 2);
          ctx.lineTo(11.3, 0.8);
          ctx.lineTo(14.3, 2);
          ctx.lineTo(11.3, 3.2);
          ctx.closePath();
          ctx.fill();
        });
        break;
      default:
        ensureCanvasTexture(texMgr, key, 14, 6, (ctx) => {
          const r = 3;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(r, 0);
          ctx.lineTo(14 - r, 0);
          ctx.arc(14 - r, r, r, -Math.PI / 2, Math.PI / 2);
          ctx.lineTo(r, 6);
          ctx.arc(r, r, r, Math.PI / 2, -Math.PI / 2);
          ctx.closePath();
          ctx.fill();
        });
        break;
    }
  }

  private createAccentTexture(texMgr: Phaser.Textures.TextureManager, preset: BulletVisualPreset): void {
    const key = ACCENT_TEXTURE_KEYS[preset];
    if (!key) return;

    switch (preset) {
      case 'glock':
        ensureCanvasTexture(texMgr, key, 12, 5, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(1, 1.8, 3.5, 1.4);
          ctx.fillRect(6.8, 1.4, 2.6, 2.2);
        });
        break;
      case 'xbow':
        ensureCanvasTexture(texMgr, key, 18, 6, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(0.6, 2.9);
          ctx.lineTo(3.8, 0.8);
          ctx.lineTo(4.8, 2.3);
          ctx.lineTo(4.8, 3.5);
          ctx.lineTo(3.8, 5.2);
          ctx.closePath();
          ctx.fill();
        });
        break;
      case 'p90':
        ensureCanvasTexture(texMgr, key, 16, 4, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(1, 1.5, 9, 1);
          ctx.fillRect(10.5, 1, 3.2, 2);
        });
        break;
      case 'ak47':
        ensureCanvasTexture(texMgr, key, 18, 6, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(1, 2.2, 8, 1.6);
          ctx.fillRect(9.5, 1.7, 4.2, 2.6);
        });
        break;
      case 'shotgun':
        ensureCanvasTexture(texMgr, key, 8, 8, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(4, 4, 1.1, 0, Math.PI * 2);
          ctx.fill();
        });
        break;
      case 'awp':
        ensureCanvasTexture(texMgr, key, 20, 6, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(1.5, 2.1, 12.5, 1.8);
          ctx.fillRect(13.8, 1.4, 3.8, 3.2);
        });
        break;
      case 'gauss':
        ensureCanvasTexture(texMgr, key, 24, 10, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(1.5, 4.1, 10, 1.8);
          ctx.fillRect(11.8, 2.6, 6.2, 4.8);
          ctx.fillRect(18.4, 4.1, 3.8, 1.8);
        });
        break;
      case 'negev':
        ensureCanvasTexture(texMgr, key, 15, 4, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(1, 1.4, 8.5, 1.2);
          ctx.fillRect(9.8, 1, 2.8, 2);
        });
        break;
      default:
        ensureCanvasTexture(texMgr, key, 14, 6, (ctx) => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(1.5, 2.2, 8.8, 1.6);
        });
        break;
    }
  }

  // ── Texturen ──────────────────────────────────────────────────────────────

  /**
   * Erzeugt alle benötigten Texturen prozedural (einmalig pro Scene).
   * Muss vor createVisual() aufgerufen werden.
   */
  generateTextures(): void {
    const texMgr = this.scene.textures;

    for (const preset of Object.keys(BULLET_STYLE_PRESETS) as BulletVisualPreset[]) {
      this.createBodyTexture(texMgr, preset);
      this.createAccentTexture(texMgr, preset);
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
   * Erstellt Bullet-Visual (Form + Trail + Glow + Spielerfarben-Akzent) für ein neues Projektil.
   */
  createVisual(
    id: number,
    x: number,
    y: number,
    size: number,
    color: number,
    preset: BulletVisualPreset = DEFAULT_BULLET_VISUAL_PRESET,
    accentColor: number = color,
  ): void {
    if (this.bullets.has(id)) return;

    const config = this.resolveConfig(preset);

    const scaleFactor = Math.max(size / 5, 0.6) * config.scaleBoost;

    const bullet = this.scene.add.image(x, y, config.bodyTextureKey);
    bullet.setScale(scaleFactor, scaleFactor);
    bullet.setTint(color);
    bullet.setDepth(DEPTH_BULLET);

    const accent = config.accentTextureKey
      ? configureAdditiveImage(
        this.scene.add.image(x, y, config.accentTextureKey)
          .setScale(scaleFactor * config.accentScaleX, scaleFactor * config.accentScaleY),
        DEPTH_ACCENT,
        config.accentAlpha,
        accentColor,
      )
      : null;

    const trail = this.scene.add.image(x, y, TEX_TRAIL);
    trail.setOrigin(1.0, 0.5);
    trail.setScale((size * config.trailLengthMult) / TRAIL_TEX_W, scaleFactor * config.trailScaleYMult);
    trail.setTint(accentColor);
    trail.setAlpha(config.trailAlpha);
    trail.setBlendMode(Phaser.BlendModes.ADD);
    trail.setDepth(DEPTH_TRAIL);

    const glow = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_GLOW).setScale(scaleFactor * config.glowScale),
      DEPTH_GLOW,
      config.glowAlpha,
      accentColor,
    );

    this.bullets.set(id, { bullet, accent, trail, glow, prevX: x, prevY: y, config, accentColor });
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
    bv.accent?.setPosition(x, y).setRotation(rot);
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
      bv.accent?.setRotation(rot);
      bv.trail.setRotation(rot);
    }

    bv.bullet.setPosition(x, y);
    bv.accent?.setPosition(x, y);
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
    bv.accent?.destroy();
    bv.trail.destroy();
    bv.glow.destroy();
  }

  /**
   * Funken-Effekt bei Aufprall (Wand, Felsen, Zug).
   * Nutzt die im Visual gespeicherte Stil-Konfiguration für Spark-Werte.
   */
  playImpactSparks(id: number, x: number, y: number, dirX: number, dirY: number, _color: number): void {
    if (!isPointInsideArena(x, y)) return;
    const bv  = this.bullets.get(id);
    const cfg = bv?.config ?? BULLET_STYLE_PRESETS.default;

    const baseAngle = Math.atan2(dirY, dirX) * (180 / Math.PI);
    const emitter = this.scene.add.particles(x, y, TEX_SPARK, {
      speed:    { min: cfg.sparkSpeedMin, max: cfg.sparkSpeedMax },
      angle:    { min: baseAngle - cfg.sparkSpreadDeg, max: baseAngle + cfg.sparkSpreadDeg },
      lifespan: cfg.sparkLifespan,
      alpha:    { start: 1.0, end: 0.0 },
      scale:    { start: cfg.sparkScaleStart, end: cfg.sparkScaleEnd },
      rotate:   { min: 0, max: 360 },
      color:    [...cfg.sparkColors, bv?.accentColor ?? _color],
      blendMode: Phaser.BlendModes.ADD,
      gravityY:  cfg.sparkGravityY,
      emitting:  false,
    });
    emitter.setDepth(DEPTH_SPARK);
    emitter.explode(cfg.sparkCount);

    const impactFlash = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_GLOW).setScale(cfg.impactFlashScale),
      DEPTH_SPARK,
      cfg.impactFlashAlpha,
      bv?.accentColor ?? _color,
    );
    this.scene.tweens.add({
      targets: impactFlash,
      alpha: 0,
      scaleX: cfg.impactFlashScale * 1.45,
      scaleY: cfg.impactFlashScale * 1.45,
      duration: cfg.impactFlashDuration,
      ease: 'Quad.easeOut',
      onComplete: () => { if (impactFlash.scene) impactFlash.destroy(); },
    });

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
      bv.accent?.destroy();
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
