import type * as Phaser from 'phaser';
import { CELL_SIZE, VOID_PALETTE } from '../../config';
import { KRAKEN_RISE_INTRO, type BossIntroState } from '../../config/bossIntros';
import { WaterSurfaceRenderer } from '../../arena/WaterSurfaceRenderer';
import type { KrakenPhase } from '../../systems/KrakenState';
import type { ArenaLayout } from '../../types';
import type { WorldMetrics } from '../../world/WorldMetrics';
import type { GroundGlowLightFrame, LightingSystem } from '../LightingSystem';

/** Authored timing of the abyss pond turning void during the kraken's rise (ms from intro start). */
export const KRAKEN_POND_VOID = {
  /** The bloom waits for the camera to settle on the pond, then spreads from the anchor to every shore. */
  spreadStartMs: 450,
  spreadEndMs: 2700,
  /** The roar at emergence floods the whole pond with light once. */
  pulseAtMs: KRAKEN_RISE_INTRO.emergeAtMs,
  pulseWidthMs: 380,
  /** Afterwards the pond breathes slowly for the rest of the fight. */
  breathPeriodMs: 3200,
  breathDepth: 0.08,
  /** After the kill the void recedes from the shores back to where the kraken died. */
  releaseMs: 4200,
  /** Pond-shaped glow: one ground light every few water cells, lit once the bloom has passed it. */
  glowStrideCells: 3,
  glowRadiusPx: 150,
  glowIntensity: 2,
  /** Share of the glow that stays once the pond has settled; the spreading front and the roar add the rest. */
  glowRest: 0.55,
  /** Glows on the bank keep this share, so the light stays in the water instead of haloing the shore. */
  glowShoreShare: 0.4,
  /** Water cells farther than this from the anchor belong to another body. */
  pondReachPx: 1600,
} as const;

export interface KrakenPondVoidState { readonly frontPx: number; readonly grade: number; readonly pulse: number }

const smooth = (from: number, to: number, value: number) => {
  const x = Math.max(0, Math.min(1, (value - from) / Math.max(1, to - from)));
  return x * x * (3 - 2 * x);
};

/** When the void starts to recede: the kill (dying) or, without one observed, the removal. */
export function krakenPondReleaseAt(phase: KrakenPhase | null): number | null {
  if (phase?.kind === 'dying') return phase.startedAt;
  if (phase?.kind === 'removed') return phase.removedAt;
  return null;
}

/** Pure in the replicated timestamps: identical on host, clients and late joiners. */
export function krakenPondVoidState(elapsedMs: number, reachPx: number, sinceReleaseMs: number | null): KrakenPondVoidState {
  const c = KRAKEN_POND_VOID;
  if (elapsedMs < c.spreadStartMs - 200) return { frontPx: 0, grade: 0, pulse: 0 };
  const spread = smooth(c.spreadStartMs, c.spreadEndMs, elapsedMs);
  let frontPx = spread * (reachPx + 160);
  let grade = smooth(c.spreadStartMs - 200, c.spreadStartMs + 350, elapsedMs);
  const roar = Math.exp(-(((elapsedMs - c.pulseAtMs) / c.pulseWidthMs) ** 2));
  const breath = elapsedMs > c.pulseAtMs
    ? c.breathDepth * (0.5 + 0.5 * Math.sin((elapsedMs - c.pulseAtMs) / c.breathPeriodMs * Math.PI * 2)) : 0;
  let pulse = Math.min(1, roar + breath);
  if (sinceReleaseMs !== null && sinceReleaseMs >= 0) {
    const release = smooth(0, c.releaseMs, sinceReleaseMs);
    frontPx = Math.min(frontPx, (1 - release) * (reachPx + 160));
    grade *= 1 - smooth(c.releaseMs * 0.6, c.releaseMs, sinceReleaseMs);
    pulse *= 1 - release;
  }
  return { frontPx, grade, pulse };
}

interface PondGlow {
  x: number; y: number; radiusPx: number; intensity: number; color: number; distance: number;
  /** Share of the eight neighbouring cells that are water: 1 in open water, lower along the bank. */
  interior: number;
}

