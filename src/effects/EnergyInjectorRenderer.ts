import * as Phaser from 'phaser';
// Canonical implementation filename: EnergyInjectorRenderer.
import { DEPTH } from '../config';
import type { SyncedEnergyInjectorEffect } from '../types';
import { circleZone, ensureCanvasTexture, fillRadialGradientTexture, mixColors, registerParticleEmitter } from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';
import type { LightingSystem } from './LightingSystem';

const TEX_ENERGY_INJECTOR_HALO = '__energy_injector_halo';
const TEX_ENERGY_INJECTOR_RING = '__energy_injector_ring';
const TEX_ENERGY_INJECTOR_SPARK = '__energy_injector_spark';

/** Quellgroesse des Rings; die Darstellung skaliert daraus auf die Wirkbreite am Turm. */
const RING_TEXTURE_SIZE = 96;
/** Sichtbarer Radius der Ladung am Turm – etwas ueber eine Zelle, damit der Turm umrandet wird. */
const VISUAL_RADIUS = 26;

const FADE_IN_MS = 140;
const FADE_OUT_MS = 320;

interface EnergyInjectorVisual {
  halo: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Image;
  sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  snapshot: SyncedEnergyInjectorEffect;
  seed: number;
}

/**
 * EnergyInjectorRenderer – blaues Energieaufleuchten eines fokussierten Konstrukts.
 *
 * Round-Lifetime-Renderer: `syncVisuals()`
 * bekommt den replizierten Bestand und leitet Erzeugung und Verwurf daraus ab.
 *
 * Bewusst ueber den Spielern (`DEPTH.PROJECTILES`), anders als das bodennahe
 * Die Markierung ist kein Flaechen-Telegraph, sondern der Zustand eines einzelnen Ziels und
 * muss auch im Getuemmel an ihm ablesbar bleiben.
 */
