import * as Phaser from 'phaser';
import { DEPTH_LIGHTING, VOID_PALETTE } from '../../config';
import { fillRadialGradientTexture } from '../EffectUtils';
import type { GroundGlowLightFrame, LightingSystem } from '../LightingSystem';

export type SpawnStructureSporeLighting = Pick<LightingSystem, 'setGroundGlowLights'>;

const CORE_TEXTURE = '__spawn_structure_spore';
const HALO_TEXTURE = '__spawn_structure_spore_halo';
/** Spores alive at once over every nest. */
const POOL = 192;
/** Spores per second from a breathing nest and from one whose release is charging. */
const REST_RATE = 4;
const CHARGE_RATE = 18;
/** They rise around the nest centre, px. */
const SPREAD_PX = 58;
/** The brightest spores also light their surroundings in the light map. */
const LIGHT_CAPACITY = 64;
/** A long gap (tab in the background) never releases a burst of spores at once. */
const MAX_STEP_MS = 100;

interface Spore {
  readonly core: Phaser.GameObjects.Image;
  readonly halo: Phaser.GameObjects.Image;
  nest: string;
  bornAt: number;
  lifeMs: number;
  x: number;
  y: number;
  driftX: number;
  driftY: number;
  size: number;
  sway: number;
  peak: number;
  /** Brightness of the current frame, for the light it casts. */
  shown: number;
}

interface SporeLight { x: number; y: number; radiusPx: number; intensity: number; color: number }

/**
 * Void spores of the brood (GDD Spawnbauwerk V1): glowing violet motes drift up out of the nest and
 * fade, a steady trickle at rest and a dense cloud while a release charges. Each pulses with its
 * nest's heartbeat and the brightest light their surroundings, so the nest light seems to carry
 * them. Sparse and undirected, never a stream like a portal's. Owned by SpawnStructureRenderer; a
 * fixed image pool above the light map, no timers or tweens.
 */
export class SpawnStructureSpores {
  private readonly spores: Spore[] = [];
  private readonly owed = new Map<string, number>();
  /** Heartbeat 0..1 of each nest this frame. */
  private readonly pulses = new Map<string, number>();
  private readonly lights: SporeLight[] = Array.from({ length: LIGHT_CAPACITY }, () => ({ x: 0, y: 0, radiusPx: 0, intensity: 0, color: 0 }));
  private readonly lightFrame: GroundGlowLightFrame & { lightCount: number } = { lights: this.lights, lightCount: 0 };
  private lighting: SpawnStructureSporeLighting | null = null;
  private published = false;
  private seed = 0x5eed;
  private stepMs = 0;
  private lastMs = Number.NaN;