/**
 * The abyss pond on the kraken map turns void with the intro and keeps glowing through the fight:
 * the water material is graded by the scene's WaterSurfaceRenderer, the glow comes from pond-shaped
 * ground lights in the light map, so the risen kraken is lit by its water rather than washed out.
 * No GPU targets or programs of its own; it only writes uniforms and borrowed light frames.
 */
export class KrakenPondVoid {
  private anchorKey = '';
  private reachPx = 0;
  private readonly glows: PondGlow[] = [];
  private readonly frame: GroundGlowLightFrame & { lightCount: number } = { lights: this.glows, lightCount: 0 };
  private phase: KrakenPhase | null = null;

  constructor(private readonly scene: Phaser.Scene, private readonly lighting: LightingSystem | null,
    private readonly world: () => { layout: ArenaLayout | null; metrics: WorldMetrics | null }) {}

  setKrakenPhase(phase: KrakenPhase | null): void { this.phase = phase; }

  sync(state: BossIntroState | null, now: number): void {
    if (state?.preset !== 'kraken-rise' || now < state.startedAtMs) { this.release(); return; }
    this.ensurePond(state);
    const releaseAt = krakenPondReleaseAt(this.phase);
    const bloom = krakenPondVoidState(now - state.startedAtMs, this.reachPx, releaseAt === null ? null : now - releaseAt);
    if (bloom.grade <= 0) { this.release(); return; }
    WaterSurfaceRenderer.for(this.scene)?.setVoidBloom({ x: state.x, y: state.y, ...bloom });
    const { glowIntensity, glowRest, glowShoreShare } = KRAKEN_POND_VOID;
    let lit = 0;
    for (const glow of this.glows) {
      const reached = 1 - smooth(bloom.frontPx - 140, bloom.frontPx, glow.distance);
      // Freshly reached water flares, then settles to the calm rest glow.
      const fresh = Math.exp(-(((bloom.frontPx - glow.distance) / 260) ** 2));
      glow.intensity = glowIntensity * bloom.grade * reached * Math.min(1, glowRest + 0.5 * fresh + 0.6 * bloom.pulse)
        * (glowShoreShare + (1 - glowShoreShare) * glow.interior);
      glow.color = bloom.pulse > 0.5 ? VOID_PALETTE.bright : VOID_PALETTE.primary;
      if (glow.intensity > 0.01) lit++;
    }
    this.frame.lightCount = lit > 0 ? this.glows.length : 0;
    this.lighting?.setGroundGlowLights(this, this.frame.lightCount > 0 ? this.frame : null);
  }

  clear(): void { this.release(); this.anchorKey = ''; this.glows.length = 0; this.reachPx = 0; }
  destroy(): void { this.clear(); }

  private release(): void {
    WaterSurfaceRenderer.for(this.scene)?.setVoidBloom(null);
    this.lighting?.setGroundGlowLights(this, null);
  }

  /** The pond is every water cell within reach of the anchor; glows sit on a sparse grid of them. */
  private ensurePond(state: BossIntroState): void {
    const { layout, metrics } = this.world();
    const key = `${state.x},${state.y},${layout ? 1 : 0},${metrics?.offsetX ?? 0},${metrics?.offsetY ?? 0}`;
    if (key === this.anchorKey || !layout || !metrics) return;
    this.anchorKey = key;
    this.glows.length = 0; this.reachPx = 0;
    const { glowStrideCells: stride, glowRadiusPx, pondReachPx } = KRAKEN_POND_VOID;
    const water = new Set((layout.water ?? []).map(cell => `${cell.gridX},${cell.gridY}`));
    for (const cell of layout.water ?? []) {
      const x = metrics.offsetX + (cell.gridX + 0.5) * CELL_SIZE, y = metrics.offsetY + (cell.gridY + 0.5) * CELL_SIZE;
      const distance = Math.hypot(x - state.x, y - state.y);
      if (distance > pondReachPx) continue;
      this.reachPx = Math.max(this.reachPx, distance);
      if (cell.gridX % stride === 0 && cell.gridY % stride === 0) {
        let neighbours = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && water.has(`${cell.gridX + dx},${cell.gridY + dy}`)) neighbours++;
        }
        this.glows.push({ x, y, radiusPx: glowRadiusPx, intensity: 0, color: VOID_PALETTE.primary, distance, interior: neighbours / 8 });
      }
    }
  }
}
