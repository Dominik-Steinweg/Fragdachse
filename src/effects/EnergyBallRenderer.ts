import type * as Phaser from 'phaser';
import { COLORS, DEPTH, isPointInsideArena } from '../config';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import type { EnergyBallVariant } from '../types';
import { registerGraphicsObject } from './EffectUtils';
import { getEmissiveScale } from './EmissiveScale';
import { createEnergyBallGpuLayer, type EnergyBallGpuLayer } from './energyBall/EnergyBallGpuLayer';
import {
  EnergyBallGpuStore,
  ENERGY_BALL_KIND_BALL,
  ENERGY_BALL_KIND_IMPACT,
  type EnergyBallInstance,
} from './energyBall/EnergyBallGpuStore';

/** Shader time wraps far apart; the animation only jumps once per wrap. */
const SHADER_TIME_WRAP_MS = 600_000;
/** Longest impact component (spark lifetime), with the former cleanup margin. */
const IMPACT_LIFETIME_MS = 420;
/** Former canvas texture radii: glow 56 px, shell ring/arc outer edge ~13 px, core 20 px, spark 8 px. */
const GLOW_TEXTURE_RADIUS = 28;
const SHELL_OUTER_RADIUS = 13;
const SPARK_TEXTURE_RADIUS = 4;
/**
 * Particle radii of the former streams. Their emitters were configured with scale 0.55 / 0.85
 * on 20 px / 8 px textures; the later size-dependent setParticleScale() calls only clamped
 * into that eased range and never took effect, so every ball used these sizes.
 */
const CORE_PARTICLE_RADIUS = 5.5;
const SHELL_PARTICLE_RADIUS = 3.4;

interface EnergyBallVisual {
  instance: EnergyBallInstance;
  size: number;
  color: number;
  variant: EnergyBallVariant;
}

interface EnergyBallVisualPreset {
  coreTintMix: number;
  shellTintMix: number;
  glowTintMix: number;
  spreadFactor: number;
  minSpread: number;
  coreZoneFactor: number;
  shellZoneFactor: number;
  glowScaleFactor: number;
  minGlowScale: number;
  shellScaleFactor: number;
  minShellScale: number;
  glowPulseAmplitude: number;
  shellPulseAmplitude: number;
}

const DEFAULT_VARIANT: EnergyBallVariant = 'default';

const ENERGY_BALL_PRESETS: Record<EnergyBallVariant, EnergyBallVisualPreset> = {
  default: {
    coreTintMix: 0.55,
    shellTintMix: 0.45,
    glowTintMix: 0.4,
    spreadFactor: 0.44,
    minSpread: 5,
    coreZoneFactor: 0.38,
    shellZoneFactor: 0.95,
    glowScaleFactor: 2.2 / 18,
    minGlowScale: 0.9,
    shellScaleFactor: 1.35 / 18,
    minShellScale: 0.85,
    glowPulseAmplitude: 0,
    shellPulseAmplitude: 0,
  },
  plasma: {
    coreTintMix: 0.12,
    shellTintMix: 0.1,
    glowTintMix: 0.06,
    spreadFactor: 0.5,
    minSpread: 3.2,
    coreZoneFactor: 0.32,
    shellZoneFactor: 0.88,
    glowScaleFactor: 5 / 18,
    minGlowScale: 0.72,
    shellScaleFactor: 1.08 / 18,
    minShellScale: 0.62,
    glowPulseAmplitude: 0.16,
    shellPulseAmplitude: 0.1,
  },
};

/**
 * Energiebälle (ASMD-Sekundär, Plasma, Gravitationsturm, Energie-Injektor) und ihre Einschläge.
 *
 * Alle Bälle und Einschläge teilen sich einen instanzierten GPU-Layer (ein Draw Call). Glow,
 * Plasmakern, rotierende Hülle, die nachziehenden Kern- und Hüllenfunken sowie der
 * Einschlagsburst entstehen im Shader aus Zeit, Seed und Geschwindigkeit; die CPU schreibt pro
 * Frame nur Lage und Richtung jedes Balls und einen Einschlag genau einmal.
 */
