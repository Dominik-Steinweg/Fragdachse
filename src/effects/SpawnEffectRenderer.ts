import * as Phaser from 'phaser';
import { DEPTH_FX } from '../config';
import { ensureCanvasTexture, fillRadialGradientTexture, makeAdditive, mixColors, recordGraphicsWork, recordParticleSpawn, registerGraphicsObject, registerParticleEmitter } from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';
import type { LightingSystem } from './LightingSystem';

const TEX_SPAWN_SPARK = '_spawn_spark';
const TEX_SPAWN_GLOW  = '_spawn_glow';

/**
 * Dauer des Nachleuchtens am Spawnpunkt. Deutlich länger als der Blitz selbst: der Blitz sagt
 * "hier ist gerade etwas passiert", das Nachleuchten "hier steht jetzt jemand" – und gibt einem
 * hinsehenden Spieler die Zeit, die Stelle überhaupt zu finden.
 */
const AFTERGLOW_DURATION_MS = 1800;

export class SpawnEffectRenderer {
  private texturesReady = false;
  private lighting: LightingSystem | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

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

    this.lighting?.pulse('teleportFlash', x, y, {
      color: mixColors(colorHex, 0xffffff, 0.6),
    });

    this.playCoreBurst(x, y, colorHex);
    this.playRings(x, y, colorHex);
    this.playBeam(x, y, colorHex);
    this.playParticleBurst(x, y, colorHex);
    this.playSecondaryRipple(x, y, colorHex);
    this.playAfterglow(x, y, colorHex, 1);
  }

  /**
   * Gegner-Variante des Spawns. Bewusst zurückhaltender als der Spielerspawn: kein Lichtstrahl,
   * ein einzelner Ring, weniger Funken. Bei bis zu einem Gegner pro Sekunde muss der Effekt die
   * Stelle markieren, ohne das Gefecht zu überstrahlen – der Spielerspawn bleibt das lautere
   * Ereignis, weil er selten ist und die eigene Aufmerksamkeit verdient.
   */
  playEnemy(x: number, y: number, colorHex: number): void {
    this.ensureTextures();

    this.lighting?.pulse('teleportFlash', x, y, {
      color: mixColors(colorHex, 0xffffff, 0.35),
      radiusPx: 105,
      intensity: 0.5,
    });

    this.playEnemyCoreBurst(x, y, colorHex);
    this.spawnRing(x, y, colorHex, 0, 300, 3, 26);
    this.spawnRing(x, y, colorHex, 90, 420, 1.5, 40);
    this.playEnemyParticleBurst(x, y, colorHex);
    this.playAfterglow(x, y, colorHex, 0.62);
  }

  // ─── Nachleuchten am Spawnpunkt ─────────────────────────────────────────────

  /**
   * Weicher Schein, der nach dem Blitz eine knappe Sekunde am Spawnpunkt stehen bleibt.
   * `scale` skaliert Größe und Deckkraft gemeinsam, damit Gegner denselben Effekt eine Nummer
   * kleiner bekommen, ohne dafür eigene Werte zu pflegen.
   */
  private playAfterglow(x: number, y: number, colorHex: number, scale: number): void {
    const glow = this.scene.add.image(x, y, TEX_SPAWN_GLOW);
    glow.setDisplaySize(196 * scale, 196 * scale);
    glow.setDepth(DEPTH_FX - 0.7);
    makeAdditive(glow);
    glow.setTint(colorHex);
    glow.setAlpha(0);

    // Kurz aufblenden, dann über den Rest der Sekunde auslaufen: ein sofort startendes
    // Abklingen würde im Blitz untergehen und wäre erst sichtbar, wenn es fast weg ist.
    this.scene.tweens.add({
      targets:  glow,
      alpha:    emissiveAlpha(0.5 * scale),
      duration: 140,
      ease:     'Quad.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets:  glow,
          alpha:    0,
          scaleX:   glow.scaleX * 1.25,
          scaleY:   glow.scaleY * 1.25,
          duration: AFTERGLOW_DURATION_MS - 140,
          ease:     'Sine.easeIn',
          onComplete: () => glow.destroy(),
        });
      },
    });

    this.lighting?.pulse('spawnAfterglow', x, y, {
      color:      mixColors(colorHex, 0xffffff, 0.45),
      radiusPx:   250 * scale,
      intensity:  0.6 * scale,
      durationMs: AFTERGLOW_DURATION_MS,
    });
  }

  private playEnemyCoreBurst(x: number, y: number, colorHex: number): void {
    const core = this.scene.add.image(x, y, TEX_SPAWN_GLOW);
    core.setDisplaySize(18, 18);
    core.setDepth(DEPTH_FX + 1);
    makeAdditive(core);
    core.setTint(mixColors(colorHex, 0xffffff, 0.5));
    core.setAlpha(emissiveAlpha(0.9));

    this.scene.tweens.add({
      targets:  core,
      scaleX:   3.4,
      scaleY:   3.4,
      alpha:    0,
      duration: 300,
      ease:     'Expo.easeOut',
      onComplete: () => core.destroy(),
    });
  }

  private playEnemyParticleBurst(x: number, y: number, colorHex: number): void {
    const emitter = this.scene.add.particles(x, y, TEX_SPAWN_SPARK, {
      quantity:  12,
      lifespan:  { min: 260, max: 460 },
      speedX:    { min: -110, max: 110 },
      speedY:    { min: -110, max: 110 },
      scale:     { start: 0.6, end: 0 },
      alpha:     { start: 0.9, end: 0 },
      tint:      [colorHex, brightenColor(colorHex, 60)],
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
      gravityY:  40,
    });
    registerParticleEmitter(this.scene, 'spawnEffect', emitter);
    emitter.setDepth(DEPTH_FX + 0.5);
    emitter.explode(12);
    recordParticleSpawn(this.scene, 'spawnEffect', 12);

    this.scene.time.delayedCall(600, () => emitter.destroy());
  }

  // ─── Zentraler Licht-Burst ──────────────────────────────────────────────────

  private playCoreBurst(x: number, y: number, colorHex: number): void {
    // Weißer Kern
    const core = this.scene.add.image(x, y, TEX_SPAWN_GLOW);
    core.setDisplaySize(20, 20);
    core.setDepth(DEPTH_FX + 1.5);
    makeAdditive(core);
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
    halo.setAlpha(emissiveAlpha(0.85));

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
    registerGraphicsObject(this.scene, 'spawnRings', ring);
    recordGraphicsWork(this.scene, 'spawnRings', { createdObjects: 1 });
    ring.setDepth(DEPTH_FX);
    ring.isFilled     = false;
    ring.isStroked    = true;
    ring.strokeColor  = color;
    ring.lineWidth    = lineWidth;
    ring.strokeAlpha  = 0.9;
    makeAdditive(ring);

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
    makeAdditive(beam);

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
    makeAdditive(beamGlow);

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
    registerParticleEmitter(this.scene, 'spawnEffect', emitter);
    emitter.setDepth(DEPTH_FX + 0.5);
    emitter.explode(28);
    recordParticleSpawn(this.scene, 'spawnEffect', 28);

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