export class EnergyInjectorRenderer {
  private readonly visuals = new Map<string, EnergyInjectorVisual>();
  private lighting: LightingSystem | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  generateTextures(): void {
    // Weiches Grundleuchten unter dem Turmkopf; die Farbe kommt per Tint.
    fillRadialGradientTexture(this.scene.textures, TEX_ENERGY_INJECTOR_HALO, 96, [
      [0, 'rgba(255,255,255,0.62)'],
      [0.4, 'rgba(255,255,255,0.26)'],
      [1, 'rgba(255,255,255,0.0)'],
    ]);

    // Energieband mit Aussparungen: rotiert langsam und liest sich als technische Ladung.
    ensureCanvasTexture(this.scene.textures, TEX_ENERGY_INJECTOR_RING, RING_TEXTURE_SIZE, RING_TEXTURE_SIZE, (ctx) => {
      ctx.clearRect(0, 0, RING_TEXTURE_SIZE, RING_TEXTURE_SIZE);
      const center = RING_TEXTURE_SIZE / 2;
      const radius = center - 8;

      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 3.2;
      const arcCount = 3;
      for (let index = 0; index < arcCount; index += 1) {
        const from = (Math.PI * 2 * index) / arcCount;
        ctx.beginPath();
        ctx.arc(center, center, radius, from, from + (Math.PI * 2) / arcCount * 0.52);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(center, center, radius - 7, 0, Math.PI * 2);
      ctx.stroke();
    });

    fillRadialGradientTexture(this.scene.textures, TEX_ENERGY_INJECTOR_SPARK, 10, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.45, 'rgba(255,255,255,0.5)'],
      [1, 'rgba(255,255,255,0.0)'],
    ]);
  }

  syncVisuals(effects: readonly SyncedEnergyInjectorEffect[], now: number): void {
    const activeIds = new Set(effects.map((effect) => effect.targetId));
    for (const [targetId] of this.visuals) {
      if (!activeIds.has(targetId)) this.destroyVisual(targetId);
    }

    for (const effect of effects) {
      let visual = this.visuals.get(effect.targetId);
      if (!visual) {
        visual = this.createVisual(effect);
        this.visuals.set(effect.targetId, visual);
      }
      visual.snapshot = effect;
      this.updateVisual(visual, now);
    }
  }

  destroyAll(): void {
    for (const [targetId] of this.visuals) {
      this.destroyVisual(targetId);
    }
  }

  private createVisual(effect: SyncedEnergyInjectorEffect): EnergyInjectorVisual {
    const halo = this.scene.add.image(effect.x, effect.y, TEX_ENERGY_INJECTOR_HALO)
      .setDepth(DEPTH.PROJECTILES - 0.2)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0)
      .setTint(effect.color);
    const ring = this.scene.add.image(effect.x, effect.y, TEX_ENERGY_INJECTOR_RING)
      .setDepth(DEPTH.PROJECTILES - 0.1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0)
      .setTint(mixColors(effect.color, 0xffffff, 0.5));

    // Nach innen laufende Funken lesen sich als einstroemende Energie.
    const sparks = this.scene.add.particles(effect.x, effect.y, TEX_ENERGY_INJECTOR_SPARK, {
      lifespan: { min: 220, max: 420 },
      speed: { min: -34, max: -12 },
      scale: { start: 0.32, end: 0 },
      alpha: { start: emissiveAlpha(0.7), end: 0 },
      quantity: 1,
      frequency: 70,
      blendMode: Phaser.BlendModes.ADD,
      tint: mixColors(effect.color, 0xffffff, 0.4),
      emitZone: circleZone(VISUAL_RADIUS),
    }).setDepth(DEPTH.PROJECTILES - 0.15);
    registerParticleEmitter(this.scene, 'energyInjector', sparks);

    return { halo, ring, sparks, snapshot: effect, seed: hashSeed(effect.targetId) };
  }

  private updateVisual(visual: EnergyInjectorVisual, now: number): void {
    const effect = visual.snapshot;
    const elapsed = now - effect.startedAt;
    const remaining = effect.expiresAt - now;
    const envelope = Phaser.Math.Clamp(elapsed / FADE_IN_MS, 0, 1)
      * Phaser.Math.Clamp(remaining / FADE_OUT_MS, 0, 1);
    // Die Ladungsstufen sind der eigentliche Informationsträger; sie heben Helligkeit und
    // Pulsfrequenz spürbar an, ohne die Grundform zu ändern.
    const intensity = effect.effect.type === 'damage_turret' ? 0.9 : 0.78;
    const time = now * 0.001;
    const pulse = 0.5 + 0.5 * Math.sin(time * 4.2 + visual.seed);

    const haloScale = (VISUAL_RADIUS * 2 * (0.92 + pulse * 0.12)) / 96;
    visual.halo
      .setPosition(effect.x, effect.y)
      .setScale(haloScale)
      .setAlpha(emissiveAlpha(envelope * intensity * (0.55 + pulse * 0.3)));
    visual.ring
      .setPosition(effect.x, effect.y)
      .setScale((VISUAL_RADIUS * 2) / RING_TEXTURE_SIZE)
      .setRotation(time * 1.6 + visual.seed)
      .setAlpha(emissiveAlpha(envelope * intensity * (0.7 + pulse * 0.25)));
    visual.sparks.setPosition(effect.x, effect.y).setAlpha(envelope * intensity);

    this.lighting?.setLight(lightKey(effect.targetId), 'electricField', effect.x, effect.y, {
      radiusPx: VISUAL_RADIUS * 3,
      color: mixColors(effect.color, 0xffffff, 0.45),
      intensity: 0.6 * envelope * intensity,
    });
  }

  private destroyVisual(targetId: string): void {
    this.lighting?.releaseLight(lightKey(targetId));
    const visual = this.visuals.get(targetId);
    if (!visual) return;
    visual.halo.destroy();
    visual.ring.destroy();
    visual.sparks.stop();
    visual.sparks.destroy();
    this.visuals.delete(targetId);
  }
}

function lightKey(targetId: string): string {
  return `energy-injector:${targetId}`;
}

/** Stabiler Phasenversatz je Turm, damit benachbarte Ladungen nicht im Gleichtakt pulsen. */
function hashSeed(turretId: string): number {
  let hash = 0;
  for (let index = 0; index < turretId.length; index += 1) {
    hash = (hash * 31 + turretId.charCodeAt(index)) % 1000;
  }
  return (hash / 1000) * Math.PI * 2;
}
