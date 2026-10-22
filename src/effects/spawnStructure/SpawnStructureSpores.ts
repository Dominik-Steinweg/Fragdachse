import * as Phaser from 'phaser';
import { DEPTH_LIGHTING, VOID_PALETTE } from '../../config';
import { fillRadialGradientTexture } from '../EffectUtils';

const TEXTURE = '__spawn_structure_spore';
/** Spores alive at once over every nest. */
const POOL = 72;
/** Spores per second from a breathing nest and from one whose release is charging. */
const REST_RATE = 0.8;
const CHARGE_RATE = 8;
/** They rise around the nest centre, px. */
const SPREAD_PX = 46;
/** A long gap (tab in the background) never releases a burst of spores at once. */
const MAX_STEP_MS = 100;

interface Spore {
  readonly image: Phaser.GameObjects.Image;
  bornAt: number;
  lifeMs: number;
  x: number;
  y: number;
  driftX: number;
  driftY: number;
  size: number;
  sway: number;
  peak: number;
}

/**
 * Void spores of the brood (GDD Spawnbauwerk V1): a few faint violet motes drift up out of the nest
 * and fade, many more while a release charges. Sparse and undirected, never a stream like a portal's.
 * Owned by SpawnStructureRenderer; a fixed image pool above the light map, no timers or tweens.
 */
export class SpawnStructureSpores {
  private readonly spores: Spore[] = [];
  private readonly owed = new Map<string, number>();
  private seed = 0x5eed;
  private stepMs = 0;
  private lastMs = Number.NaN;

  constructor(scene: Phaser.Scene) {
    fillRadialGradientTexture(scene.textures, TEXTURE, 16, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.55)'],
      [1, 'rgba(255,255,255,0)']]);
    for (let i = 0; i < POOL; i++) {
      const image = scene.add.image(0, 0, TEXTURE).setDepth(DEPTH_LIGHTING + 0.09).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      this.spores.push({ image, bornAt: -1, lifeMs: 0, x: 0, y: 0, driftX: 0, driftY: 0, size: 0, sway: 0, peak: 0 });
    }
  }

  /** Starts a frame at `nowMs`; emit() then releases this frame's share of spores. */
  begin(nowMs: number): void {
    this.stepMs = Number.isFinite(this.lastMs) ? Math.max(0, Math.min(MAX_STEP_MS, nowMs - this.lastMs)) : 0;
    this.lastMs = nowMs;
  }

  /** Releases this frame's spores of one living nest at (x, y); `charge` 0..1 is the announced release. */
  emit(id: string, x: number, y: number, charge: number, nowMs: number): void {
    const c = Math.max(0, Math.min(1, charge));
    let owed = (this.owed.get(id) ?? 0) + (REST_RATE + (CHARGE_RATE - REST_RATE) * c) * this.stepMs / 1000;
    while (owed >= 1) {
      owed -= 1;
      this.spawn(x, y, c, nowMs);
    }
    this.owed.set(id, owed);
  }

  /** Moves every living spore; `brightness` 0..1 is the day/night share of their glow. */
  update(nowMs: number, brightness: number): void {
    for (const spore of this.spores) {
      if (spore.bornAt < 0) continue;
      const t = (nowMs - spore.bornAt) / spore.lifeMs;
      if (t >= 1 || t < 0) {
        spore.bornAt = -1;
        spore.image.setVisible(false);
        continue;
      }
      const rise = 1 - (1 - t) * (1 - t);
      const scale = 0.7 + 0.55 * t;
      spore.image.setVisible(true)
        .setPosition(spore.x + spore.driftX * rise + Math.sin(spore.sway + t * 5) * 2.5, spore.y + spore.driftY * rise)
        .setDisplaySize(spore.size * scale, spore.size * scale)
        .setAlpha(spore.peak * brightness * Math.sin(Math.PI * t));
    }
  }

  clear(): void {
    this.owed.clear();
    for (const spore of this.spores) {
      spore.bornAt = -1;
      spore.image.setVisible(false);
    }
  }

  destroy(): void {
    for (const spore of this.spores) spore.image.destroy();
    this.spores.length = 0;
    this.owed.clear();
  }

  private spawn(x: number, y: number, charge: number, nowMs: number): void {
    const spore = this.spores.find((candidate) => candidate.bornAt < 0);
    if (!spore) return;
    const angle = this.random() * Math.PI * 2, distance = SPREAD_PX * Math.sqrt(this.random());
    spore.bornAt = nowMs;
    spore.lifeMs = 2600 + 1600 * this.random();
    spore.x = x + Math.cos(angle) * distance;
    spore.y = y + Math.sin(angle) * distance;
    // Rising toward the camera reads as a slow drift up the screen with the wind.
    spore.driftX = 4 + (this.random() - 0.5) * 10;
    spore.driftY = -(10 + 14 * this.random());
    spore.size = (3 + 3.5 * this.random()) * (1 + 0.5 * charge);
    spore.sway = this.random() * Math.PI * 2;
    spore.peak = Math.min(1, 0.45 + 0.35 * this.random() + 0.25 * charge);
    spore.image.setTint(this.random() < 0.7 ? VOID_PALETTE.primary : VOID_PALETTE.bright).setVisible(false);
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
}
