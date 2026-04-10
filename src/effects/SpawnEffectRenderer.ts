import * as Phaser from 'phaser';
import { DEPTH_FX } from '../config';
import { ensureCanvasTexture, fillRadialGradientTexture } from './EffectUtils';

const TEX_SPAWN_SPARK = '_spawn_spark';
const TEX_SPAWN_GLOW  = '_spawn_glow';

export class SpawnEffectRenderer {
  private texturesReady = false;

  constructor(private readonly scene: Phaser.Scene) {}

  private ensureTextures(): void {
    if (this.texturesReady) return;
    this.texturesReady = true;

    // Kleine weiche Kreisscheibe für Partikel-Funken
    ensureCanvasTexture(this.scene.textures, TEX_SPAWN_SPARK, 12, 12, (ctx) => {
      const cx = 6, cy = 6;
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 6);
      grd.addColorStop(0,   'rgba(255,255,255,1)');
      grd.addColorStop(0.4, 'rgba(255,255,255,0.6)');
      grd.addColorStop(1,   'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 12, 12);
    });

    // Großes Radialgradient-Blob für den zentralen Lichtflash
    fillRadialGradientTexture(this.scene.textures, TEX_SPAWN_GLOW, 64, [
      [0,   'rgba(255,255,255,1)'],
      [0.25,'rgba(255,255,255,0.7)'],
      [0.6, 'rgba(255,255,255,0.2)'],
      [1,   'rgba(255,255,255,0)'],
    ]);
  }

  /**
   * Spielt den vollständigen Spawn-Effekt an Position (x, y) ab.
   * colorHex bestimmt die Tint-Farbe aller Elemente (Spielerfarbe).
   */
  play(x: number, y: number, colorHex: number): void {
    this.ensureTextures();

    this.playCoreBurst(x, y, colorHex);
    this.playRings(x, y, colorHex);
    this.playBeam(x, y, colorHex);
    this.playParticleBurst(x, y, colorHex);
    this.playSecondaryRipple(x, y, colorHex);
  }

  // ─── Zentraler Licht-Burst ──────────────────────────────────────────────────

  private playCoreBurst(x: number, y: number, colorHex: number): void {
    // Weißer Kern
    const core = this.scene.add.image(x, y, TEX_SPAWN_GLOW);
    core.setDisplaySize(20, 20);
    core.setDepth(DEPTH_FX + 1.5);
    core.setBlendMode(Phaser.BlendModes.ADD);
    core.setTint(0xffffff);

    this.scene.tweens.add({
      targets:  core,
      scaleX:   7,
      scaleY:   7,
      alpha:    0,
      duration: 380,
      ease:     'Expo.easeOut',
      onComplete: () => core.destroy(),
    });

    // Farbiger Halo (leicht verzögert)
    const halo = this.scene.add.image(x, y, TEX_SPAWN_GLOW);
    halo.setDisplaySize(24, 24);
    halo.setDepth(DEPTH_FX + 1);
    halo.setBlendMode(Phaser.BlendModes.ADD);
    halo.setTint(colorHex);
    halo.setAlpha(0.85);

    this.scene.tweens.add({
      targets:  halo,
      scaleX:   5,
      scaleY:   5,
      alpha:    0,
      delay:    40,
      duration: 500,
      ease:     'Cubic.easeOut',
      onComplete: () => halo.destroy(),
    });
  }

  // ─── Expandierende Ringe ────────────────────────────────────────────────────

  private playRings(x: number, y: number, colorHex: number): void {
    // Primärring – Spielerfarbe, breit
    this.spawnRing(x, y, colorHex, 0,   400, 6, 44);
    // Sekundärring – weiß, schmal, leicht versetzt
    this.spawnRing(x, y, 0xffffff,  60,  320, 3, 32);
    // Tertiärring – Spielerfarbe, sehr dünn
    this.spawnRing(x, y, colorHex, 120, 480, 2, 58);
  }

  private spawnRing(
    x:            number,
    y:            number,
    color:        number,
    delay:        number,
    duration:     number,
    lineWidth:    number,
    targetRadius: number,
  ): void {
    const startRadius = 5;
    const ring = this.scene.add.circle(x, y, startRadius, 0, 0);
    ring.setDepth(DEPTH_FX);
    ring.isFilled     = false;
    ring.isStroked    = true;
    ring.strokeColor  = color;
    ring.lineWidth    = lineWidth;
    ring.strokeAlpha  = 0.9;
    ring.setBlendMode(Phaser.BlendModes.ADD);

    this.scene.tweens.add({
      targets:  ring,
      scaleX:   targetRadius / startRadius,
      scaleY:   targetRadius / startRadius,
      alpha:    0,
      delay,
      duration,
      ease:     'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  // ─── Vertikaler Lichtstrahl ─────────────────────────────────────────────────

  private playBeam(x: number, y: number, colorHex: number): void {
    const beam = this.scene.add.rectangle(x, y - 56, 10, 112, colorHex, 0.75);
    beam.setDepth(DEPTH_FX - 0.5);
    beam.setBlendMode(Phaser.BlendModes.ADD);

    this.scene.tweens.add({
      targets:  beam,
      scaleX:   0.05,
      alpha:    0,
      y:        y - 140,
      duration: 420,
      ease:     'Quad.easeOut',
      onComplete: () => beam.destroy(),
    });

    // Weicher weißer Überschuss am Strahl
    const beamGlow = this.scene.add.rectangle(x, y - 56, 28, 112, 0xffffff, 0.25);
    beamGlow.setDepth(DEPTH_FX - 0.6);
    beamGlow.setBlendMode(Phaser.BlendModes.ADD);

    this.scene.tweens.add({
      targets:  beamGlow,
      scaleX:   0.05,
      alpha:    0,
      y:        y - 140,
      duration: 420,
      ease:     'Quad.easeOut',
      onComplete: () => beamGlow.destroy(),
    });
  }

  // ─── Partikel-Burst ─────────────────────────────────────────────────────────

  private playParticleBurst(x: number, y: number, colorHex: number): void {
    const brightened = brightenColor(colorHex, 80);

    const emitter = this.scene.add.particles(x, y, TEX_SPAWN_SPARK, {
      quantity:  28,
      lifespan:  { min: 350, max: 650 },
      speedX:    { min: -180, max: 180 },
      speedY:    { min: -180, max: 180 },
      scale:     { start: 0.9, end: 0 },
      alpha:     { start: 1, end: 0 },
      tint:      [colorHex, brightened, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
      gravityY:  60,
    });
    emitter.setDepth(DEPTH_FX + 0.5);
    emitter.explode(28);

    this.scene.time.delayedCall(800, () => emitter.destroy());
  }

  // ─── Nachhall-Wellring (langsam) ────────────────────────────────────────────

  private playSecondaryRipple(x: number, y: number, colorHex: number): void {
    this.spawnRing(x, y, colorHex, 180, 680, 1.5, 72);
  }
}

// ─── Hilfsfunktion ──────────────────────────────────────────────────────────

function brightenColor(color: number, amount: number): number {
  const r = Math.min(255, ((color >> 16) & 0xff) + amount);
  const g = Math.min(255, ((color >> 8)  & 0xff) + amount);
  const b = Math.min(255, (color & 0xff)          + amount);
  return (r << 16) | (g << 8) | b;
}