  constructor(scene: Phaser.Scene) {
    fillRadialGradientTexture(scene.textures, CORE_TEXTURE, 16, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,.7)'],
      [1, 'rgba(255,255,255,0)']]);
    fillRadialGradientTexture(scene.textures, HALO_TEXTURE, 32, [[0, 'rgba(255,255,255,.6)'], [0.35, 'rgba(255,255,255,.22)'],
      [1, 'rgba(255,255,255,0)']]);
    for (let i = 0; i < POOL; i++) {
      // The halo sits under the core; both glow above the light map like the eyes.
      const halo = scene.add.image(0, 0, HALO_TEXTURE).setDepth(DEPTH_LIGHTING + 0.09).setBlendMode(Phaser.BlendModes.ADD)
        .setTint(VOID_PALETTE.primary).setVisible(false);
      const core = scene.add.image(0, 0, CORE_TEXTURE).setDepth(DEPTH_LIGHTING + 0.11).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      this.spores.push({ core, halo, nest: '', bornAt: -1, lifeMs: 0, x: 0, y: 0, driftX: 0, driftY: 0, size: 0, sway: 0, peak: 0, shown: 0 });
    }
  }

  setLighting(lighting: SpawnStructureSporeLighting | null): void {
    if (this.lighting !== lighting) this.releaseLights();
    this.lighting = lighting;
  }

  /** Starts a frame at `nowMs`; emit() then releases this frame's share of spores. */
  begin(nowMs: number): void {
    this.stepMs = Number.isFinite(this.lastMs) ? Math.max(0, Math.min(MAX_STEP_MS, nowMs - this.lastMs)) : 0;
    this.lastMs = nowMs;
  }

  /**
   * Releases this frame's spores of one living nest at (x, y); `charge` 0..1 is the announced release,
   * `pulse` 0..1 the nest's heartbeat, which every spore of the nest follows.
   */
  emit(id: string, x: number, y: number, charge: number, pulse: number, nowMs: number): void {
    const c = Math.max(0, Math.min(1, charge));
    this.pulses.set(id, pulse);
    let owed = (this.owed.get(id) ?? 0) + (REST_RATE + (CHARGE_RATE - REST_RATE) * c) * this.stepMs / 1000;
    while (owed >= 1) {
      owed -= 1;
      this.spawn(id, x, y, c, nowMs);
    }
    this.owed.set(id, owed);
  }

  /** Moves every living spore and publishes their light; `brightness` 0..1 is the day/night share of their glow. */
  update(nowMs: number, brightness: number): void {
    let lights = 0;
    for (const spore of this.spores) {
      if (spore.bornAt < 0) continue;
      const t = (nowMs - spore.bornAt) / spore.lifeMs;
      if (t >= 1 || t < 0) {
        spore.bornAt = -1;
        spore.core.setVisible(false);
        spore.halo.setVisible(false);
        continue;
      }
      const rise = 1 - (1 - t) * (1 - t);
      const scale = 0.75 + 0.5 * t;
      const x = spore.x + spore.driftX * rise + Math.sin(spore.sway + t * 5) * 3, y = spore.y + spore.driftY * rise;
      const beat = 0.75 + 0.5 * (this.pulses.get(spore.nest) ?? 0);
      spore.shown = spore.peak * brightness * beat * Math.sin(Math.PI * t) ** 0.7;
      spore.core.setVisible(true).setPosition(x, y).setDisplaySize(spore.size * scale, spore.size * scale).setAlpha(Math.min(1, spore.shown));
      const halo = spore.size * scale * 3.4;
      spore.halo.setVisible(true).setPosition(x, y).setDisplaySize(halo, halo).setAlpha(Math.min(1, spore.shown * 0.55));
      if (lights < LIGHT_CAPACITY && spore.shown > 0.25) {
        const light = this.lights[lights++];
        light.x = x; light.y = y; light.radiusPx = 20 + spore.size * 3; light.intensity = 0.32 * spore.shown; light.color = VOID_PALETTE.primary;
      }
    }
    this.lightFrame.lightCount = lights;
    if (lights > 0 && this.lighting) {
      // Decorative: the shared batch fills with spore light last, it never displaces gameplay lights.
      this.lighting.setGroundGlowLights(this, this.lightFrame, { decorative: true });
      this.published = true;
    } else this.releaseLights();
  }

  clear(): void {
    this.owed.clear();
    this.pulses.clear();
    for (const spore of this.spores) {
      spore.bornAt = -1;
      spore.core.setVisible(false);
      spore.halo.setVisible(false);
    }
    this.releaseLights();
  }

  destroy(): void {
    this.releaseLights();
    for (const spore of this.spores) {
      spore.core.destroy();
      spore.halo.destroy();
    }
    this.spores.length = 0;
    this.owed.clear();
    this.pulses.clear();
  }

  /** Withdraws the spores' light from the light map until the next update. */
  releaseLights(): void {
    if (this.published) this.lighting?.setGroundGlowLights(this, null);
    this.published = false;
    this.lightFrame.lightCount = 0;
  }

  private spawn(nest: string, x: number, y: number, charge: number, nowMs: number): void {
    const spore = this.spores.find((candidate) => candidate.bornAt < 0);
    if (!spore) return;
    const angle = this.random() * Math.PI * 2, distance = SPREAD_PX * Math.sqrt(this.random());
    spore.nest = nest;
    spore.bornAt = nowMs;
    spore.lifeMs = 3000 + 2000 * this.random();
    spore.x = x + Math.cos(angle) * distance;
    spore.y = y + Math.sin(angle) * distance;
    // Rising toward the camera reads as a slow drift up the screen with the wind.
    spore.driftX = 6 + (this.random() - 0.5) * 12;
    spore.driftY = -(12 + 16 * this.random());
    spore.size = (4 + 4 * this.random()) * (1 + 0.5 * charge);
    spore.sway = this.random() * Math.PI * 2;
    spore.peak = Math.min(1.2, 0.8 + 0.25 * this.random() + 0.25 * charge);
    spore.core.setTint(this.random() < 0.25 ? VOID_PALETTE.core : VOID_PALETTE.bright).setVisible(false);
    spore.halo.setVisible(false);
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
}
