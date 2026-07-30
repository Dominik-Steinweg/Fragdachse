import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { SyncedTurretCharge } from '../types';
import { circleZone, ensureCanvasTexture, fillRadialGradientTexture, mixColors } from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';
import type { LightingSystem } from './LightingSystem';

const TEX_CHARGE_HALO = '__turret_charge_halo';
const TEX_CHARGE_RING = '__turret_charge_ring';
const TEX_CHARGE_SPARK = '__turret_charge_spark';

/** Quellgroesse des Rings; die Darstellung skaliert daraus auf die Wirkbreite am Turm. */
const RING_TEXTURE_SIZE = 96;
/** Sichtbarer Radius der Ladung am Turm – etwas ueber eine Zelle, damit der Turm umrandet wird. */
const VISUAL_RADIUS = 26;

const FADE_IN_MS = 140;
const FADE_OUT_MS = 320;

interface TurretChargeVisual {
  halo: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Image;
  sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  snapshot: SyncedTurretCharge;
  seed: number;
}

/**
 * TurretChargeRenderer – blaues Energieaufleuchten eines aufgeladenen Turms.
 *
 * Round-Lifetime-Renderer nach dem Muster von `OverchargeFieldRenderer`: `syncVisuals()`
 * bekommt den replizierten Bestand und leitet Erzeugung und Verwurf daraus ab.
 *
 * Bewusst ueber den Spielern (`DEPTH.PROJECTILES`), anders als das bodennahe
 * Ueberladungsfeld: Die Ladung ist kein Flaechen-Telegraph, sondern der Zustand eines
 * einzelnen Turms und muss auch im Getuemmel an ihm ablesbar bleiben. Die Intensitaet
 * waechst mit den Ladungsstufen, damit ein voll aufgeladener Turm sofort auffaellt.
 */
export class TurretChargeRenderer {
  private readonly visuals = new Map<string, TurretChargeVisual>();
  private lighting: LightingSystem | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  generateTextures(): void {
    // Weiches Grundleuchten unter dem Turmkopf; die Farbe kommt per Tint.
    fillRadialGradientTexture(this.scene.textures, TEX_CHARGE_HALO, 96, [
      [0, 'rgba(255,255,255,0.62)'],
      [0.4, 'rgba(255,255,255,0.26)'],
      [1, 'rgba(255,255,255,0.0)'],
    ]);

    // Energieband mit Aussparungen: rotiert langsam und liest sich als technische Ladung.
    ensureCanvasTexture(this.scene.textures, TEX_CHARGE_RING, RING_TEXTURE_SIZE, RING_TEXTURE_SIZE, (ctx) => {
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

    fillRadialGradientTexture(this.scene.textures, TEX_CHARGE_SPARK, 10, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.45, 'rgba(255,255,255,0.5)'],
      [1, 'rgba(255,255,255,0.0)'],
    ]);
  }

  syncVisuals(charges: readonly SyncedTurretCharge[], now: number): void {
    const activeIds = new Set(charges.map((charge) => charge.turretId));
    for (const [turretId] of this.visuals) {
      if (!activeIds.has(turretId)) this.destroyVisual(turretId);
    }

    for (const charge of charges) {
      let visual = this.visuals.get(charge.turretId);
      if (!visual) {
        visual = this.createVisual(charge);
        this.visuals.set(charge.turretId, visual);
      }
      visual.snapshot = charge;
      this.updateVisual(visual, now);
    }
  }

  destroyAll(): void {
    for (const [turretId] of this.visuals) {
      this.destroyVisual(turretId);
    }
  }

  private createVisual(charge: SyncedTurretCharge): TurretChargeVisual {
    const halo = this.scene.add.image(charge.x, charge.y, TEX_CHARGE_HALO)
      .setDepth(DEPTH.PROJECTILES - 0.2)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0)
      .setTint(charge.color);
    const ring = this.scene.add.image(charge.x, charge.y, TEX_CHARGE_RING)
      .setDepth(DEPTH.PROJECTILES - 0.1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0)
      .setTint(mixColors(charge.color, 0xffffff, 0.5));

    // Nach innen laufende Funken lesen sich als einstroemende Energie.
    const sparks = this.scene.add.particles(charge.x, charge.y, TEX_CHARGE_SPARK, {
      lifespan: { min: 220, max: 420 },
      speed: { min: -34, max: -12 },
      scale: { start: 0.32, end: 0 },
      alpha: { start: emissiveAlpha(0.7), end: 0 },
      quantity: 1,
      frequency: 70,
      blendMode: Phaser.BlendModes.ADD,
      tint: mixColors(charge.color, 0xffffff, 0.4),
      emitZone: circleZone(VISUAL_RADIUS),
    }).setDepth(DEPTH.PROJECTILES - 0.15);

    return { halo, ring, sparks, snapshot: charge, seed: hashSeed(charge.turretId) };
  }

  private updateVisual(visual: TurretChargeVisual, now: number): void {
    const charge = visual.snapshot;
    const elapsed = now - charge.startedAt;
    const remaining = charge.expiresAt - now;
    const envelope = Phaser.Math.Clamp(elapsed / FADE_IN_MS, 0, 1)
      * Phaser.Math.Clamp(remaining / FADE_OUT_MS, 0, 1);
    // Die Ladungsstufen sind der eigentliche Informationsträger; sie heben Helligkeit und
    // Pulsfrequenz spürbar an, ohne die Grundform zu ändern.
    const intensity = Phaser.Math.Clamp(0.45 + charge.stacks * 0.09, 0.45, 1);
    const time = now * 0.001;
    const pulse = 0.5 + 0.5 * Math.sin(time * (4 + charge.stacks * 0.5) + visual.seed);

    const haloScale = (VISUAL_RADIUS * 2 * (0.92 + pulse * 0.12)) / 96;
    visual.halo
      .setPosition(charge.x, charge.y)
      .setScale(haloScale)
      .setAlpha(emissiveAlpha(envelope * intensity * (0.55 + pulse * 0.3)));
    visual.ring
      .setPosition(charge.x, charge.y)
      .setScale((VISUAL_RADIUS * 2) / RING_TEXTURE_SIZE)
      .setRotation(time * 1.6 + visual.seed)
      .setAlpha(emissiveAlpha(envelope * intensity * (0.7 + pulse * 0.25)));
    visual.sparks.setPosition(charge.x, charge.y).setAlpha(envelope * intensity);

    this.lighting?.setLight(lightKey(charge.turretId), 'electricField', charge.x, charge.y, {
      radiusPx: VISUAL_RADIUS * 3,
      color: mixColors(charge.color, 0xffffff, 0.45),
      intensity: 0.6 * envelope * intensity,
    });
  }

  private destroyVisual(turretId: string): void {
    this.lighting?.releaseLight(lightKey(turretId));
    const visual = this.visuals.get(turretId);
    if (!visual) return;
    visual.halo.destroy();
    visual.ring.destroy();
    visual.sparks.stop();
    visual.sparks.destroy();
    this.visuals.delete(turretId);
  }
}

function lightKey(turretId: string): string {
  return `turretcharge:${turretId}`;
}

/** Stabiler Phasenversatz je Turm, damit benachbarte Ladungen nicht im Gleichtakt pulsen. */
function hashSeed(turretId: string): number {
  let hash = 0;
  for (let index = 0; index < turretId.length; index += 1) {
    hash = (hash * 31 + turretId.charCodeAt(index)) % 1000;
  }
  return (hash / 1000) * Math.PI * 2;
}