export class EnergyBallRenderer {
  private readonly store = new EnergyBallGpuStore();
  private readonly visuals = new Map<number, EnergyBallVisual>();
  private layer: EnergyBallGpuLayer | null = null;
  /** Impact handles live in the store's id space below every projectile id. */
  private nextImpactId = -1;

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    this.ensureLayer();
  }

  createVisual(id: number, x: number, y: number, size: number, color: number, variant: EnergyBallVariant = DEFAULT_VARIANT): void {
    if (this.visuals.has(id)) return;
    const instance: EnergyBallInstance = {
      x, y, extent: 0,
      glowRadius: 0, shellScale: 0, seed: seedFor(id), kind: ENERGY_BALL_KIND_BALL, variant: 0,
      bornS: this.shaderTimeS(), motion: 0, coreZone: 0, shellZone: 0,
      coreParticleRadius: 0, shellParticleRadius: 0, glowColor: 0, shellColor: 0, coreColor: 0,
    };
    this.visuals.set(id, { instance, size: NaN, color: NaN, variant });
    this.updateVisual(id, x, y, size, 0, 0, color, variant);
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number, color: number, variant: EnergyBallVariant = DEFAULT_VARIANT): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    const instance = visual.instance;

    if (visual.size !== size || visual.variant !== variant) {
      this.applyShape(instance, size, variant);
    }
    if (visual.color !== color || visual.variant !== variant) {
      this.applyPalette(instance, color, variant);
    }
    visual.size = size; visual.color = color; visual.variant = variant;

    // Like the former emitter-local particles the ball has no trail of its own; the shared
    // flight signature draws the path, so the velocity is not needed here.
    void vx;
    void vy;
    instance.x = x; instance.y = y;

    this.ensureLayer();
    this.store.write(id, instance);
  }

  destroyVisual(id: number): void {
    if (!this.visuals.delete(id)) return;
    this.store.remove(id);
  }

  has(id: number): boolean {
    return this.visuals.has(id);
  }

  getActiveIds(): number[] {
    return [...this.visuals.keys()];
  }

  destroyAll(): void {
    this.visuals.clear();
    this.store.clear();
    this.layer?.image.destroy();
    this.layer = null;
  }

  playImpact(x: number, y: number, color: number, variant: EnergyBallVariant = DEFAULT_VARIANT, scale = 1): void {
    if (!isPointInsideArena(x, y)) return;
    const preset = this.getPreset(variant);
    const plasma = variant === 'plasma';
    const glowRadius = GLOW_TEXTURE_RADIUS * (preset.minGlowScale + scale * 0.7) * (plasma ? 1.15 : 1.35);
    const shellScale = (preset.minShellScale + scale * 0.5) * 0.95;
    const sparkRadius = SPARK_TEXTURE_RADIUS * (plasma ? 0.65 : 0.9);
    const extent = Math.max(glowRadius * 1.6, SHELL_OUTER_RADIUS * shellScale * 1.9 + 2,
      180 * scale * 0.34 + sparkRadius + 3);
    const now = this.scene.time.now;
    const id = this.nextImpactId--;
    const instance: EnergyBallInstance = {
      x, y, extent,
      glowRadius, shellScale, seed: seedFor(id), kind: ENERGY_BALL_KIND_IMPACT, variant: plasma ? 1 : 0,
      bornS: this.shaderTimeS(), motion: scale, coreZone: 0, shellZone: 0,
      coreParticleRadius: 0, shellParticleRadius: sparkRadius,
      glowColor: this.getGlowTint(color, variant, preset),
      shellColor: this.getShellTint(color, variant, preset),
      coreColor: color,
    };
    this.ensureLayer();
    this.store.expire(now);
    this.store.write(id, instance, now + IMPACT_LIFETIME_MS);
  }

  private applyShape(instance: EnergyBallInstance, size: number, variant: EnergyBallVariant): void {
    const preset = this.getPreset(variant);
    const spread = Math.max(size * preset.spreadFactor, preset.minSpread);
    instance.variant = variant === 'plasma' ? 1 : 0;
    instance.glowRadius = GLOW_TEXTURE_RADIUS * Math.max(size * preset.glowScaleFactor, preset.minGlowScale);
    instance.shellScale = Math.max(size * preset.shellScaleFactor, preset.minShellScale);
    instance.coreZone = spread * preset.coreZoneFactor;
    instance.shellZone = spread * preset.shellZoneFactor;
    instance.coreParticleRadius = CORE_PARTICLE_RADIUS;
    instance.shellParticleRadius = SHELL_PARTICLE_RADIUS;
    // Drift reach of the streams: core +-14 px/s for 220 ms, shell +-26 px/s for 320 ms.
    instance.extent = Math.max(
      instance.glowRadius * (1 + preset.glowPulseAmplitude),
      SHELL_OUTER_RADIUS * instance.shellScale * (1 + preset.shellPulseAmplitude) + 2,
      instance.coreZone + 14 * 0.22 + instance.coreParticleRadius,
      instance.shellZone + 26 * 0.32 + instance.shellParticleRadius,
    ) + 1;
  }

  private applyPalette(instance: EnergyBallInstance, color: number, variant: EnergyBallVariant): void {
    const preset = this.getPreset(variant);
    instance.glowColor = this.getGlowTint(color, variant, preset);
    instance.shellColor = this.getShellTint(color, variant, preset);
    instance.coreColor = color;
  }

  private ensureLayer(): EnergyBallGpuLayer | null {
    if (this.layer) return this.layer;
    this.layer = createEnergyBallGpuLayer(this.scene, this.store, DEPTH.PROJECTILES + 0.5, {
      beforeRender: () => this.store.expire(this.scene.time.now),
      time: () => this.shaderTimeS(),
      wrap: () => SHADER_TIME_WRAP_MS / 1000,
      emission: getEmissiveScale,
      detail: () => getGraphicsQualityProfile(this.scene).level === 'low' ? 0 : 1,
    });
    if (this.layer) registerGraphicsObject(this.scene, 'energyBallEffects', this.layer.image);
    return this.layer;
  }

  private shaderTimeS(): number {
    return (this.scene.time.now % SHADER_TIME_WRAP_MS) / 1000;
  }

  private getPreset(variant: EnergyBallVariant | undefined): EnergyBallVisualPreset {
    return ENERGY_BALL_PRESETS[variant ?? DEFAULT_VARIANT] ?? ENERGY_BALL_PRESETS.default;
  }

  private getGlowTint(color: number, variant: EnergyBallVariant, preset: EnergyBallVisualPreset): number {
    if (variant === 'plasma') {
      return mixColor(color, 0xffffff, preset.glowTintMix);
    }

    return mixColor(color, COLORS.BLUE_2, preset.glowTintMix);
  }

  private getShellTint(color: number, variant: EnergyBallVariant, preset: EnergyBallVisualPreset): number {
    if (variant === 'plasma') {
      return mixColor(color, 0xffffff, preset.shellTintMix);
    }

    return mixColor(color, COLORS.BLUE_1, preset.coreTintMix);
  }
}

/** Seeded by projectile id: host and clients see the same animation. */
function seedFor(id: number): number {
  return ((Math.imul(id + 1, 0x9e3779b9) >>> 0) / 0x100000000) * 997;
}

function mixColor(source: number, target: number, t: number): number {
  const channel = (shift: number) => {
    const a = (source >> shift) & 0xff;
    return Math.round(a + (((target >> shift) & 0xff) - a) * t);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
